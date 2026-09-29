import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

describe('POST /api/agents/execute', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('refuses historical managed cloud requests before any upstream call', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const request = new Request('http://localhost/api/agents/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'legacy-run', taskId: 'director-r1', role: 'director', round: 1,
        provider: 'managed', model: 'legacy-model', apiKey: '', sourcePrompt: 'A game', projectName: 'Test', levelCount: 1, artifacts: {} }) })
    const response = await POST(request as never)
    expect(response.status).toBe(410)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects a private custom Agent endpoint without masking the failure with a local GameSpec', async () => {
    const request = new Request('http://localhost/api/agents/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'custom-test', taskId: 'integrator-r1', role: 'integrator', round: 1,
        provider: 'custom', model: 'my-model', apiKey: 'test-key', baseUrl: 'https://127.0.0.1/v1',
        sourcePrompt: 'A game', projectName: 'Test', levelCount: 1, artifacts: {} }) })
    const response = await POST(request as never)
    const result = await response.json()
    expect(response.status).toBe(400)
    expect(result.success).toBe(false)
    expect(result.data?.artifact?.localFallback).toBeUndefined()
  })

  it('never spends an ordinary server API key for an anonymous BYOK request', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'server-secret-must-not-be-used')
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const request = new Request('http://localhost/api/agents/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'no-key-run', taskId: 'director-r1', role: 'director', round: 1,
        provider: 'openrouter', model: 'google/gemini-2.5-flash', apiKey: '', sourcePrompt: 'A game', projectName: 'Test', levelCount: 1, artifacts: {} }) })
    const response = await POST(request as never)
    expect(response.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

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

  it('repairs an incomplete base spec when an empty idea reaches the Integrator', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: 'Integrator completed the prepared specification.',
        artifact: { spec: {} },
        issues: [],
      }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const request = new Request('http://localhost/api/agents/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'blank-run', taskId: 'integrator-r1', role: 'integrator', round: 1,
        provider: 'openrouter', model: 'google/gemini-2.5-flash', apiKey: 'sk-test-only',
        sourcePrompt: '', projectName: 'Untitled World', levelCount: 3, artifacts: {},
        baseSpec: { version: 3, title: 'Incomplete draft' },
      }),
    })

    const response = await POST(request as never)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.artifact.spec.levels).toHaveLength(3)
    expect(data.data.artifact.spec.assets.length).toBeGreaterThan(0)
  })

  it('uses the deterministic local integrator when the upstream integration request times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Gateway Timeout', { status: 504 })))

    const request = new Request('http://localhost/api/agents/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'timeout-run', taskId: 'integrator-r1', role: 'integrator', round: 1,
        provider: 'openrouter', model: 'google/gemini-2.5-flash', apiKey: 'sk-test-only',
        sourcePrompt: '游戏标题：星光救援\n世界观与故事：勇士收集钥匙并救出公主。',
        projectName: '星光救援', levelCount: 2, artifacts: {
          brief: { title: '星光救援', playerFantasy: '勇士', audience: 'players', pillars: ['救援'], explicitRequirements: ['两关'], constraints: [], levelCount: 2 },
          narrative: { world: '星光群岛', backgroundStory: '勇士收集钥匙并救出公主。' },
        },
      }),
    })

    const response = await POST(request as never)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.artifact.localFallback).toBe(true)
    expect(data.data.artifact.spec.title).toBe('星光救援')
    expect(data.data.artifact.spec.levels).toHaveLength(2)
  })
})
