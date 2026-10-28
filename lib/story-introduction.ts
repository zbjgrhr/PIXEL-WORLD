/** Keep the player's full story in provenance; do not reveal its ending at entry. */
export function separateStoryIntroduction(story: string): { introduction: string; ending?: string } {
  const conclusion = /(?:^|[。！？\n]|[，,])\s*((?:最后(?!的|一(?:关|个|段|座|次|名|件|张))|最终|从此|自此|结局[是为：:])[^。！？\n]{4,})/g
  let endingAt = -1
  for (const match of story.matchAll(conclusion)) {
    // A final objective or open question still belongs to the setup. Inspect
    // its first clause so a later wish cannot erase an already stated outcome.
    if (/^(?:最后|最终)/.test(match[1])) {
      const firstClause = match[1].replace(/^(?:最后|最终)[，,\s]*/, '').split(/[，,]/)[0]
      if (/(?:目标|任务|愿望)(?:是|为|[：:])|必须|需要|想要|希望|打算|计划|能否|是否|只有|才能/.test(firstClause)) continue
    }
    const start = match.index! + match[0].indexOf(match[1])
    if (start >= 12) { endingAt = start; break }
  }
  if (endingAt < 0) {
    const sentences = [...story.matchAll(/[^。！？\n]+[。！？]?/g)]
    const last = sentences.at(-1)
    const finalSentence = last?.[0].trim() || ''
    const resolvedAfterCombat = sentences.length >= 2
      ? finalSentence.match(/[，,]\s*(?:打败|击败|战胜)[^。！？]{0,80}(?:找到了?|夺回|救出了?|交给|回到|重新)/)
      : null
    if (last && last.index !== undefined && resolvedAfterCombat?.index !== undefined) {
      endingAt = last.index + resolvedAfterCombat.index + resolvedAfterCombat[0].match(/^[，,]\s*/)?.[0].length!
    }
    if (sentences.length >= 3 && last && last.index !== undefined
      && endingAt < 0
      && /(?:修好|修复了|打败了?|击败了?|战胜了?|找到了?|救出了?|放走|释放了?|调回|重新响起|重逢|回到|归来|恢复了?)/.test(finalSentence)
      && !/(?:必须|想要|希望|需要|决定|为了|如果|否则|能否|是否|计划|目标是)/.test(finalSentence)) {
      endingAt = last.index
    }
  }
  // A last-clause marker can follow an already completed rescue in the same
  // sentence. Keep that rescue (and its immediate Boss victory) in the ending.
  if (endingAt >= 0) {
    const previousStop = Math.max(story.lastIndexOf('。', endingAt - 1), story.lastIndexOf('！', endingAt - 1), story.lastIndexOf('？', endingAt - 1), story.lastIndexOf('\n', endingAt - 1))
    const beforeEnding = story.slice(previousStop + 1, endingAt)
    const outcome = beforeEnding.match(/(?:击败|打败|战胜)[^。！？]{0,50}(?:救回|救出|找回|放走)[^，,。！？]{1,12}[，,]?\s*$/)
      || beforeEnding.match(/(?:救回|救出|找回|放走)[^，,。！？]{1,12}[，,]?\s*$/)
    if (outcome && outcome.index !== undefined) endingAt = previousStop + 1 + outcome.index
  }
  const setup = (endingAt >= 0 ? story.slice(0, endingAt) : story).trim().replace(/[，,]$/, '。')
  const sentences = setup.match(/[^。！？\n]+[。！？]?/g) || []
  // The opening establishes the situation. The full synopsis remains available
  // for editing, and later discoveries belong to chapters rather than the intro.
  const introduction = sentences.length > 2 ? sentences.slice(0, 2).join('') : setup
  return { introduction: introduction.trim(), ...(endingAt >= 0 ? { ending: story.slice(endingAt).trim() } : {}) }
}
