import type { GameSpec, StoryObjective } from '@/types'

export interface StoryEntry { id: string; title: string; text: string; levelId: string }
export interface StoryProgress {
  version: 1
  storyKey: string
  levelId: string
  counts: Record<string, number>
  events: string[]
  facts?: StoryEvent[]
  history: StoryEntry[]
  completedLevels: string[]
  openingSeen: boolean
  endingSeen: boolean
}
export interface StoryEvent { id: string; kind: StoryObjective['kind'] | 'boss-approach'; target: string; levelId: string }

/** Self-contained so the exact same task semantics can run in a downloaded ZIP. */
export function createNarrativeEngine() {
  const keyCache = new WeakMap<GameSpec, string>()
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, item]) => [name, canonical(item)])) : value
  const chapter = (spec: GameSpec, levelId: string) => spec.narrative?.chapters.find(item => item.levelId === levelId)
  const key = (spec: GameSpec) => {
    const cached = keyCache.get(spec)
    if (cached) return cached
    // Provenance and editorial decisions do not change the playable story.
    const narrative = spec.narrative ? { ...spec.narrative, source: undefined, suggestions: undefined } : undefined
    // Restored actors contain health, damage, movement and spawn state. They are
    // valid only for the same gameplay rules, even when the story is unchanged.
    // Exclude image bytes/URLs and editing metadata so replacing finished art
    // does not erase progress. Obstacle image availability does affect spawns.
    const spawnAssets = spec.assets.filter(asset => ['groundEnemy', 'airEnemy', 'waterEnemy', 'normalObstacle', 'bounceObstacle', 'deathObstacle'].includes(asset.category))
      .map(asset => [asset.id, asset.category, asset.enabled, asset.levelIds, asset.motion?.mobility, ['normalObstacle', 'bounceObstacle', 'deathObstacle'].includes(asset.category) ? Boolean(asset.url) : undefined])
    const value = JSON.stringify(canonical([
      spec.title, narrative,
      [spec.hero.maxHealth, spec.hero.moveSpeed, spec.hero.jumpPower],
      [spec.weapon.mode, spec.weapon.meleeDamage, spec.weapon.rangedDamage, spec.weapon.cooldownMs, spec.weapon.projectileSpeed],
      spec.enemies.map((enemy, index) => [enemy.health, enemy.damage, enemy.speed, enemy.behavior, enemy.category || ['groundEnemy', 'airEnemy', 'waterEnemy'][index], enemy.assetId]),
      [spec.boss.health, spec.boss.damage, spec.boss.speed],
      [spec.collectible.effect, spec.collectible.value],
      spec.levels.map(level => [level.id, level.enemyCount, level.collectibleCount, level.hasBoss, level.platformMode]),
      spawnAssets,
    ]))
    let hash = 2166136261
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
    const result = `story-1-${(hash >>> 0).toString(36)}`
    keyCache.set(spec, result)
    return result
  }
  const fresh = (spec: GameSpec, levelId = spec.levels[0]?.id || ''): StoryProgress => ({ version: 1, storyKey: key(spec), levelId, counts: {}, events: [], facts: [], history: [], completedLevels: [], openingSeen: false, endingSeen: false })
  const restore = (spec: GameSpec, value: unknown): StoryProgress => {
    const raw = value as Partial<StoryProgress> | null
    if (!raw || raw.version !== 1 || raw.storyKey !== key(spec) || !spec.levels.some(level => level.id === raw.levelId)) return fresh(spec)
    const counts: Record<string, number> = {}
    spec.narrative?.chapters.forEach(c => c.objectives.forEach(o => { counts[o.id] = Math.min(o.count, Math.max(0, Math.floor(Number(raw.counts?.[o.id]) || 0))) }))
    return { ...fresh(spec, raw.levelId), counts, facts: Array.isArray(raw.facts) ? raw.facts.filter(fact => fact && typeof fact.id === 'string' && typeof fact.kind === 'string' && typeof fact.target === 'string' && spec.levels.some(level => level.id === fact.levelId)).slice(-3000) : [], events: Array.isArray(raw.events) ? raw.events.filter(v => typeof v === 'string').slice(-3000) : [], history: Array.isArray(raw.history) ? raw.history.filter(v => v && typeof v.id === 'string' && typeof v.text === 'string' && typeof v.title === 'string').slice(-250) : [], completedLevels: Array.isArray(raw.completedLevels) ? raw.completedLevels.filter(id => spec.levels.some(level => level.id === id)) : [], openingSeen: raw.openingSeen === true, endingSeen: raw.endingSeen === true }
  }
  const record = (state: StoryProgress, entry: StoryEntry): StoryProgress => !entry.text || state.history.some(item => item.id === entry.id) ? state : { ...state, history: [...state.history, entry].slice(-250) }
  const discoverClues = (spec: GameSpec, state: StoryProgress): StoryProgress => {
    for (const clue of spec.narrative?.clues || []) if (clue.levelId === state.levelId) state = record(state, { id: `clue:${clue.id}:setup`, title: '发现线索', text: clue.setup, levelId: state.levelId })
    return state
  }
  const complete = (state: StoryProgress, objective: StoryObjective) => (state.counts[objective.id] || 0) >= objective.count
  const eligible = (state: StoryProgress, objective: StoryObjective, objectives: StoryObjective[]) => objective.prerequisites.every(id => {
    const required = objectives.find(item => item.id === id)
    return Boolean(required && complete(state, required))
  })
  const begin = (spec: GameSpec, previous: StoryProgress, levelId: string, retry = false): StoryProgress => {
    let state = previous.storyKey === key(spec) ? { ...previous, levelId } : fresh(spec, levelId)
    const plan = chapter(spec, levelId)
    if (!plan) return state
    if (retry) {
      const ids = new Set(plan.objectives.map(o => o.id))
      state = { ...state, counts: Object.fromEntries(Object.entries(state.counts).filter(([id]) => !ids.has(id))), facts: state.facts?.filter(fact => fact.levelId !== levelId), events: state.events.filter(event => !event.startsWith(`${levelId}:`)), history: state.history.filter(entry => entry.levelId !== levelId || entry.id === 'opening'), completedLevels: state.completedLevels.filter(id => id !== levelId), endingSeen: false }
    }
    if (!state.openingSeen) {
      state = record(state, { id: 'opening', title: spec.title, text: spec.narrative!.opening, levelId })
      state = { ...state, openingSeen: true }
    }
    state = record(state, { id: `${levelId}:arrival`, title: plan.title, text: plan.arrival, levelId })
    return plan.objectives.some(o => o.kind === 'interact' || o.kind === 'reach' && o.target !== 'exit') ? state : discoverClues(spec, state)
  }
  const emit = (spec: GameSpec, previous: StoryProgress, event: StoryEvent): StoryProgress => {
    if (previous.endingSeen || previous.levelId !== event.levelId || previous.storyKey !== key(spec)) return previous
    const plan = chapter(spec, event.levelId)
    if (!plan) return previous
    const eventKey = `${event.levelId}:${event.kind}:${event.id}`
    if (previous.events.includes(eventKey)) return previous
    const irreversible = ['collect', 'defeat', 'boss'].includes(event.kind)
    const matches = plan.objectives.filter(o => o.kind === event.kind && o.target === event.target && !complete(previous, o) && (irreversible || eligible(previous, o, plan.objectives)))
    if (!matches.length && event.kind !== 'boss-approach') return previous
    let state: StoryProgress = { ...previous, counts: { ...previous.counts }, facts: [...(previous.facts || []), event].slice(-3000), events: [...previous.events, eventKey].slice(-3000) }
    if (event.kind === 'boss-approach') return record(state, { id: `${event.levelId}:boss-before`, title: '决战之前', text: plan.bossBefore, levelId: event.levelId })
    // Physical pickups and defeated actors cannot be recreated. Keep these facts
    // until an earlier task unlocks their objective; interactions still require
    // a deliberate action after their prerequisites have been met.
    for (const o of plan.objectives) {
      if (complete(state, o) || !eligible(state, o, plan.objectives)) continue
      const count = (state.facts || []).filter(fact => fact.levelId === event.levelId && fact.kind === o.kind && fact.target === o.target).length
      state.counts[o.id] = Math.min(o.count, Math.max(state.counts[o.id] || 0, count))
      if (complete(state, o)) state = record(state, { id: `${event.levelId}:objective:${o.id}`, title: o.description, text: o.feedback, levelId: event.levelId })
    }
    if (event.kind === 'boss') state = record(state, { id: `${event.levelId}:boss-after`, title: '危机解除', text: plan.bossAfter, levelId: event.levelId })
    if (event.kind === 'interact' || event.kind === 'reach' && event.target !== 'exit') state = discoverClues(spec, state)
    return state
  }
  const objectives = (spec: GameSpec, state: StoryProgress) => (chapter(spec, state.levelId)?.objectives || []).map(o => ({ ...o, current: state.counts[o.id] || 0, complete: complete(state, o), available: eligible(state, o, chapter(spec, state.levelId)!.objectives) }))
  const canExit = (spec: GameSpec, state: StoryProgress) => {
    const plan = chapter(spec, state.levelId)
    return !plan || plan.objectives.filter(o => !(o.kind === 'reach' && o.target === 'exit')).every(o => complete(state, o))
  }
  const exitReady = (spec: GameSpec, state: StoryProgress | null, remainingEnemies: number) => spec.narrative
    ? Boolean(state && chapter(spec, state.levelId) && canExit(spec, state))
    : remainingEnemies === 0
  const finish = (spec: GameSpec, previous: StoryProgress): StoryProgress => {
    const plan = chapter(spec, previous.levelId)
    if (!plan || !plan.objectives.every(o => complete(previous, o))) return previous
    let state = record(previous, { id: `${previous.levelId}:departure`, title: '本关结束', text: plan.departure, levelId: previous.levelId })
    for (const clue of spec.narrative?.clues || []) if (clue.payoffLevelId === state.levelId && state.history.some(entry => entry.id === `clue:${clue.id}:setup`)) state = record(state, { id: `clue:${clue.id}:payoff`, title: '线索的答案', text: clue.payoff, levelId: state.levelId })
    state = { ...state, completedLevels: [...new Set([...state.completedLevels, state.levelId])] }
    if (state.levelId === spec.levels.at(-1)?.id && spec.levels.every(level => state.completedLevels.includes(level.id))) {
      state = record(state, { id: 'ending', title: '冒险结局', text: spec.narrative!.ending, levelId: state.levelId })
      state = { ...state, endingSeen: true }
    }
    return state
  }
  return { key, fresh, restore, begin, emit, objectives, canExit, exitReady, finish }
}

export const narrativeEngine = createNarrativeEngine()
export function offlineNarrativeRuntimeSource(): string { return `const storyEngine=(${createNarrativeEngine.toString()})();` }
