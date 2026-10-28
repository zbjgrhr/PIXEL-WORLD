import type { GameSpec } from '@/types'
import { normalizeGameSpec, preserveExplicitPromptFields } from './game-spec'
import { stabilizeGameSpec } from './game-spec-guardrails'
import { stageNarrativeSuggestions } from './narrative-suggestions'

/** Repair separator-only ID drift, never guess a different chapter by position. */
function modelReferences(value: unknown, previous: GameSpec): unknown {
  const known = [...new Set([
    ...previous.levels.map(level => level.id),
    ...previous.narrative?.chapters.flatMap(chapter => [...chapter.points, ...chapter.objectives].map(item => item.id)) || [],
  ])]
  const resolve = (id: unknown) => {
    if (typeof id !== 'string' || known.includes(id)) return id
    const matches = known.filter(existing => existing.replace(/_/g, '-') === id.replace(/_/g, '-'))
    return matches.length === 1 ? matches[0] : id
  }
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key,
      ['id', 'levelId', 'payoffLevelId', 'target'].includes(key) ? resolve(entry)
        : ['levelIds', 'prerequisites'].includes(key) && Array.isArray(entry) ? entry.map(resolve)
          : walk(entry),
    ]))
  }
  return walk(value)
}

/** Read attempted edits before enforcing locks, so rejected wording can be reviewed. */
export function normalizeModelGameSpec(candidate: unknown, previous: GameSpec, levelCount: number, sourcePrompt: string): GameSpec {
  const baseline = previous.narrative ? { ...previous, narrative: { ...previous.narrative, source: { ...previous.narrative.source, lockedFields: {} } } } : previous
  const corrected = modelReferences(candidate, previous)
  const raw = corrected && typeof corrected === 'object' && !Array.isArray(corrected) ? corrected as Record<string, unknown> : {}
  const narrative = raw.narrative && typeof raw.narrative === 'object' ? raw.narrative as Record<string, unknown> : {}
  const characters = Array.isArray(narrative.characters) ? narrative.characters : []
  const patch = { ...raw }
  const narrativePatch = { ...narrative }
  const mergeNarrativeItems = <T extends { id: string }>(prior: T[] | undefined, candidate: unknown, required: string[]): unknown => {
    if (!Array.isArray(candidate) || !prior) return candidate
    const updates = candidate.filter(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string') as Array<Record<string, unknown>>
    return [
      ...prior.map(item => ({ ...item, ...(updates.find(update => update.id === item.id) || {}) })),
      ...updates.filter(item => !prior.some(old => old.id === item.id) && required.every(key => typeof item[key] === 'string' && String(item[key]).trim())),
    ]
  }
  if (Array.isArray(narrative.clues)) narrativePatch.clues = mergeNarrativeItems(baseline.narrative?.clues, narrative.clues, ['id', 'setup', 'payoff', 'levelId', 'payoffLevelId'])
  if (Array.isArray(narrative.characters)) narrativePatch.characters = mergeNarrativeItems(baseline.narrative?.characters, narrative.characters, ['id', 'name', 'role', 'motivation', 'relationship'])
  if (Object.keys(narrativePatch).length) patch.narrative = narrativePatch
  // Model revisions are patches. Editing one task's wording must not remove
  // the other objectives, exit prerequisites or interaction points.
  if (Array.isArray(narrative.chapters)) patch.narrative = { ...narrativePatch, chapters: narrative.chapters.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const chapter = value as Record<string, unknown>
    const prior = baseline.narrative?.chapters.find(item => item.levelId === chapter.levelId)
    if (!prior) return chapter
    const merged = { ...chapter }
    for (const field of ['points', 'objectives'] as const) {
      if (!Array.isArray(chapter[field])) continue
      const updates = chapter[field] as Array<Record<string, unknown>>
      const valid = updates.filter(item => item && typeof item === 'object' && !Array.isArray(item))
      merged[field] = [
        ...prior[field].map((item, index) => ({ ...item, ...(valid.find(update => update.id === item.id) || (!valid.some(update => update.id) ? valid[index] : undefined)) })),
        ...valid.filter(item => typeof item.id === 'string' && !prior[field].some(old => old.id === item.id)),
      ]
    }
    return merged
  }) }
  for (const id of ['hero', 'boss'] as const) {
    const entity = raw[id] && typeof raw[id] === 'object' ? raw[id] as Record<string, unknown> : {}
    const character = characters.find(c => c && typeof c === 'object' && (c.id === id || (id === 'hero' ? /主角|protagonist|^hero$/i : /boss|最终对手|反派|最终首领/i).test(String(c.role))))
    if (!entity.name && typeof character?.name === 'string' && character.name.trim()) patch[id] = { ...entity, name: character.name }
  }
  const normalized = preserveExplicitPromptFields(stabilizeGameSpec(normalizeGameSpec(patch, baseline, levelCount)), baseline, sourcePrompt)
  const staged = stageNarrativeSuggestions(previous, normalized)
  return { ...staged, world: previous.narrative?.source.lockedFields.world ?? staged.world }
}
