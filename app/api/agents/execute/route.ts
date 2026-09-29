import { NextRequest, NextResponse } from 'next/server'
import { apiKeyHasUnsupportedCharacters, normalizeApiKey } from '@/lib/api-key'
import { agentModelSupportsVision, getAgentProvider } from '@/lib/agents/config'
import { buildAgentPrompts } from '@/lib/agents/prompts'
import { sanitizeAgentArtifact, sanitizeSharedArtifacts } from '@/lib/agents/sanitize'
import {
  countBlockingIssues,
  dedupeIssues,
  inspectGameSpec,
  inspectPlayability,
  inspectVisualAssets,
  sanitizeIssues,
} from '@/lib/agents/validation'
import { createFallbackGameSpec, normalizeGameSpec, preserveExplicitPromptFields } from '@/lib/game-spec'
import { stabilizeGameSpec } from '@/lib/game-spec-guardrails'
import { isStructuredPromptBlank } from '@/lib/asset-catalog'
import type {
  AgentExecuteRequest,
  AgentExecuteResponse,
  AgentIssue,
  AgentProviderId,
  AgentRole,
  AgentUsage,
  GameSpec,
} from '@/types'

const VALID_ROLES = new Set<AgentRole>([
  'director', 'narrative', 'mechanics', 'artDirector', 'levelDesigner', 'integrator',
  'consistencyCritic', 'engineQa', 'revision', 'assetCoordinator', 'visualQa', 'playtest', 'publisher',
])

interface ChatPayload {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

const ROLE_TOKEN_BUDGET: Record<AgentRole, number> = {
  director: 1800,
  narrative: 2400,
  mechanics: 3200,
  artDirector: 2800,
  levelDesigner: 4600,
  integrator: 4200,
  consistencyCritic: 2800,
  engineQa: 2800,
  revision: 4600,
  assetCoordinator: 3200,
  visualQa: 2400,
  playtest: 2400,
  publisher: 1800,
}

const MODEL_TIMEOUT_MS = 32_000

class AgentUpstreamError extends Error {
  constructor(readonly status: number, message: string, readonly recoverable: boolean) {
    super(message)
  }
}

function endpoint(provider: AgentProviderId): string {
  if (provider === 'openai') return 'https://api.openai.com/v1/chat/completions'
  if (provider === 'dashscope') return 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  return 'https://openrouter.ai/api/v1/chat/completions'
}

function imageContent(text: string, urls: string[]) {
  const safeUrls = urls.filter((url) => /^https:\/\//i.test(url)).slice(0, 6)
  if (!safeUrls.length) return text
  return [
    { type: 'text', text },
    ...safeUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
  ]
}

async function callModel(
  request: AgentExecuteRequest,
  apiKey: string,
  system: string,
  user: string,
  responseFormat = true,
  onAttempt?: () => Promise<void>,
): Promise<ChatPayload> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(endpoint(request.provider), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(request.provider === 'openrouter' ? {
          'HTTP-Referer': process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
          'X-Title': 'Pixel World Agent Studio',
        } : {}),
      },
      body: JSON.stringify({
        model: request.model,
        temperature: request.role === 'consistencyCritic' || request.role === 'engineQa' ? 0.1 : 0.25,
        max_tokens: ROLE_TOKEN_BUDGET[request.role],
        ...(responseFormat ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: request.role === 'visualQa' && agentModelSupportsVision(request.provider, request.model) ? imageContent(user, request.imageUrls || []) : user,
          },
        ],
      }),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AgentUpstreamError(504, `Agent model timed out after ${MODEL_TIMEOUT_MS / 1000} seconds.`, true)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000)
    if (response.status === 400 && responseFormat && /response.format|response_format|json.object/i.test(detail)) {
      return callModel(request, apiKey, system, user, false, onAttempt)
    }
    const recoverable = response.status === 408 || response.status === 429 || response.status >= 500
    throw new AgentUpstreamError(response.status, `Agent API failed (${response.status}): ${detail}`, recoverable)
  }
  return response.json() as Promise<ChatPayload>
}

async function callAndParse(request: AgentExecuteRequest, apiKey: string, onAttempt?: () => Promise<void>): Promise<{ parsed: Record<string, unknown>; usage: AgentUsage }> {
  const prompts = buildAgentPrompts(request)
  const first = await callModel(request, apiKey, prompts.system, prompts.user, !onAttempt, onAttempt)
  let parsed: Record<string, unknown>
  let payload = first
  try {
    parsed = parseJsonObject(responseText(first))
  } catch {
    if (onAttempt) throw new AgentUpstreamError(502, '云端文字模型未返回有效 JSON；本次上游尝试已计费。', false)
    const repairSystem = 'Return valid JSON only. Preserve the supplied content without adding executable code or explanations.'
    const repairUser = `Repair this malformed Agent response into {"summary":string,"artifact":object,"issues":array}:\n${responseText(first).slice(0, 30000)}`
    payload = await callModel(request, apiKey, repairSystem, repairUser, true)
    parsed = parseJsonObject(responseText(payload))
  }
  const usage = payload.usage || {}
  return {
    parsed,
    usage: {
      promptTokens: Number(usage.prompt_tokens) || 0,
      completionTokens: Number(usage.completion_tokens) || 0,
      totalTokens: Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0),
    },
  }
}

function currentSpec(request: AgentExecuteRequest): GameSpec {
  const deterministicFallback = createFallbackGameSpec(request.sourcePrompt, request.projectName, request.levelCount)
  const candidate = request.artifacts.productionSpec
    || request.artifacts.revisedSpec
    || request.artifacts.mergedSpec
    || request.baseSpec
  if (!candidate) return deterministicFallback
  return stabilizeGameSpec(normalizeGameSpec(candidate, deterministicFallback, request.levelCount))
}

function normalizedSpec(request: AgentExecuteRequest, candidate: unknown): GameSpec {
  const fallback = currentSpec(request)
  const normalized = normalizeGameSpec(candidate, fallback, request.levelCount)
  return preserveExplicitPromptFields(stabilizeGameSpec(normalized), fallback, request.sourcePrompt)
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nonEmptyText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function deterministicIntegratedSpec(request: AgentExecuteRequest): GameSpec {
  const base = currentSpec(request)
  const brief = objectValue(request.artifacts.brief)
  const narrative = objectValue(request.artifacts.narrative)
  const mechanics = objectValue(request.artifacts.mechanics)
  const art = objectValue(request.artifacts.artDirection)
  const levelPlan = objectValue(request.artifacts.levelPlan)
  const plannedLevels = Array.isArray(levelPlan.levels) && levelPlan.levels.length === request.levelCount
    ? levelPlan.levels
    : base.levels
  const candidate = {
    ...base,
    title: nonEmptyText(brief.title, base.title),
    world: nonEmptyText(narrative.world, base.world),
    backgroundStory: nonEmptyText(narrative.backgroundStory, base.backgroundStory),
    visualStyle: {
      ...base.visualStyle,
      artDirection: nonEmptyText(art.artDirection, base.visualStyle.artDirection),
      palette: nonEmptyText(art.palette, base.visualStyle.palette),
      lighting: nonEmptyText(art.lighting, base.visualStyle.lighting),
      pixelScale: nonEmptyText(art.pixelScale, base.visualStyle.pixelScale),
    },
    hero: objectValue(mechanics.hero),
    weapon: objectValue(mechanics.weapon),
    enemies: Array.isArray(mechanics.enemies) && mechanics.enemies.length ? mechanics.enemies : base.enemies,
    boss: objectValue(mechanics.boss),
    collectible: objectValue(mechanics.collectible),
    levels: plannedLevels,
  }
  return normalizedSpec(request, candidate)
}

function localIntegratorResponse(request: AgentExecuteRequest, error: unknown): AgentExecuteResponse {
  const spec = request.role === 'integrator' ? deterministicIntegratedSpec(request) : currentSpec(request)
  const issues = inspectGameSpec(spec, 'engineQa')
  const reason = error instanceof Error ? error.message : 'upstream Agent unavailable'
  return {
    success: true,
    data: {
      role: request.role,
      artifact: { spec, localFallback: true },
      summary: request.role === 'integrator'
        ? `云端整合请求未能及时返回，已由本地可靠整合器完成 GameSpec V3，后续评审可以继续。原因：${reason}`.slice(0, 1200)
        : `云端修订请求未能及时返回，已保留并重新校验当前 GameSpec V3，后续流程可以继续。原因：${reason}`.slice(0, 1200),
      issues,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: request.provider,
      model: request.model,
    },
    timestamp: new Date().toISOString(),
  }
}

function normalizeArtifact(
  request: AgentExecuteRequest,
  parsed: Record<string, unknown>,
): { artifact: Record<string, unknown>; issues: AgentIssue[] } {
  const untrustedArtifact = parsed.artifact && typeof parsed.artifact === 'object' && !Array.isArray(parsed.artifact)
    ? parsed.artifact as Record<string, unknown>
    : {}
  const rawArtifact = sanitizeAgentArtifact(request.role, untrustedArtifact)
  let artifact = rawArtifact
  let issues = sanitizeIssues(parsed.issues, request.role)

  if (request.role === 'integrator' || request.role === 'revision') {
    const candidate = untrustedArtifact.spec || parsed.spec || untrustedArtifact
    const spec = normalizedSpec(request, candidate)
    artifact = { ...rawArtifact, spec }
    issues = dedupeIssues([...issues, ...inspectGameSpec(spec, 'engineQa')])
  } else if (request.role === 'assetCoordinator') {
    const base = currentSpec(request)
    const patches = Array.isArray(rawArtifact.assetPromptPatches) ? rawArtifact.assetPromptPatches : []
    const promptById = new Map<string, string>()
    for (const candidate of patches.slice(0, 100)) {
      if (!candidate || typeof candidate !== 'object') continue
      const item = candidate as Record<string, unknown>
      if (typeof item.assetId === 'string' && typeof item.prompt === 'string' && item.prompt.trim()) {
        promptById.set(item.assetId.slice(0, 160), item.prompt.trim().slice(0, 8000))
      }
    }
    const candidate = {
      ...base,
      assets: base.assets.map((asset) => promptById.has(asset.id) ? { ...asset, prompt: promptById.get(asset.id)! } : asset),
    }
    const spec = normalizedSpec(request, candidate)
    const estimatedImageJobs = spec.assets.filter((asset) => asset.enabled).reduce((total, asset) => {
      if (asset.kind === 'spriteSheet') {
        return total + Object.values(asset.animation?.clips || {}).filter((clip) => clip?.enabled !== false).length
      }
      return total + (asset.kind === 'image' ? 1 : 0)
    }, 0)
    artifact = { ...rawArtifact, estimatedImageJobs, spec }
    issues = dedupeIssues([...issues, ...inspectGameSpec(spec, 'engineQa')])
  } else if (request.role === 'consistencyCritic') {
    const reported = sanitizeIssues(rawArtifact.issues, 'consistencyCritic')
    issues = dedupeIssues([...issues, ...reported])
    artifact = { ...rawArtifact, issues }
  } else if (request.role === 'engineQa') {
    issues = dedupeIssues([...issues, ...sanitizeIssues(rawArtifact.issues, 'engineQa'), ...inspectGameSpec(currentSpec(request), 'engineQa')])
    artifact = { ...rawArtifact, issues }
  } else if (request.role === 'visualQa') {
    issues = dedupeIssues([...issues, ...inspectVisualAssets(currentSpec(request))])
    artifact = { ...rawArtifact, issues, blockingCount: countBlockingIssues(issues) }
  } else if (request.role === 'playtest') {
    issues = dedupeIssues([...issues, ...inspectPlayability(currentSpec(request))])
    artifact = { ...rawArtifact, issues, blockingCount: countBlockingIssues(issues) }
  } else if (request.role === 'publisher') {
    const shared = [
      ...(request.artifacts.reviewIssues || []),
      ...sanitizeIssues(request.artifacts.visualReport?.issues, 'visualQa'),
      ...sanitizeIssues(request.artifacts.playtestReport?.issues, 'playtest'),
      ...issues,
    ]
    issues = dedupeIssues(shared)
    artifact = {
      ...rawArtifact,
      ready: countBlockingIssues(issues) === 0,
      blockingIssues: issues.filter((item) => item.severity === 'blocking'),
      warnings: issues.filter((item) => item.severity === 'warning'),
    }
  }
  return { artifact, issues }
}

function errorStatus(error: unknown): number {
  if (error instanceof CustomEndpointError) return error.status === 401 || error.status === 403 ? 401 : error.status === 429 ? 429 : error.status >= 500 ? 502 : 400
  if (error instanceof AgentUpstreamError) return error.status === 401 || error.status === 403 ? 401 : error.status === 429 ? 429 : error.status >= 500 ? 502 : 400
  return 500
}

export async function POST(nextRequest: NextRequest) {
  let body: AgentExecuteRequest | undefined
  try {
    body = await nextRequest.json() as AgentExecuteRequest
    if (!body || !VALID_ROLES.has(body.role) || !body.runId || !body.taskId) {
      return NextResponse.json({ success: false, error: 'Invalid Agent task request.', recoverable: false, timestamp: new Date().toISOString() } satisfies AgentExecuteResponse, { status: 400 })
    }
    const submittedSourcePrompt = String(body.sourcePrompt || '').trim().slice(0, 50000)
    body = {
      ...body,
      sourcePrompt: isStructuredPromptBlank(submittedSourcePrompt)
        ? 'Complete and review an original colorful pixel platform adventure using the supplied GameSpec V3. Fill all missing requirements without overriding established choices.'
        : submittedSourcePrompt,
      projectName: String(body.projectName || 'Pixel World').trim().slice(0, 160),
      levelCount: Math.min(10, Math.max(1, Math.round(Number(body.levelCount) || 1))),
      artifacts: sanitizeSharedArtifacts(body.artifacts),
      imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.filter((url) => typeof url === 'string' && /^https:\/\//i.test(url)).slice(0, 6) : undefined,
    }
    const provider = getAgentProvider(body.provider)
    if (body.provider === 'custom') {
      body.baseUrl = validateCustomBaseUrl(body.baseUrl || '')
      if (!body.model?.trim() || body.model.length > 160 || /[\r\n]/.test(body.model)) throw new CustomEndpointError(400, '请填写有效的自定义文字模型 ID。')
    } else if (!provider.models.some((model) => model.id === body!.model)) {
      return NextResponse.json({ success: false, error: 'The selected Agent model is not supported.', recoverable: false, timestamp: new Date().toISOString() } satisfies AgentExecuteResponse, { status: 400 })
    }
    const key = normalizeApiKey(body.apiKey)
    if (!key || apiKeyHasUnsupportedCharacters(key)) {
      return NextResponse.json({ success: false, error: 'A valid Agent API Key is required.', recoverable: false, timestamp: new Date().toISOString() } satisfies AgentExecuteResponse, { status: 401 })
    }

    const { parsed, usage } = await callAndParse(body, key)
    if (body.provider === 'custom') {
      const rawArtifact = parsed.artifact
      if (!rawArtifact || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact) || !Object.keys(rawArtifact).length
        || ((body.role === 'integrator' || body.role === 'revision') && !(rawArtifact as Record<string, unknown>).spec)) {
        throw new AgentUpstreamError(502, '自定义文字模型未返回 Agent 所需的结构化内容。', false)
      }
      if (body.provider === 'custom' && body.runId.startsWith('agent-test-') && body.role === 'integrator') {
        const spec = (rawArtifact as Record<string, unknown>).spec as Record<string, unknown> | undefined
        if (!spec || spec.version !== 3 || !Array.isArray(spec.levels) || !spec.levels.length || !Array.isArray(spec.assets) || !spec.assets.length) {
          throw new AgentUpstreamError(502, '模型返回了 JSON，但未提供完整的 GameSpec V3 关卡和素材结构。', false)
        }
      }
    }
    const { artifact, issues } = normalizeArtifact(body, parsed)
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 1200)
      : `${body.role} completed its structured deliverable.`
    const result = NextResponse.json({
      success: true,
      data: { role: body.role, artifact, summary, issues, usage, provider: body.provider, model: body.model },
      timestamp: new Date().toISOString(),
    } satisfies AgentExecuteResponse)
    return result
  } catch (error) {
    const upstreamRejectedPermanently = error instanceof AgentUpstreamError && !error.recoverable
    if (body && (body.role === 'integrator' || body.role === 'revision') && !upstreamRejectedPermanently) {
      return NextResponse.json(localIntegratorResponse(body, error))
    }
    const recoverable = error instanceof AgentUpstreamError
      ? error.recoverable
      : error instanceof Error && /fetch|network|socket|ECONN|ENOTFOUND|timeout/i.test(error.message)
    const result = NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Agent execution failed.',
      recoverable,
      timestamp: new Date().toISOString(),
    } satisfies AgentExecuteResponse, { status: errorStatus(error) })
    return result
  }
}
