import { describe, expect, it } from 'vitest'
import { applyWebLlmCreativePatch, buildWebLlmCreativeRequest, estimateWebLlmPromptTokens, parseWebLlmCreativePatch } from './webllm-lite'
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
  it('leaves generation room within a conservative 4096-token budget for long Chinese inputs', () => {
    const prompt = buildWebLlmCreativeRequest('风中的邮差'.repeat(40), '长篇故事与人物关系。'.repeat(1000), Array(8).fill('完整世界设定与灵感'.repeat(20)))
    expect(estimateWebLlmPromptTokens(prompt.system, prompt.user) + 480 + 256).toBeLessThan(4096)
  })
  it('maps browser story output to runtime narration while respecting locks and original facts', () => {
    const base = createFallbackGameSpec('世界观与故事：邮差要找回失踪的信。', '邮差', 2)
    base.narrative!.source.lockedFields.ending = base.narrative!.ending
    const next = applyWebLlmCreativePatch(base, { backgroundStory: '一阵狂风吹散了邮包，邮差决定追回每一封信。', heroName: '邮差小禾', collectibleName: '遗失信件' })
    expect(next.narrative!.opening).toContain('狂风吹散')
    expect(next.narrative!.ending).toBe(base.narrative!.ending)
    expect(next.narrative!.source.originalStory).toBe(base.narrative!.source.originalStory)
    expect(next.narrative!.chapters[0].objectives.find(task => task.kind === 'collect')!.description).toContain('遗失信件')
  })
  it('retains a stated place and Boss when lightweight model output changes them', () => {
    const base = createFallbackGameSpec('世界观与故事：小企鹅在日本世界打败熊猫Boss，最后找到妈妈。', '企鹅寻亲记', 2)
    const next = applyWebLlmCreativePatch(base, { world: '曙光城堡', bossName: '灰烬守门龙' })
    expect(next.world).toBe(base.world)
    expect(next.boss.name).toBe('熊猫')
    expect(next.narrative?.suggestions?.some(item => item.path === 'characters.boss.name' && item.status === 'pending')).toBe(true)
  })
})
