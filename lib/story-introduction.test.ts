import { describe, expect, it } from 'vitest'
import { separateStoryIntroduction } from './story-introduction'
import { createFallbackGameSpec } from './game-spec'
import { normalizeModelGameSpec } from './model-game-spec'
import { pendingNarrativeSuggestions } from './narrative-suggestions'

describe('opening and ending separation', () => {
  it('keeps a completed rescue before the final clause in the ending', () => {
    const story = '钟表匠林澈带着妹妹阿遥来到倒走的城。守钟机械带走阿遥。林澈穿过三处街巷，修好三枚钟芯，击败守钟机械，救回阿遥，最后把中央钟调回正向。'
    const parts = separateStoryIntroduction(story)
    expect(parts.introduction).not.toContain('救回阿遥')
    expect(parts.ending).toContain('击败守钟机械，救回阿遥，最后把中央钟调回正向')
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '钟芯任务', 3)
    expect(spec.narrative!.ending).toContain('救回阿遥')
    expect(spec.narrative!.ending).toContain('中央钟调回正向')
  })
  it('keeps a short completed story conclusion out of the opening, retaining the full original', () => {
    const story = '阿禾是一名地图师，船队突然失踪。他必须修复灯塔。最后，他找回了船队，回到故乡开了一间地图铺。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '星潮', 3)
    expect(spec.narrative!.opening).toContain('船队突然失踪')
    expect(spec.narrative!.opening).not.toContain('地图铺')
    expect(spec.narrative!.ending).toContain('地图铺')
    expect(spec.narrative!.source.originalStory).toBe(story)
    const proposed = normalizeModelGameSpec({ narrative: { ending: '阿禾决定留在群岛，再也没有回到故乡。' } }, spec, 3, '')
    expect(proposed.narrative!.ending).toBe(spec.narrative!.ending)
    expect(pendingNarrativeSuggestions(proposed).some(item => item.path === 'ending')).toBe(true)
  })
  it('does not misread the last level as a conclusion or invent one from an unfinished brief', () => {
    const story = '骑士走进城堡寻找朋友。最后一关在钟楼，他必须找到钥匙才能继续。'
    expect(separateStoryIntroduction(story).ending).toBeUndefined()
    expect(separateStoryIntroduction('邮差带着信件出发。')).toEqual({ introduction: '邮差带着信件出发。' })
    expect(separateStoryIntroduction('邮差来到山间的旧驿站。最后的信件被突然出现的风鸦夺走。').ending).toBeUndefined()
  })
  it('does not append the conclusion again while extracting an incident from a single sentence', () => {
    const spec = createFallbackGameSpec('世界观与故事：阿禾是一名地图师，家乡的船队突然失踪，他决定寻找船队，最后他在灯塔下找到了船队并开了一间地图铺。', '星潮', 3)
    expect(spec.narrative!.opening).not.toContain('地图铺')
    expect(spec.narrative!.ending).toContain('地图铺')
  })
  it.each([
    '最终必须找回船队，否则港口将永远关闭。',
    '最终，他需要找到失踪的船队。',
    '最终目标是找回失踪的船队。',
    '最后，阿禾能否把船队带回港口？',
  ])('keeps an unresolved goal in the setup: %s', goal => {
    const story = `阿禾是一名地图师，故乡的船队在海雾中失踪。${goal}`
    const parts = separateStoryIntroduction(story)
    expect(parts.ending).toBeUndefined()
    expect(parts.introduction).toContain(goal)
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '雾海灯塔', 3)
    expect(spec.narrative!.source.originalStory).toBe(story)
    expect(spec.narrative!.ending).not.toBe(goal)
  })
  it('finds a later actual outcome after an earlier unresolved goal', () => {
    const story = '阿禾是一名地图师，船队在海雾中失踪。最终目标是找到船队。最后，他修好了灯塔，船队循着灯光回到了港口。'
    expect(separateStoryIntroduction(story)).toEqual({
      introduction: '阿禾是一名地图师，船队在海雾中失踪。最终目标是找到船队。',
      ending: '最后，他修好了灯塔，船队循着灯光回到了港口。',
    })
  })
  it('does not carry a failure warning into the successful local ending', () => {
    const story = '阿禾是一名地图师，故乡的船队在海雾中失踪。最终必须找回船队，否则港口将永远关闭。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '雾海灯塔', 3)
    expect(spec.narrative!.opening).toContain('否则港口将永远关闭')
    expect(spec.narrative!.ending).toContain('找回船队')
    expect(spec.narrative!.ending).not.toContain('否则')
    expect(spec.narrative!.source.originalStory).toBe(story)
  })
  it('preserves explicit endings and outcomes followed by a new wish', () => {
    const setup = '阿禾是一名地图师，故乡的船队在海雾中失踪。'
    const outcome = '最终，他找回了船队，希望以后再也没有人迷失在海雾里。'
    expect(separateStoryIntroduction(setup + outcome).ending).toBe(outcome)
    expect(separateStoryIntroduction(setup + '结局：他必须离开故乡，从此开始新的航行。').ending).toBe('结局：他必须离开故乡，从此开始新的航行。')
    const spec = createFallbackGameSpec(`世界观与故事：${setup}\n结局剧情：阿禾仍需寻找失踪的船队，故事以开放结局结束。`, '雾海灯塔', 3)
    expect(spec.narrative!.ending).toBe('阿禾仍需寻找失踪的船队，故事以开放结局结束。')
  })
  it('preserves explicit player opening text and multi-sentence outcomes', () => {
    const story = '城市的钟声突然停止，维修员独自寻找故障。最终，她恢复了供能。多年后，她仍记得这段旅程。'
    expect(separateStoryIntroduction(story).ending).toContain('多年后')
    const spec = createFallbackGameSpec(`世界观与故事：${story}\n开场剧情：玩家有意采用倒叙，先展示修复城市后的平静街道。`, '钟声', 3)
    expect(spec.narrative!.opening).toBe('玩家有意采用倒叙，先展示修复城市后的平静街道。')
  })
  it('recognizes a completed final sentence without a 最后 marker', () => {
    const story = '艾岚是一名失去听力的钟表匠，带着妹妹留下的黄铜怀表。城里的钟突然停了，妹妹失踪。艾岚追查旧钟楼，发现报时核心把居民困在城中。他修好核心，找到妹妹，兄妹在恢复钟声的广场重逢。'
    const parts = separateStoryIntroduction(story)
    expect(parts.introduction).not.toContain('广场重逢')
    expect(parts.ending).toContain('广场重逢')
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '钟坊归途', 3)
    expect(spec.narrative!.source.originalStory).toBe(story)
    expect(spec.narrative!.opening).not.toContain('广场重逢')
    expect(spec.narrative!.ending).toContain('广场重逢')
  })
  it('keeps a two-sentence synopsis outcome out of the opening', () => {
    const ice = '白狐在冰原寻找失踪的弟弟。它沿着脚印穿过雪松林，打败雪狼Boss，在洞穴里找到了弟弟。'
    const city = '小画家在未来都市寻找被偷走的画笔。她收集三块彩色芯片，战胜机器人Boss，夺回画笔，让整座城市重新出现颜色。'
    expect(separateStoryIntroduction(ice).introduction).not.toContain('找到了弟弟')
    expect(separateStoryIntroduction(ice).ending).toContain('打败雪狼Boss')
    expect(separateStoryIntroduction(city).introduction).not.toContain('重新出现颜色')
    expect(separateStoryIntroduction(city).ending).toContain('夺回画笔')
  })
})
