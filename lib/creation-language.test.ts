import { describe, expect, it } from 'vitest'
import { assertEnglishProse, normalizeCreationLanguage } from './creation-language'
import { getPromptTemplates } from '@/configs/prompt-templates'
import { createFallbackGameSpec, normalizeGameSpec } from './game-spec'
import { normalizeModelGameSpec } from './model-game-spec'
import { selectedInspirationTexts } from '@/configs/inspiration-packs'

describe('creation language contracts', () => {
  it('keeps legacy language stable and rejects model attempts to change the work language', () => {
    expect(normalizeCreationLanguage(undefined)).toBe('zh-CN')
    const en = createFallbackGameSpec('A penguin travels through Japan to find its mother.', 'Homeward', 3, 'en')
    expect(normalizeGameSpec({ creationLanguage: 'zh-CN' }, en).creationLanguage).toBe('en')
  })

  it('provides English starter content, not just English menu labels', () => {
    for (const template of getPromptTemplates('en')) {
      const spec = createFallbackGameSpec(template.prompt, template.themeName, template.levelCount, 'en')
      expect(spec.creationLanguage).toBe('en')
      expect(spec.levels).toHaveLength(template.levelCount)
      const prose = { ...spec.narrative, source: undefined }
      expect(JSON.stringify(prose), template.id).not.toMatch(/[\u3400-\u9fff]/)
      expect(spec.narrative!.ending).toBeTruthy()
      expect(spec.assets.some(asset => asset.category === 'hero' && asset.enabled)).toBe(true)
    }
  })

  it('keeps English inspirations visible to Agents without losing character identity', () => {
    const idea = 'The islands slowly rise and fall with the tides.'
    const story = `A little penguin travels through Japan to defeat a panda boss and find its mother.\n【已选灵感】${idea}。`
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, 'Homeward', 3, 'en')
    expect(selectedInspirationTexts(story)).toContain(idea)
    expect(spec.hero.appearance).toMatch(/penguin/i)
    expect(spec.boss.appearance).toMatch(/panda/i)
  })

  it('allows model English adaptation of a new Chinese brief while keeping explicit locks', () => {
    const story = '小企鹅在日本寻找自己的妈妈，最后击败熊猫boss后与妈妈团聚。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, 'Homeward', 3, 'en')
    spec.narrative!.source.lockedFields.motivation = 'Pip wants to find his mother.'
    spec.narrative!.motivation = 'Pip wants to find his mother.'
    const next = normalizeModelGameSpec({ narrative: {
      opening: 'A little penguin follows a note through the fields of Japan, hoping to find its mother.',
      motivation: 'Pip wants to conquer the world.',
      ending: 'After defeating the panda, the little penguin finds its mother and returns home with her.',
    } }, spec, 3, '')
    expect(next.narrative!.opening).toContain('follows a note')
    expect(next.narrative!.ending).toContain('returns home')
    expect(next.narrative!.motivation).toBe('Pip wants to find his mother.')
    expect(next.narrative!.source.originalStory).toBe(story)
  })

  it('detects clear wrong-language prose without rejecting a named Chinese character or source evidence', () => {
    expect(() => assertEnglishProse({ narrative: { opening: '小企鹅离开村庄，穿过竹林，准备寻找自己失踪的母亲。' } }, 'en')).toThrow(/Chinese prose/)
    expect(() => assertEnglishProse({ hero: { name: '阿澜' }, narrative: { opening: '阿澜 follows a trail toward the lighthouse.', source: { originalStory: '原始中文故事完整保留在这里，不应该因为原文含中文而被拒收。' } } }, 'en')).not.toThrow()
  })
})
