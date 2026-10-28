import { buildAgentPrompts } from '@/lib/agents/prompts'
import { localProviderConfig } from '@/lib/agents/config'
import { agentOutputBudget, deterministicAgentResponse, localIntegratorResponse, normalizeArtifact, parseJsonObject, prepareAgentRequest, responseText, ROLE_TOKEN_BUDGET } from '@/lib/agents/execution'
import type { ChatPayload } from '@/lib/agents/execution'
import type { AgentExecuteRequest, AgentExecuteResponse, LocalAgentProviderId } from '@/types'
import { isWebLlmReady, webLlmCompletion } from '@/lib/agents/webllm-client'

const LOCAL_CONNECTION_TIMEOUT_MS = 20_000
const CONNECTION_SYSTEM_PROMPT = 'You are a connection test. Reply with this exact JSON only: {"ready":true}'
const CONNECTION_USER_PROMPT = 'Return the connection test JSON now.'

async function localJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
  try {
    const response = await fetch(url, { ...init, signal })
    if (!response.ok) throw new Error(`本机服务请求失败（HTTP ${response.status}）：${(await response.text()).slice(0, 300)}`)
    // Some local servers send headers before inference finishes. The deadline
    // must include reading the JSON body, not just establishing a connection.
    return await response.json() as T
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`本机模型在 ${timeoutMs / 1000} 秒内未返回完整结果。请检查服务或换一个更小的模型；已有草案仍可继续审核。`)
    throw error
  } finally { globalThis.clearTimeout(timer) }
}

export function safeLocalBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('本地服务地址必须是本机的 http://127.0.0.1 或 localhost。')
  }
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`
}

export async function discoverLocalModels(provider: LocalAgentProviderId, baseUrl?: string, password?: string): Promise<Array<{ id: string; label: string }>> {
  if (provider === 'webllm') {
    const webllm = await import('@mlc-ai/web-llm')
    return webllm.prebuiltAppConfig.model_list.filter((item) => /(?:0\.5B|1B|1\.5B|3B)/i.test(item.model_id) && /q4f32_1/i.test(item.model_id))
      .slice(0, 15).map((item) => ({ id: item.model_id, label: item.model_id }))
  }
  const endpoint = safeLocalBaseUrl(baseUrl || localProviderConfig(provider).baseUrl || '')
  const payload = await localJson<{ data?: Array<{ id?: string }> }>(`${endpoint}/models`, { headers: password ? { Authorization: `Bearer ${password}` } : {}, cache: 'no-store' }, 20_000)
  return (payload.data || []).filter((item): item is { id: string } => Boolean(item.id)).map((item) => ({ id: item.id, label: item.id }))
}

/** A short, bounded check. Full GameSpec planning deliberately happens later. */
export async function testLocalAgentConnection(provider: LocalAgentProviderId, model: string, baseUrl?: string, password?: string): Promise<void> {
  if (!model.trim()) throw new Error('请先检测并选择模型。')
  let payload: ChatPayload
  if (provider === 'webllm') {
    if (!isWebLlmReady(model)) throw new Error('请先准备浏览器模型；首次下载完成后再测试文字模型。')
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
    try {
      payload = await Promise.race([
        webLlmCompletion(model, CONNECTION_SYSTEM_PROMPT, CONNECTION_USER_PROMPT, 32),
        new Promise<never>((_, reject) => { timeout = globalThis.setTimeout(() => reject(new Error('浏览器模型在 20 秒内没有完成短文字测试。请改用 Ollama、LM Studio，或直接使用本地草案继续。')), LOCAL_CONNECTION_TIMEOUT_MS) }),
      ])
    } finally {
      if (timeout) globalThis.clearTimeout(timeout)
    }
  } else {
    const endpoint = safeLocalBaseUrl(baseUrl || localProviderConfig(provider).baseUrl || '')
    payload = await localJson<ChatPayload>(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 32, stream: false,
          messages: [{ role: 'system', content: CONNECTION_SYSTEM_PROMPT }, { role: 'user', content: CONNECTION_USER_PROMPT }] }),
      }, LOCAL_CONNECTION_TIMEOUT_MS)
  }
  try {
    const result = JSON.parse(responseText(payload).trim()) as { ready?: unknown }
    if (result.ready !== true) throw new Error('unexpected response')
  } catch {
    throw new Error('模型已响应，但没有完成短格式测试。请换一个指令模型，或直接使用本地草案继续。')
  }
}

export async function executeLocalAgentTask(rawRequest: AgentExecuteRequest, signal?: AbortSignal): Promise<AgentExecuteResponse> {
  const request = prepareAgentRequest(rawRequest)
  const deterministic = deterministicAgentResponse(request)
  if (deterministic) return deterministic
  const prompts = buildAgentPrompts(request)
  let payload: ChatPayload
  if (request.provider === 'webllm') {
    payload = await webLlmCompletion(request.model, prompts.system, prompts.user, ROLE_TOKEN_BUDGET[request.role])
  } else {
    const provider = request.provider as Exclude<LocalAgentProviderId, 'webllm'>
    const endpoint = safeLocalBaseUrl(request.baseUrl || localProviderConfig(provider).baseUrl || '')
    payload = await localJson<ChatPayload>(`${endpoint}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(request.apiKey ? { Authorization: `Bearer ${request.apiKey}` } : {}) },
      body: JSON.stringify({ model: request.model, temperature: 0.2, max_tokens: agentOutputBudget(request), stream: false,
        messages: [{ role: 'system', content: prompts.system }, { role: 'user', content: prompts.user }] }),
    }, 45_000)
  }
  try {
    const parsed = parseJsonObject(responseText(payload))
    const rawArtifact = parsed.artifact
    if (!rawArtifact || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact) || !Object.keys(rawArtifact).length) {
      throw new Error('本地模型没有返回可用的结构化内容。')
    }
    if ((request.role === 'integrator' || request.role === 'revision') && !(rawArtifact as Record<string, unknown>).spec) {
      throw new Error('本地模型没有输出 GameSpec V3 补丁。')
    }
    const { artifact, issues } = normalizeArtifact(request, parsed)
    const usage = payload.usage || {}
    return { success: true, data: { role: request.role, artifact, issues,
      summary: artifact.patchRejected ? '本次修订引入了新问题，已保留上一次规格；原评审问题仍需处理。' : typeof parsed.summary === 'string' ? parsed.summary.slice(0, 1200) : '本地模型已返回结果。',
      usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 },
      provider: request.provider, model: request.model }, timestamp: new Date().toISOString() }
  } catch (error) {
    if (request.role === 'integrator' || request.role === 'revision') return localIntegratorResponse(request, error)
    throw error
  }
}
