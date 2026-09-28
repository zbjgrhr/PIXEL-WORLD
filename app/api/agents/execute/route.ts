import { NextRequest, NextResponse } from 'next/server'
import { apiKeyHasUnsupportedCharacters, normalizeApiKey } from '@/lib/api-key'
import { agentModelSupportsVision, getAgentProvider } from '@/lib/agents/config'
import { buildAgentPrompts } from '@/lib/agents/prompts'
import { isLocalAgentProvider } from '@/lib/agents/config'
import { localIntegratorResponse, normalizeArtifact, prepareAgentRequest, parseJsonObject, responseText, ROLE_TOKEN_BUDGET } from '@/lib/agents/execution'
import type { ChatPayload } from '@/lib/agents/execution'
import { CustomEndpointError, customJsonRequest, validateCustomBaseUrl } from '@/lib/custom-endpoint.server'
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
  if (request.provider === 'custom') {
    const payload = {
      model: request.model,
      temperature: request.role === 'consistencyCritic' || request.role === 'engineQa' ? 0.1 : 0.25,
      max_tokens: ROLE_TOKEN_BUDGET[request.role],
      ...(responseFormat ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }
    try {
      return await customJsonRequest(request.baseUrl || '', '/chat/completions', apiKey, payload) as unknown as ChatPayload
    } catch (error) {
      if (error instanceof CustomEndpointError && error.status === 400 && responseFormat && /response.format|response_format|json.object/i.test(error.message)) {
        return callModel(request, apiKey, system, user, false, onAttempt)
      }
      throw error
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)
  let response: Response
  try {
    if (onAttempt) await onAttempt()
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
    body = prepareAgentRequest(body)
    if (body.provider === 'managed') {
      return NextResponse.json({ success: false, error: '站点云端体验已移除，请选择自己的文字工具。', recoverable: false, timestamp: new Date().toISOString() } satisfies AgentExecuteResponse, { status: 410 })
    }
    if (isLocalAgentProvider(body.provider)) {
      return NextResponse.json({ success: false, error: 'Local AI must be called directly from your browser.', recoverable: false, timestamp: new Date().toISOString() } satisfies AgentExecuteResponse, { status: 400 })
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
    if (body && body.provider !== 'custom' && (body.role === 'integrator' || body.role === 'revision') && !upstreamRejectedPermanently) {
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
