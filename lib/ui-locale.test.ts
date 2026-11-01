import { describe, expect, it } from 'vitest'
import { englishUi, translateUiText, localizePromptFields, restorePromptFieldLabels } from './ui-locale'
import { buildStructuredPrompt } from './asset-catalog'

describe('English UI translation', () => {
  it('covers the previously omitted first-step workspace', () => {
    for (const text of ['尚未补全', '当前故事待补全', '先写游戏名称和故事', '名称与故事', '从故事模板开始（可选）', '选择故事模板', '游戏预览', '你的游戏会显示在这里', '✦ 使用说明']) {
      expect(translateUiText(text), text).toBeTruthy()
      expect(translateUiText(text), text).not.toMatch(/[\u3400-\u9fff]/)
    }
  })
  it('preserves dynamic counts and stage identity', () => {
    expect(translateUiText('第 1 步 · 当前操作')).toBe('Step 1 · Current task')
    expect(translateUiText('第 2 步 · AI 策划')).toBe('Step 2 · AI Planning')
    expect(translateUiText('45 张图片')).toBe('45 images')
    expect(translateUiText('3帧')).toBe('3 frames')
  })
  it('uses the exact button wording in its instructions', () => {
    expect(englishUi['点击“一键补全并优化提示词”。']).toContain(englishUi['一键补全并优化提示词'])
  })
  it('leaves unknown player-authored content untouched', () => {
    expect(translateUiText('小企鹅在日本找妈妈')).toBeUndefined()
  })
  it('round-trips structured headings without changing player-written values', () => {
    const source = buildStructuredPrompt(3) + '\n主角：小企鹅在日本找妈妈'
    const shown = localizePromptFields(source, 'en')
    expect(shown).toContain('小企鹅在日本找妈妈')
    expect(restorePromptFieldLabels(shown)).toBe(source)
  })
})
