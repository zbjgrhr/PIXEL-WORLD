import { describe, expect, it } from 'vitest'
import { INSPIRATION_PACKS, selectedInspirationTexts } from '@/configs/inspiration-packs'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { inspectSelectedInspirations } from './inspiration-review'

describe('selected inspirations in review', () => {
  it('keeps complete compatible packs and recognizes selected ideas', () => {
    for (const pack of INSPIRATION_PACKS) {
      expect(pack.ideas.map((idea) => idea.kind)).toEqual(['世界', '主角', '冲突', '目标', '画风'])
      expect(pack.ideas.every((idea) => idea.variants.length === 2)).toBe(true)
    }
    expect(selectedInspirationTexts('已选灵感：群岛会随着潮汐缓缓升降。')).toEqual(['群岛会随着潮汐缓缓升降'])
  })

  it('flags a selected idea for human review if the spec does not mention it', () => {
    const selected = '群岛会随着潮汐缓缓升降'
    const prompt = `游戏标题：群岛冒险\n背景故事：${selected}。`
    const retained = createFallbackGameSpec(prompt, '群岛冒险', 2)
    expect(inspectSelectedInspirations(prompt, retained)[0].severity).toBe('info')
    const dropped = { ...retained, world: '另一个世界', backgroundStory: '另一段故事' }
    expect(inspectSelectedInspirations(prompt, dropped)[0].severity).toBe('warning')
  })
})
