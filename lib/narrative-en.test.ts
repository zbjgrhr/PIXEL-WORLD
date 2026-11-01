import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec, normalizeGameSpec } from './game-spec'
import { createNarrative, narrativeProblems, normalizeNarrative } from './narrative'
import { extractStoryAnchors } from './story-anchors'

const story = 'A little penguin travels through Japan to defeat monsters and a panda boss and find its mother.'
const prompt = `游戏标题：Penguin Homeward\n世界观与故事：${story}`
const make = () => createFallbackGameSpec(prompt, 'Penguin Homeward', 3, 'en')

describe('English rule-based narrative', () => {
  it('extracts the stated protagonist, place and boss without substituting a Chinese template story', () => {
    const anchors = extractStoryAnchors(story)
    expect(anchors.hero).toBe('little penguin')
    expect(anchors.place).toBe('Japan')
    expect(anchors.antagonist).toBe('panda')
    const spec = make()
    expect(spec.hero.name.toLowerCase()).toContain('penguin')
    expect(spec.boss.name.toLowerCase()).toContain('panda')
    expect(spec.narrative?.source.originalStory).toBe(story)
    expect(spec.narrative?.opening).toContain('Japan')
    expect(spec.narrative?.ending).toContain('mother')
    const generated = { ...spec.narrative, source: undefined }
    expect(JSON.stringify(generated)).not.toMatch(/[\u3400-\u9fff]/)
    expect(narrativeProblems(spec).filter(issue => issue.severity !== 'warning')).toEqual([])
    expect(extractStoryAnchors('little penguin in Japan defeats monsters and panda boss to find its mother.')).toMatchObject({ hero: 'little penguin', place: 'Japan', antagonist: 'panda' })
  })

  it('uses exact playable counts and dependencies and reserves reunion for the final ending', () => {
    const spec = make()
    const n = spec.narrative!
    expect(n.chapters).toHaveLength(3)
    n.chapters.forEach((chapter, i) => {
      const level = spec.levels[i]
      expect(chapter.levelId).toBe(level.id)
      expect(chapter.objectives.find(task => task.kind === 'defeat')?.count).toBe(level.enemyCount)
      expect(chapter.objectives.find(task => task.kind === 'collect')?.count).toBeLessThanOrEqual(level.collectibleCount)
      expect(chapter.objectives.at(-1)?.prerequisites).toEqual(chapter.objectives.slice(0, -1).map(task => task.id))
      expect(chapter.bossAfter).not.toMatch(/reunited|finds their mother/)
    })
    expect(n.ending).toMatch(/reunited/)
  })

  it('retains explicitly supplied opening and ending instead of replacing them with a generic success', () => {
    const spec = make()
    const end = 'The penguin finds its mother at the old harbor, and they sail home together.'
    const opening = 'A storm scatters the fishing boats across the bay.'
    const narrative = createNarrative(spec, `${prompt}\n开场剧情：${opening}\n结局剧情：${end}`, story)
    expect(narrative.opening).toBe(opening)
    expect(narrative.ending).toBe(end)
    const sad = 'A little penguin travels through Japan to find its mother. In the end, the penguin discovers that its mother has died.'
    const sadSpec = createFallbackGameSpec(`世界观与故事：${sad}`, 'The Last Letter', 3, 'en')
    expect(sadSpec.narrative!.ending).toContain('mother has died')
    expect(sadSpec.narrative!.ending).not.toContain('reunited')
    expect(sadSpec.narrative!.opening).not.toContain('mother has died')
  })

  it('uses English defaults for partial model chapter and character patches', () => {
    const spec = make()
    const narrative = normalizeNarrative({ characters: [{ id: 'companion' }], chapters: [{ levelId: 'level-1', points: [{ id: 'new-point' }], objectives: [{ id: 'new-task' }] }] }, spec)
    expect(narrative.characters[0].name).toBe('Unnamed character')
    expect(narrative.characters[0].role).toBe('Character')
    expect(narrative.chapters[0].points[0].name).toBe('Clue marker')
    expect(narrative.chapters[0].objectives[0].description).toBe('Unspecified objective')
    expect(narrative.chapters[0].objectives[0].feedback).toBe('Objective complete.')
  })

  it('keeps the chosen creation language through normalization and preserves Chinese legacy behavior', () => {
    const spec = make()
    const revised = normalizeGameSpec({ title: 'Penguin Homeward II' }, spec)
    expect(revised.creationLanguage).toBe('en')
    expect(revised.narrative?.opening).not.toMatch(/[\u3400-\u9fff]/)
    const chinese = createFallbackGameSpec('世界观与故事：小企鹅在日本打败熊猫boss，最后找到妈妈。', '小企鹅找妈妈', 3)
    expect(chinese.narrative?.opening).toMatch(/[\u3400-\u9fff]/)
    expect(chinese.hero.name).toContain('企鹅')
  })

  it('turns an explicit English count of repairs into real interaction tasks across the levels', () => {
    const input = 'A cartographer travels through the coastal islands to relight three lighthouses and find the missing fleet.'
    const spec = createFallbackGameSpec(`世界观与故事：${input}`, 'Lighthouse Route', 3, 'en')
    const tasks = spec.narrative!.chapters.flatMap(chapter => chapter.objectives).filter(task => task.id.includes('-story-action-'))
    expect(tasks).toHaveLength(3)
    expect(tasks.every(task => task.kind === 'interact' && task.count === 1)).toBe(true)
    expect(tasks[0].description).toContain('Relight Lighthouse 1')
    expect(tasks[2].description).toContain('Relight Lighthouse 3')
    expect(narrativeProblems(spec).filter(issue => issue.severity !== 'warning')).toEqual([])
  })

  it('keeps Chinese provenance without copying full Chinese fields into English generated prose', () => {
    const source = '小企鹅在日本世界打败所有怪物和熊猫boss，最后找到了自己的妈妈。'
    const spec = createFallbackGameSpec(`世界观与故事：${source}\n事件起因：暴风雨让船队失散。\n主角目标（可选）：寻找自己的妈妈`, '小企鹅找妈妈', 3, 'en')
    expect(spec.narrative!.source.originalStory).toBe(source)
    expect(spec.narrative!.source.playerFields['事件起因']).toBe('暴风雨让船队失散。')
    expect(spec.narrative!.source.playerFields['narrative.incitingIncident']).toBeUndefined()
    expect(spec.hero.name).toBe('Little Penguin')
    expect(spec.boss.name).toBe('Panda')
    expect(spec.narrative!.opening).not.toMatch(/[\u3400-\u9fff]/)
    expect(spec.narrative!.ending).toContain('mother')
    expect(spec.narrative!.ending).not.toMatch(/[\u3400-\u9fff]/)
  })
})
