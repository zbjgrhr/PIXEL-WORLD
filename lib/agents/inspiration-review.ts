import { selectedInspirationTexts } from '@/configs/inspiration-packs'
import type { AgentIssue, GameSpec } from '@/types'

/** Surface the player's chosen ideas during review without blocking valid paraphrases. */
export function inspectSelectedInspirations(sourcePrompt: string, spec: GameSpec): AgentIssue[] {
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
      message: retained ? `已在游戏设定中找到所选灵感：${text}` : `请核对所选灵感是否已体现在游戏中：${text}`,
      suggestion: retained ? '批准前仍可查看实际关卡和画面。' : '模型可能换了说法；请查看故事与关卡，若遗漏就在构想中补充后重新策划。',
    }
  })
}
