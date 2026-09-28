import type { ChatPayload } from '@/lib/agents/execution'
import { buildWebLlmCreativeRequest, parseWebLlmCreativePatch, type WebLlmCreativePatch } from '@/lib/agents/webllm-lite'

type WebLlmEngine = Awaited<ReturnType<typeof import('@mlc-ai/web-llm')['CreateMLCEngine']>>

let loaded: { model: string; engine: WebLlmEngine } | undefined
let loading: { model: string; promise: Promise<WebLlmEngine> } | undefined

export interface WebLlmProgress {
  progress: number
  text: string
}

export interface WebLlmReadiness {
  cached: boolean
}

export async function inspectWebLlm(model: string): Promise<WebLlmReadiness> {
  if (typeof window === 'undefined' || !('gpu' in navigator)) throw new Error('当前浏览器或显卡不支持 WebGPU。请使用最新版 Chrome、Edge，或改用 Ollama / LM Studio。')
  const webllm = await import('@mlc-ai/web-llm')
  if (!webllm.prebuiltAppConfig.model_list.some((entry) => entry.model_id === model)) throw new Error('WebLLM 模型不在可用列表中。')
  return { cached: await webllm.hasModelInCache(model) }
}

export function isWebLlmReady(model: string): boolean {
  return loaded?.model === model
}

export async function prepareWebLlm(model: string, onProgress?: (progress: WebLlmProgress) => void) {
  await inspectWebLlm(model)
  if (loaded?.model === model) {
    onProgress?.({ progress: 1, text: '模型已经准备完成。' })
    return loaded.engine
  }
  if (loading?.model === model) return loading.promise

  const promise = (async () => {
    const webllm = await import('@mlc-ai/web-llm')
    const engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (report) => onProgress?.({
        progress: Math.max(0, Math.min(1, report.progress)),
        text: report.text || '正在准备浏览器模型…',
      }),
    })
    loaded = { model, engine }
    return engine
  })()
  loading = { model, promise }
  try {
    return await promise
  } finally {
    if (loading?.promise === promise) loading = undefined
  }
}

export async function webLlmCompletion(model: string, system: string, user: string, maxTokens: number, onProgress?: (progress: WebLlmProgress) => void): Promise<ChatPayload> {
  const engine = await prepareWebLlm(model, onProgress)
  const response = await engine.chat.completions.create({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens, temperature: 0.2, stream: false })
  return { choices: [{ message: { content: response.choices[0]?.message?.content || '' } }],
    usage: { prompt_tokens: response.usage?.prompt_tokens || 0, completion_tokens: response.usage?.completion_tokens || 0, total_tokens: response.usage?.total_tokens || 0 } }
}

export async function createWebLlmCreativePatch(model: string, projectName: string, story: string, inspirations: string[]): Promise<WebLlmCreativePatch> {
  const prompt = buildWebLlmCreativeRequest(projectName, story, inspirations)
  const payload = await webLlmCompletion(model, prompt.system, prompt.user, 480)
  const content = payload.choices?.[0]?.message?.content
  return parseWebLlmCreativePatch(typeof content === 'string' ? content : '')
}
