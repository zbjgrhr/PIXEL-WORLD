import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeLocalAgentTask, testLocalAgentConnection } from './local-client'
import { createFallbackGameSpec } from '@/lib/game-spec'
import type { AgentExecuteRequest } from '@/types'

const sourcePrompt = '游戏标题：星潮群岛\n世界观与故事：主角是一名修理飞行船的年轻地图师，收集星火，重新点亮三座灯塔。'
const request: AgentExecuteRequest = {
  runId: 'test', taskId: 'integrator-r1', role: 'integrator', round: 1,
  provider: 'ollama', model: 'small-local', apiKey: '', baseUrl: 'http://127.0.0.1:11434/v1',
  sourcePrompt, projectName: '星潮群岛', levelCount: 2,
  baseSpec: createFallbackGameSpec(sourcePrompt, '星潮群岛', 2), artifacts: {},
}

afterEach(() => vi.unstubAllGlobals())

describe('local model GameSpec fallback', () => {
  it('uses a short bounded response for the connection check instead of asking for a GameSpec', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"ready":true}' } }] }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(testLocalAgentConnection('ollama', 'small-local', 'http://127.0.0.1:11434/v1')).resolves.toBeUndefined()
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(payload.max_tokens).toBe(32)
    expect(payload.messages[0].content).toContain('connection test')
  })

  it('returns a reviewable rules draft when a reachable model emits no JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'I cannot output that JSON.' } }] }) }))
    const result = await executeLocalAgentTask(request)
    expect(result.success).toBe(true)
    expect(result.data?.artifact.localFallback).toBe(true)
    expect(result.data?.artifact.spec).toMatchObject({ version: 3, title: '星潮群岛' })
    expect((result.data?.artifact.spec as { backgroundStory: string }).backgroundStory).toContain('年轻地图师')
  })

  it('still reports an unreachable local service as a connection failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')))
    await expect(executeLocalAgentTask(request)).rejects.toThrow('ECONNREFUSED')
  })
})
