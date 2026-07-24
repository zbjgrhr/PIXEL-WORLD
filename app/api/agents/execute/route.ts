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

function responseText(payload: ChatPayload): string {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('')
  return ''
}

function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Agent returned no JSON object.')
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Agent JSON must be an object.')
  return parsed as Record<string, unknown>
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
): Promise<ChatPayload> {
  const response = await fetch(endpoint(request.provider), {
    method: 'POST',
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
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000)
    if (response.status === 400 && responseFormat && /response.format|response_format|json.object/i.test(detail)) {
      return callModel(request, apiKey, system, user, false)
    }
    const recoverable = response.status === 408 || response.status === 429 || response.status >= 500
    throw new AgentUpstreamError(response.status, `Agent API failed (${response.status}): ${detail}`, recoverable)
  }
  return response.json() as Promise<ChatPayload>
}

async function callAndParse(request: AgentExecuteRequest, apiKey: string): Promise<{ parsed: Record<string, unknown>; usage: AgentUsage }> {
  const prompts = buildAgentPrompts(request)
  const first = await callModel(request, apiKey, prompts.system, prompts.user)
  let parsed: Record<string, unknown>
  let payload = first
  try {
    parsed = parseJsonObject(responseText(first))
  } catch {
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
  return request.artifacts.productionSpec
    || request.artifacts.revisedSpec
    || request.artifacts.mergedSpec
    || request.baseSpec
    || createFallbackGameSpec(request.sourcePrompt, request.projectName, request.levelCount)
}

function normalizedSpec(request: AgentExecuteRequest, candidate: unknown): GameSpec {
  const fallback = currentSpec(request)
  const normalized = normalizeGameSpec(candidate, fallback, request.levelCount)
  return preserveExplicitPromptFields(normalized, fallback, request.sourcePrompt)
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

  if (request.role === 'integrator' || request.role === 'revision' || request.role === 'assetCoordinator') {
    const candidate = untrustedArtifact.spec || parsed.spec || untrustedArtifact
    const spec = normalizedSpec(request, candidate)
    artifact = { ...rawArtifact, spec }
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
  if (error instanceof AgentUpstreamError) return error.status === 401 || error.status === 403 ? 401 : error.status === 429 ? 429 : error.status >= 500 ? 502 : 400
  return 500
}

export async function POST(nextRequest: NextRequest) {
  let body: AgentExecuteRequest | undefined
  try {
    body = await nextRequest.json() as AgentExecuteRequest
    if (!body || !VALID_ROLES.has(body.role) || !body.runId || !body.taskId || !body.sourcePrompt?.trim()) {
      return NextResponse.json({ success: false, error: 'Invalid Agent task request.', recoverable: false, timestamp: new Date().toISOString() } satisfies AgentExecuteResponse, { status: 400 })
    }
    body = {
      ...body,
      sourcePrompt: body.sourcePrompt.trim().slice(0, 50000),
      projectName: String(body.projectName || 'Pixel World').trim().slice(0, 160),
      levelCount: Math.min(10, Math.max(1, Math.round(Number(body.levelCount) || 1))),
      artifacts: sanitizeSharedArtifacts(body.artifacts),
      imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.filter((url) => typeof url === 'string' && /^https:\/\//i.test(url)).slice(0, 6) : undefined,
    }
    const provider = getAgentProvider(body.provider)
    if (!provider.models.some((model) => model.id === body!.model)) {
      return NextResponse.json({ success: false, error: 'The selected Agent model is not supported.', recoverable: false, timestamp: new Date().toISOString() } satisfies AgentExecuteResponse, { status: 400 })
    }
    const key = normalizeApiKey(body.apiKey || process.env[provider.envKey])
    if (!key || apiKeyHasUnsupportedCharacters(key)) {
      return NextResponse.json({ success: false, error: 'A valid Agent API Key is required.', recoverable: false, timestamp: new Date().toISOString() } satisfies AgentExecuteResponse, { status: 401 })
    }

    const { parsed, usage } = await callAndParse(body, key)
    const { artifact, issues } = normalizeArtifact(body, parsed)
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 1200)
      : `${body.role} completed its structured deliverable.`
    return NextResponse.json({
      success: true,
      data: { role: body.role, artifact, summary, issues, usage, provider: body.provider, model: body.model },
      timestamp: new Date().toISOString(),
    } satisfies AgentExecuteResponse)
  } catch (error) {
    const recoverable = error instanceof AgentUpstreamError ? error.recoverable : false
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Agent execution failed.',
      recoverable,
      timestamp: new Date().toISOString(),
    } satisfies AgentExecuteResponse, { status: errorStatus(error) })
  }
}
