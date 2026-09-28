import type { ChatPayload } from '@/lib/agents/execution'

let loaded: { model: string; engine: Awaited<ReturnType<typeof import('@mlc-ai/web-llm')['CreateMLCEngine']>> } | undefined

export async function webLlmCompletion(model: string, system: string, user: string, maxTokens: number): Promise<ChatPayload> {
  if (typeof window === 'undefined' || !('gpu' in navigator)) throw new Error('WebLLM 需要支持 WebGPU 的浏览器和显卡。')
  const webllm = await import('@mlc-ai/web-llm')
  if (!webllm.prebuiltAppConfig.model_list.some((entry) => entry.model_id === model)) throw new Error('WebLLM 模型不在可用列表中。')
  if (!loaded || loaded.model !== model) loaded = { model, engine: await webllm.CreateMLCEngine(model) }
  const response = await loaded.engine.chat.completions.create({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens, temperature: 0.2, stream: false })
  return { choices: [{ message: { content: response.choices[0]?.message?.content || '' } }],
    usage: { prompt_tokens: response.usage?.prompt_tokens || 0, completion_tokens: response.usage?.completion_tokens || 0, total_tokens: response.usage?.total_tokens || 0 } }
}
