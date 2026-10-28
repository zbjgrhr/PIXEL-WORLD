import type { GameSpec, NarrativeSpec, NarrativeSuggestion } from '@/types'
import { recordNarrativeEdit, replaceNarrativeReference } from './narrative-editing'
import { separateStoryIntroduction } from './story-introduction'
import { extractStoryAnchors } from './story-anchors'

const GLOBAL_LABELS = { premise: '故事概念', incitingIncident: '事件起因', motivation: '主角动机', conflict: '主要冲突', bossRelation: 'Boss 与故事的关系', resolution: '结局方向', opening: '开场剧情', ending: '通关结局' }
const VISUAL_IDENTITIES: Array<[RegExp, RegExp]> = [
  [/企鹅/, /企鹅|penguin/i], [/狐狸/, /狐狸|fox/i], [/小猫|猫咪/, /猫|\bcat\b|kitten/i],
  [/兔/, /兔|rabbit|bunny/i], [/熊猫/, /熊猫|panda/i], [/蝎子/, /蝎子|scorpion/i],
  [/陨石/, /陨石|meteor|asteroid/i],
]
function changedVisualIdentity(name: string | undefined, description: string): boolean {
  const identity = VISUAL_IDENTITIES.find(([pattern]) => pattern.test(name || ''))
  return Boolean(identity && !identity[1].test(description))
}
type TextField = { value: string; label: string; write: (n: NarrativeSpec, value: string) => NarrativeSpec }

/** Only these text paths may be proposed. IDs and executable task conditions are never arbitrary paths. */
function textFields(n: NarrativeSpec): Map<string, TextField> {
  const fields = new Map<string, TextField>()
  for (const [key, label] of Object.entries(GLOBAL_LABELS)) fields.set(key, { value: n[key as keyof typeof GLOBAL_LABELS], label, write: (next, value) => ({ ...next, [key]: value }) })
  n.characters.forEach(character => {
    for (const key of ['name', 'motivation', 'relationship'] as const) fields.set(`characters.${character.id}.${key}`, { value: character[key], label: `${character.role} · ${{ name: '姓名', motivation: '动机', relationship: '人物关系' }[key]}`, write: (next, value) => ({ ...next, characters: next.characters.map(item => item.id === character.id ? { ...item, [key]: value } : item) }) })
  })
  n.clues.forEach((clue, index) => {
    for (const key of ['setup', 'payoff'] as const) fields.set(`clues.${clue.id}.${key}`, { value: clue[key], label: `线索 ${index + 1} · ${key === 'setup' ? '铺垫' : '回应'}`, write: (next, value) => ({ ...next, clues: next.clues.map(item => item.id === clue.id ? { ...item, [key]: value } : item) }) })
  })
  n.chapters.forEach((chapter, index) => {
    const prefix = `chapters.${chapter.levelId}`
    for (const key of ['title', 'arrival', 'departure', 'bossBefore', 'bossAfter'] as const) fields.set(`${prefix}.${key}`, { value: chapter[key], label: `第 ${index + 1} 关 · ${{ title: '章节标题', arrival: '进入关卡', departure: '完成本关', bossBefore: 'Boss 战前', bossAfter: 'Boss 战后' }[key]}`, write: (next, value) => ({ ...next, chapters: next.chapters.map(item => item.levelId === chapter.levelId ? { ...item, [key]: value } : item) }) })
    for (const kind of ['points', 'objectives'] as const) {
      for (const item of chapter[kind]) {
        const keys = kind === 'points' ? ['name', 'description'] : ['description', 'feedback']
        for (const key of keys) fields.set(`${prefix}.${kind}.${item.id}.${key}`, {
          value: (item as unknown as Record<string, string>)[key], label: `第 ${index + 1} 关 · ${kind === 'points' ? '交互点' : '任务'} · ${{ name: '名称', description: '说明', feedback: '完成反馈' }[key]}`,
          write: (next, value) => ({ ...next, chapters: next.chapters.map(c => c.levelId === chapter.levelId ? { ...c, [kind]: c[kind].map(o => o.id === item.id ? { ...o, [key]: value } : o) } : c) }),
        })
      }
    }
  })
  return fields
}

function suggestionId(path: string, before: string, after: string): string {
  const text = JSON.stringify([path, before, after])
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `proposal-${(hash >>> 0).toString(36)}`
}

/** Persisted decisions are bounded; a model response never supplies trusted decisions. */
export function normalizeNarrativeSuggestions(value: unknown, narrative: NarrativeSpec): NarrativeSuggestion[] {
  if (!Array.isArray(value)) return []
  const fields = textFields(narrative), seen = new Set<string>()
  return value.slice(-120).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.path !== 'string' || !fields.has(item.path) || typeof item.before !== 'string' || typeof item.after !== 'string' || !item.after.trim() || item.before === item.after) return []
    const before = item.before.slice(0, 12000), after = item.after.slice(0, 12000), id = suggestionId(item.path, before, after)
    if (seen.has(id)) return []
    seen.add(id)
    const status = item.status === 'accepted' || item.status === 'dismissed' || item.status === 'stale' ? item.status : 'pending'
    return [{ id, path: item.path, label: fields.get(item.path)!.label, before, after, reason: typeof item.reason === 'string' ? item.reason.slice(0, 300) : '这项建议涉及你已确定的设定，请决定是否修改。', status } as NarrativeSuggestion]
  })
}

function preserveRecords(previous: NarrativeSpec, candidate: NarrativeSpec, protectedPaths: Set<string>): NarrativeSpec {
  const keep = <T extends { id: string }>(old: T[], next: T[], prefix: string): T[] => [...next, ...old.filter(item => !next.some(other => other.id === item.id) && [...protectedPaths].some(path => path.startsWith(`${prefix}.${item.id}.`)))]
  return { ...candidate, characters: keep(previous.characters, candidate.characters, 'characters'), clues: keep(previous.clues, candidate.clues, 'clues'), chapters: candidate.chapters.map(chapter => {
    const old = previous.chapters.find(item => item.levelId === chapter.levelId)
    return old ? { ...chapter, points: keep(old.points, chapter.points, `chapters.${chapter.levelId}.points`), objectives: keep(old.objectives, chapter.objectives, `chapters.${chapter.levelId}.objectives`) } : chapter
  }) }
}

/** At a model boundary, keep authored facts active and stage conflicting wording for the player. */
export function stageNarrativeSuggestions(previous: GameSpec, candidate: GameSpec): GameSpec {
  const before = previous.narrative
  if (!before || !candidate.narrative) return candidate
  const protectedPaths = new Set(Object.keys(before.source.lockedFields))
  for (const [key, value] of Object.entries(before.source.playerFields)) if (key.startsWith('narrative.') && value.trim()) protectedPaths.add(key.slice('narrative.'.length))
  const original = before.source.originalStory.split('【已选灵感】')[0].trim()
  if (original.length > 160 || separateStoryIntroduction(original).ending) Object.keys(GLOBAL_LABELS).forEach(path => protectedPaths.add(path))
  let narrative = preserveRecords(before, { ...candidate.narrative, source: { ...before.source, origin: 'model' } }, protectedPaths)
  const proposals = normalizeNarrativeSuggestions(before.suggestions, before)
  const added = new Set<string>()
  const oldFields = textFields(before), newFields = textFields(narrative)
  const aliases: Array<[string, string]> = []
  for (const path of protectedPaths) {
    const old = oldFields.get(path), next = newFields.get(path)
    if (!old || !next || old.value === next.value) continue
    if (next.value.trim()) {
      const id = suggestionId(path, old.value, next.value)
      if (!proposals.some(item => item.id === id)) {
        proposals.push({ id, path, label: old.label, before: old.value, after: next.value, status: 'pending', reason: path in before.source.lockedFields ? '模型建议改动已锁定原文；采用后会更新这项锁定。' : '模型建议改动你已填写的设定；未采用前继续使用原文。' })
        added.add(id)
      }
    }
    narrative = next.write(narrative, old.value)
    if (/^characters\.[^.]+\.name$/.test(path)) aliases.push([next.value, old.value])
  }
  for (const [from, to] of aliases) narrative = replaceNarrativeReference(narrative, from, to)
  const reconciled = proposals.map(item => added.has(item.id) && !/^characters\.[^.]+\.name$/.test(item.path) ? { ...item, after: aliases.reduce((text, [from, to]) => from ? text.split(from).join(to) : text, item.after) } : item)
  narrative = { ...narrative, suggestions: normalizeNarrativeSuggestions(reconciled, narrative) }
  const hero = narrative.characters.find(c => c.id === 'hero'), boss = narrative.characters.find(c => c.id === 'boss')
  const place = extractStoryAnchors(before.source.originalStory).place?.replace(/世界$/, '')
  const world = place && !candidate.world.includes(place) ? previous.world : candidate.world
  const keepHeroArt = changedVisualIdentity(extractStoryAnchors(before.source.originalStory).hero, candidate.hero.appearance)
  const keepBossArt = changedVisualIdentity(extractStoryAnchors(before.source.originalStory).antagonist, candidate.boss.appearance)
  const assets = keepHeroArt || keepBossArt ? candidate.assets.map(asset => {
    const rejected = asset.category === 'hero' ? keepHeroArt : asset.category === 'boss' ? keepBossArt : false
    if (!rejected || asset.url) return asset
    const prior = previous.assets.find(item => item.id === asset.id) || previous.assets.find(item => item.category === asset.category)
    return { ...asset, prompt: prior?.prompt || (asset.category === 'hero' ? previous.hero.appearance : previous.boss.appearance) }
  }) : candidate.assets
  return { ...candidate, world, hero: hero ? { ...candidate.hero, name: hero.name, appearance: keepHeroArt ? previous.hero.appearance : candidate.hero.appearance } : candidate.hero, boss: boss ? { ...candidate.boss, name: boss.name, appearance: keepBossArt ? previous.boss.appearance : candidate.boss.appearance } : candidate.boss, assets, narrative, backgroundStory: narrative.opening }
}

export function narrativeSuggestionStatus(narrative: NarrativeSpec, suggestion: NarrativeSuggestion): NarrativeSuggestion['status'] {
  return suggestion.status === 'pending' && textFields(narrative).get(suggestion.path)?.value !== suggestion.before ? 'stale' : suggestion.status
}

export function pendingNarrativeSuggestions(spec?: GameSpec | null): NarrativeSuggestion[] {
  const n = spec?.narrative
  return n ? (n.suggestions || []).filter(item => narrativeSuggestionStatus(n, item) === 'pending') : []
}

export function carryPendingNarrativeSuggestions(spec: GameSpec, value: unknown): GameSpec {
  if (!spec.narrative || !Array.isArray(value)) return spec
  const existing = normalizeNarrativeSuggestions(spec.narrative.suggestions, spec.narrative)
  const incoming = normalizeNarrativeSuggestions(value.map(item => item && typeof item === 'object' ? { ...item, status: 'pending' } : item), spec.narrative)
  return { ...spec, narrative: { ...spec.narrative, suggestions: [...existing, ...incoming.filter(item => !existing.some(old => old.id === item.id))].slice(-120) } }
}

export function decideNarrativeSuggestion(spec: GameSpec, id: string, decision: 'accepted' | 'dismissed'): GameSpec {
  const n = spec.narrative, proposal = n?.suggestions?.find(item => item.id === id)
  if (!n || !proposal || proposal.status !== 'pending') return spec
  const status = narrativeSuggestionStatus(n, proposal)
  let next = n
  if (status === 'pending' && decision === 'accepted') {
    next = recordNarrativeEdit(n, proposal.path, proposal.after)
    next = textFields(next).get(proposal.path)!.write(next, proposal.after)
    if (/^characters\.[^.]+\.name$/.test(proposal.path)) next = replaceNarrativeReference(next, proposal.before, proposal.after)
  }
  next = { ...next, suggestions: n.suggestions!.map(item => item.id === id ? { ...item, status: status === 'stale' ? 'stale' : decision } : item) }
  const changed = status === 'pending' && decision === 'accepted'
  return { ...spec, narrative: next, ...(changed ? { backgroundStory: next.opening, hero: { ...spec.hero, name: next.characters.find(c => c.id === 'hero')?.name || spec.hero.name }, boss: { ...spec.boss, name: next.characters.find(c => c.id === 'boss')?.name || spec.boss.name } } : {}) }
}

/** Decisions alone must not revoke approval or discard successful Agent work. */
export function sameSpecExceptSuggestions(before: GameSpec, after: GameSpec): boolean {
  const content = (spec: GameSpec) => JSON.stringify({ ...spec, narrative: spec.narrative ? { ...spec.narrative, suggestions: undefined } : undefined })
  return content(before) === content(after)
}
