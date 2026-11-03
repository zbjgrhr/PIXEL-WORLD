import { afterEach, expect, it, vi } from 'vitest'
import { GET } from './route'

afterEach(() => vi.unstubAllGlobals())
it('reads only the fixed public metadata endpoint without credentials or inference', async () => {
  const upstream = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({data:[{id:'qwen/example',architecture:{output_modalities:['text']}}]}))
  vi.stubGlobal('fetch', upstream)
  const response = await GET()
  expect(response.status).toBe(200)
  expect(upstream).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', expect.objectContaining({next:{revalidate:900}}))
  expect(upstream.mock.calls[0]?.[1]).not.toHaveProperty('headers')
  expect((await response.json()).models[0].id).toBe('qwen/example')
})
it('reports metadata failure without fabricating an empty success catalog', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('',{status:503})))
  const response = await GET()
  expect(response.status).toBe(502)
  expect((await response.json()).error).toContain('手动填写模型 ID')
})
