import type { PromptTemplate } from '@/configs/prompt-templates'
import { buildStructuredPrompt } from './asset-catalog'

export type TemplateMode = 'story' | 'complete'

/** Story-only selection deliberately clears old detailed requirements. */
export function templateSelection(template: PromptTemplate, mode: TemplateMode) {
  return {
    title: template.themeName,
    story: template.prompt.match(/^背景故事：\s*(.+)$/m)?.[1]?.trim() || '',
    levelCount: template.levelCount,
    prompt: mode === 'complete' ? template.prompt : buildStructuredPrompt(template.levelCount),
  }
}
