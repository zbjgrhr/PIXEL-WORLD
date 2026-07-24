import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

describe('POST /api/agents/execute', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('executes one short Agent task with the locked text model and returns structured JSON', async () => {
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-test-only' })
      const requestBody = JSON.parse(String(init?.body)) as { model: string }
      expect(requestBody.model).toBe('google/gemini-2.5-flash')
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          summary: 'Director created a concise brief.',
          artifact: { title: 'Test World', goals: ['Reach the exit'], requiredAssets: ['hero'] },
          issues: [],
        }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', upstream)

    const request = new Request('http://localhost/api/agents/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'test-run', taskId: 'director-r1', role: 'director', round: 1,
        provider: 'openrouter', model: 'google/gemini-2.5-flash', apiKey: 'sk-test-only',
        sourcePrompt: 'Create an original one-level pixel platform game.',
        projectName: 'Test World', levelCount: 1, artifacts: {},
      }),
    })

    const response = await POST(request as never)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.model).toBe('google/gemini-2.5-flash')
    expect(data.data.usage.totalTokens).toBe(30)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
})
