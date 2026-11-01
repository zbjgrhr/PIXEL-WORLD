import { selectedInspirationTexts } from '@/configs/inspiration-packs'
import type { AgentIssue, GameSpec } from '@/types'

/** Surface the player's chosen ideas during review without blocking valid paraphrases. */
export function inspectSelectedInspirations(sourcePrompt: string, spec: GameSpec): AgentIssue[] {
  const en = spec.creationLanguage === 'en'
  const reviewedText = [
    spec.world, spec.backgroundStory, spec.visualStyle.artDirection, spec.visualStyle.palette,
    spec.hero.appearance, spec.boss.appearance,
    ...spec.levels.map((level) => `${level.name} ${level.environment}`),
  ].join('\n')
  return selectedInspirationTexts(sourcePrompt).map((text, index) => {
    const retained = reviewedText.includes(text)
    return {
      id: `inspiration-${index}`,
      source: 'consistencyCritic',
      severity: retained ? 'info' : 'warning',
      path: 'creativeIntent.inspiration',
      message: en ? retained ? `Selected inspiration found in the game setting: ${text}` : `Check whether this selected inspiration is reflected in the game: ${text}` : retained ? `已在游戏设定中找到所选灵感：${text}` : `请核对所选灵感是否已体现在游戏中：${text}`,
      suggestion: en ? retained ? 'Review the actual levels and artwork before approving.' : 'The model may have paraphrased the idea. Review the story and levels; if it is missing, clarify the brief and plan again.' : retained ? '批准前仍可查看实际关卡和画面。' : '模型可能换了说法；请查看故事与关卡，若遗漏就在构想中补充后重新策划。',
    }
  })
}
