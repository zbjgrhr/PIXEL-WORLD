import { sanitizeAgentArtifact, sanitizeSharedArtifacts } from '@/lib/agents/sanitize'
import { countBlockingIssues, dedupeIssues, inspectGameSpec, inspectPlayability, inspectVisualAssets, sanitizeIssues } from '@/lib/agents/validation'
import { createFallbackGameSpec, normalizeGameSpec, preserveExplicitPromptFields } from '@/lib/game-spec'
import { stabilizeGameSpec } from '@/lib/game-spec-guardrails'
import { isStructuredPromptBlank } from '@/lib/asset-catalog'
import { inspectSelectedInspirations } from '@/lib/agents/inspiration-review'
import type { AgentExecuteRequest, AgentExecuteResponse, AgentIssue, AgentRole, GameSpec } from '@/types'

export interface ChatPayload {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export const ROLE_TOKEN_BUDGET: Record<AgentRole, number> = {
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


export function responseText(payload: ChatPayload): string {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('')
  return ''
}

export function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Agent returned no JSON object.')
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Agent JSON must be an object.')
  return parsed as Record<string, unknown>
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

export function localIntegratorResponse(request: AgentExecuteRequest, error: unknown): AgentExecuteResponse {
  const spec = request.role === 'integrator' ? deterministicIntegratedSpec(request) : currentSpec(request)
  const issues = inspectGameSpec(spec, 'engineQa')
  const reason = error instanceof Error ? error.message : 'upstream Agent unavailable'
  const source = request.provider === 'ollama' || request.provider === 'lmstudio' || request.provider === 'gpt4all' || request.provider === 'jan' || request.provider === 'webllm'
    ? '本机模型未输出合格结构'
    : '云端整合请求未能及时返回'
  return {
    success: true,
    data: {
      role: request.role,
      artifact: { spec, localFallback: true },
      summary: request.role === 'integrator'
        ? `${source}，已由本地规则生成并校验 GameSpec V3，后续评审可以继续。原因：${reason}`.slice(0, 1200)
        : `${source}，已保留并重新校验当前 GameSpec V3，后续流程可以继续。原因：${reason}`.slice(0, 1200),
      issues,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: request.provider,
      model: request.model,
    },
    timestamp: new Date().toISOString(),
  }
}

export function normalizeArtifact(
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
    issues = dedupeIssues([...issues, ...reported, ...inspectSelectedInspirations(request.sourcePrompt, currentSpec(request))])
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


export function prepareAgentRequest(body: AgentExecuteRequest): AgentExecuteRequest {
  const submittedSourcePrompt = String(body.sourcePrompt || '').trim().slice(0, 50000)
  return {
    ...body,
    sourcePrompt: isStructuredPromptBlank(submittedSourcePrompt)
      ? 'Complete and review an original colorful pixel platform adventure using the supplied GameSpec V3. Fill all missing requirements without overriding established choices.'
      : submittedSourcePrompt,
    projectName: String(body.projectName || 'Pixel World').trim().slice(0, 160),
    levelCount: Math.min(10, Math.max(1, Math.round(Number(body.levelCount) || 1))),
    artifacts: sanitizeSharedArtifacts(body.artifacts),
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.filter((url) => typeof url === 'string' && /^https:\/\//i.test(url)).slice(0, 6) : undefined,
  }
}
