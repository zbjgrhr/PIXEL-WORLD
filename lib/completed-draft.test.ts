import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec } from './game-spec'
import { mergeCompletedDraft } from './completed-draft'

describe('mergeCompletedDraft', () => {
  const fresh = createFallbackGameSpec('世界观与故事：小企鹅在日本寻找妈妈。', '寻亲', 2)
  it('uses new wording when refreshing a generated draft', () => {
    const old = { ...fresh, world: '旧模型生成的世界' }
    expect(mergeCompletedDraft(old, fresh, 2).world).toBe(fresh.world)
  })
  it('keeps player edits during another completion', () => {
    const old = { ...fresh, world: '玩家手动修改的世界', narrative: { ...fresh.narrative!, source: { ...fresh.narrative!.source, origin: 'player' as const } } }
    expect(mergeCompletedDraft(old, fresh, 2).world).toBe('玩家手动修改的世界')
  })
})
