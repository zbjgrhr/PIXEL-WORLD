import { describe, expect, it } from 'vitest'
import { buildStructuredPrompt } from '@/lib/asset-catalog'
import { mergeProjectBrief } from './project-brief'
import { createFallbackGameSpec } from './game-spec'

describe('mergeProjectBrief', () => {
  it('keeps selected story inspiration inside the reviewed GameSpec', () => {
    const idea = '群岛会随着潮汐缓缓升降'
    const story = `一名地图师寻找失踪船队。\n【已选灵感】${idea}。`
    const prompt = mergeProjectBrief('游戏标题：旧标题\n世界观与故事：旧故事', '星潮群岛', story)
    const spec = createFallbackGameSpec(prompt, '星潮群岛', 2)
    expect(spec.world).toContain(idea)
    expect(spec.backgroundStory).toContain(idea)
  })
  it('keeps the separate title and story ahead of blank structured fields', () => {
    const prompt = buildStructuredPrompt(2).replace('主角 / Hero：', '主角 / Hero：蓝披风骑士')
    const merged = mergeProjectBrief(prompt, '星光救援', '骑士前往火山城堡救出公主。')
    expect(merged.match(/游戏标题：/g)).toHaveLength(1)
    expect(merged.match(/世界观与故事：/g)).toHaveLength(1)
    expect(merged).toContain('主角 / Hero：蓝披风骑士')
    expect(merged).toContain('世界观与故事：骑士前往火山城堡救出公主。')
  })

  it('replaces stale generated brief fields without discarding user asset details', () => {
    const merged = mergeProjectBrief('游戏标题：旧游戏\n世界观与故事：旧故事\n背景故事：旧故事\n主角：纸片人', '新游戏', '新的冒险')
    expect(merged).not.toContain('旧故事')
    expect(merged).toContain('主角：纸片人')
    expect(merged).toContain('世界观与故事：新的冒险')
  })
})
