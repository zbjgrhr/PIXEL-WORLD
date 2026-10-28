import { afterEach, describe, expect, it, vi } from 'vitest'

const engine = vi.hoisted(() => ({ chat: { completions: { create: vi.fn() } }, interruptGenerate: vi.fn(async () => {}) }))
vi.mock('@mlc-ai/web-llm', () => ({ prebuiltAppConfig: { model_list: [{ model_id: 'test-browser-model' }] }, hasModelInCache: async () => true, CreateMLCEngine: async () => engine }))
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

describe('browser inference guards with a simulated WebLLM engine', () => {
  it('rejects excessive context before initializing or calling the browser engine', async () => {
    const { webLlmCompletion } = await import('./webllm-client')
    await expect(webLlmCompletion('test-browser-model', '指令'.repeat(3000), '内容', 480)).rejects.toThrow('上下文预算')
    expect(engine.chat.completions.create).not.toHaveBeenCalled()
  })
  it('stops waiting and interrupts a stalled browser inference after 30 seconds', async () => {
    vi.useFakeTimers(); vi.stubGlobal('window', {}); vi.stubGlobal('navigator', { gpu: {} })
    engine.chat.completions.create.mockReturnValue(new Promise(() => {}))
    const { webLlmCompletion } = await import('./webllm-client')
    const pending = expect(webLlmCompletion('test-browser-model', 'Return JSON', 'Short story', 100)).rejects.toThrow('30 秒')
    await vi.advanceTimersByTimeAsync(30_000)
    await pending
    expect(engine.interruptGenerate).toHaveBeenCalledOnce()
  })
})
