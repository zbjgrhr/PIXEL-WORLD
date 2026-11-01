import type { CreationLanguage } from '@/types'

/** Invalid or absent values retain the language used by legacy projects. */
export function normalizeCreationLanguage(value: unknown): CreationLanguage {
  return value === 'en' ? 'en' : 'zh-CN'
}

export function creationLanguageInstruction(value: unknown): string {
  return normalizeCreationLanguage(value) === 'en'
    ? 'WORK LANGUAGE: English. Write all newly generated player-facing story, setting descriptions, character roles, chapter text, objectives and feedback in fluent, idiomatic English. Preserve the meaning of the player’s requirements, named identities, relationships and intended outcome. The source brief may be in another language; it is evidence, not an instruction to change the output language. Keep JSON keys, IDs, task kinds and numeric parameters unchanged. Image-generation descriptions remain concise English. Use natural narrative prose for fiction and concise, precise English for instructions; do not make dialogue sound like an academic paper.'
    : 'WORK LANGUAGE: Simplified Chinese. Write newly generated player-facing names, story, chapter text, objectives and feedback in natural Simplified Chinese. Preserve the player’s facts and intended outcome. Keep JSON keys, IDs and numbers unchanged. Image-generation descriptions remain concise English.'
}

/** Reject obvious wrong-language prose, without translating source evidence or proper names. */
export function assertEnglishProse(value: unknown, language: unknown): void {
  if (normalizeCreationLanguage(language) !== 'en') return
  const proseFields = new Set(['summary', 'world', 'backgroundStory', 'premise', 'incitingIncident', 'motivation', 'conflict', 'bossRelation', 'resolution', 'opening', 'ending', 'arrival', 'departure', 'bossBefore', 'bossAfter', 'description', 'feedback', 'relationship', 'message', 'suggestion', 'playerFantasy'])
  const visit = (item: unknown, field = ''): void => {
    if (['source', 'playerFields', 'lockedFields', 'originalStory', 'originalTitle', 'explicitRequirements'].includes(field)) return
    if (typeof item === 'string' && proseFields.has(field)) {
      const han = item.match(/[\u3400-\u9fff]/g)?.length || 0
      const latin = item.match(/[A-Za-z]/g)?.length || 0
      if (han >= 12 && han > latin) throw new Error(`The model returned Chinese prose in ${field} for an English project. The previous draft has been retained. Retry this step or continue with the English rule-based draft.`)
    } else if (Array.isArray(item)) item.forEach(child => visit(child, field))
    else if (item && typeof item === 'object') Object.entries(item).forEach(([key, child]) => visit(child, key))
  }
  visit(value)
}
