const TITLE_LABELS = new Set(['游戏标题', 'gametitle'])
const STORY_LABELS = new Set(['世界观与故事', '世界观', 'world', '背景故事', 'backgroundstory', 'story'])

function normalizedLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

/** The separate player brief wins over stale or empty fields in the editor. */
export function mergeProjectBrief(prompt: string, title: string, story: string): string {
  const lockedTitle = title.trim()
  const lockedStory = story.trim()
  if (!lockedTitle && !lockedStory) return prompt.trim()

  const lines: string[] = []
  let skipContinuation = false
  for (const line of prompt.split(/\r?\n/)) {
    const field = line.trim().match(/^([^:：]{1,80})\s*[:：]/)
    if (field) {
      const label = normalizedLabel(field[1])
      skipContinuation = Boolean((lockedTitle && TITLE_LABELS.has(label)) || (lockedStory && STORY_LABELS.has(label)))
    } else if (!line.trim()) {
      skipContinuation = false
    }
    if (!skipContinuation) lines.push(line)
  }

  const retained = lines.join('\n').trim()
  const firstLevel = retained.search(/^\s*(?:LEVEL|关卡)\s*\d+\s*[:：]/im)
  const globalFields = firstLevel >= 0 ? retained.slice(0, firstLevel).trim() : retained
  const levels = firstLevel >= 0 ? retained.slice(firstLevel).trim() : ''
  return [
    globalFields,
    ...(lockedTitle ? [`游戏标题：${lockedTitle}`] : []),
    ...(lockedStory ? [`世界观与故事：${lockedStory}`, `背景故事：${lockedStory}`] : []),
    levels,
  ].filter(Boolean).join('\n\n').trim()
}
