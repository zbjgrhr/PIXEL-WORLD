import type { GameSpec } from '@/types'
import { alignNarrativeCast, normalizeNarrative } from './narrative'
import { carryPendingNarrativeSuggestions } from './narrative-suggestions'

export type RefinementScope = 'story' | 'characters' | 'chapters' | 'art' | 'missing'

function fillEmpty<T>(current: T, candidate: T): T {
  if (typeof current === 'string') return (current.trim() ? current : candidate) as T
  if (current == null) return candidate
  if (Array.isArray(current) && Array.isArray(candidate)) {
    if (!current.length) return candidate
    return current.map((item, index) => {
      const match = item && typeof item === 'object' && ('id' in item || 'levelId' in item)
        ? candidate.find(other => other && typeof other === 'object' && ('id' in item ? other.id === item.id : other.levelId === item.levelId))
        : candidate[index]
      return match === undefined ? item : fillEmpty(item, match)
    }) as T
  }
  if (typeof current === 'object' && typeof candidate === 'object' && candidate) {
    const result = { ...current } as Record<string, unknown>
    for (const key of Object.keys(candidate)) result[key] = fillEmpty(result[key], (candidate as Record<string, unknown>)[key])
    return result as T
  }
  return current
}
export function mergeRefinement(current: GameSpec, candidate: GameSpec, scope: RefinementScope): GameSpec {
  if (!current.narrative || !candidate.narrative) return current
  const source = current.narrative.source
  let next = { ...current, narrative: { ...current.narrative } }
  if (scope === 'story') {
    const keys = ['premise','incitingIncident','motivation','conflict','bossRelation','resolution','opening','ending'] as const
    keys.forEach(key => { next.narrative[key] = candidate.narrative![key] })
    next.world = candidate.world
    next.backgroundStory = candidate.narrative.opening
  } else if (scope === 'characters') {
    next = { ...next, hero:candidate.hero, boss:candidate.boss, enemies:candidate.enemies, narrative:{...next.narrative,characters:candidate.narrative.characters} }
    next.assets = current.assets.map(asset => !asset.url && ['hero','boss','groundEnemy'].includes(asset.category) ? { ...asset, prompt:candidate.assets.find(a=>a.id===asset.id)?.prompt || asset.prompt } : asset)
  } else if (scope === 'chapters') {
    next.levels = candidate.levels
    next.narrative.chapters = candidate.narrative.chapters
    next.narrative.clues = candidate.narrative.clues
    next.assets = current.assets.map(asset => !asset.url && asset.category==='levelBackground' ? {...asset,prompt:candidate.assets.find(a=>a.id===asset.id)?.prompt || asset.prompt} : asset)
  } else if (scope === 'art') next.visualStyle = candidate.visualStyle
  else next = { ...next, narrative: fillEmpty(next.narrative, candidate.narrative),
    hero: fillEmpty(next.hero, candidate.hero), boss: fillEmpty(next.boss, candidate.boss),
    visualStyle: fillEmpty(next.visualStyle, candidate.visualStyle),
    creativeBrief: fillEmpty(next.creativeBrief, candidate.creativeBrief),
    levels: fillEmpty(next.levels, candidate.levels),
  }
  next.narrative = normalizeNarrative({ ...next.narrative, source }, next, current.narrative)
  const related = candidate.narrative.suggestions?.filter(item => scope === 'story' ? !item.path.includes('.') : scope === 'characters' ? item.path.startsWith('characters.') : scope === 'chapters' ? /^(chapters|clues)\./.test(item.path) : false)
  return alignNarrativeCast(carryPendingNarrativeSuggestions(next, related))
}
