import { describe, expect, it } from 'vitest'
import { applyWebLlmCreativePatch, buildWebLlmCreativeRequest, parseWebLlmCreativePatch } from './webllm-lite'
import { createFallbackGameSpec } from '@/lib/game-spec'

describe('WebLLM lightweight planning', () => {
  it('keeps the browser prompt focused on the player brief instead of a GameSpec', () => {
    const request = buildWebLlmCreativeRequest('星潮群岛', '地图师要收集星火，重新点亮灯塔。', ['群岛会随着潮汐缓缓升降'])
    expect(request.user).toContain('地图师')
    expect(request.user).not.toContain('assets')
    expect(request.system).toContain('Do not create levels')
  })

  it('applies only lightweight creative fields to the reliable local specification', () => {
    const base = createFallbackGameSpec('世界观与故事：原始故事', '测试世界', 2)
    const patch = parseWebLlmCreativePatch('{"world":"潮汐群岛","heroName":"星图师","palette":"青蓝与珊瑚橙"}')
    const result = applyWebLlmCreativePatch(base, patch)
    expect(result.world).toBe('潮汐群岛')
    expect(result.hero.name).toBe('星图师')
    expect(result.visualStyle.palette).toBe('青蓝与珊瑚橙')
    expect(result.assets).toHaveLength(base.assets.length)
    expect(result.levels).toHaveLength(2)
  })
})
