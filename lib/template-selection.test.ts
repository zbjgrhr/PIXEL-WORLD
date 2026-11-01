import { describe, expect, it } from 'vitest'
import { getPromptTemplates } from '@/configs/prompt-templates'
import { templateSelection } from './template-selection'

describe('template selection', () => {
  for (const language of ['zh-CN', 'en'] as const) {
    it(`applies story-only and complete settings safely in ${language}`, () => {
      for (const template of getPromptTemplates(language)) {
        const storyOnly = templateSelection(template, 'story')
        const complete = templateSelection(template, 'complete')
        expect(storyOnly.story.length).toBeGreaterThan(50)
        expect(storyOnly.levelCount).toBe(template.levelCount)
        expect(storyOnly.title).toBe(template.themeName)
        expect(complete.prompt).toBe(template.prompt)
        expect(storyOnly.prompt).not.toContain(storyOnly.story)
        expect(storyOnly.prompt).not.toBe(complete.prompt)
        expect(storyOnly.story).toBe(complete.story)
      }
    })
  }
})
