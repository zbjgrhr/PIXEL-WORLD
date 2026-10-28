import type { GameSpec } from '@/types'
import { narrativeEngine, type StoryProgress } from './narrative-runtime'

export interface PlaytestEvidence {
  version: 1
  storyKey: string
  runtime: 'online'
  observedAt: number
  enteredLevels: string[]
  completedLevels: string[]
  completedObjectives: string[]
  openingTriggered: boolean
  endingTriggered: boolean
}
const storageKey = (storyKey: string) => `pixel-world-playtest-evidence:${storyKey}`

/** This is a local play record, not a model's prediction or a signed test certificate. */
export function recordPlaytestProgress(state: StoryProgress) {
  try {
    const prior = JSON.parse(localStorage.getItem(storageKey(state.storyKey)) || 'null') as PlaytestEvidence | null
    const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])].slice(-300)
    const objectiveIds = state.history.filter(entry => entry.id.includes(':objective:')).map(entry => entry.id.split(':objective:')[1])
    const next: PlaytestEvidence = { version: 1, storyKey: state.storyKey, runtime: 'online', observedAt: Date.now(),
      enteredLevels: union(prior?.enteredLevels, state.history.filter(entry => entry.id.endsWith(':arrival')).map(entry => entry.levelId)),
      completedLevels: union(prior?.completedLevels, state.completedLevels), completedObjectives: union(prior?.completedObjectives, objectiveIds),
      openingTriggered: Boolean(prior?.openingTriggered || state.openingSeen), endingTriggered: Boolean(prior?.endingTriggered || state.endingSeen),
    }
    localStorage.setItem(storageKey(state.storyKey), JSON.stringify(next))
  } catch { /* Play records are optional when browser storage is unavailable. */ }
}

export function readPlaytestEvidence(spec: GameSpec): PlaytestEvidence | undefined {
  try { return validatePlaytestEvidence(spec, JSON.parse(localStorage.getItem(storageKey(narrativeEngine.key(spec))) || 'null')) } catch { return undefined }
}

export function validatePlaytestEvidence(spec: GameSpec, value: unknown): PlaytestEvidence | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<PlaytestEvidence>
  if (raw.version !== 1 || raw.storyKey !== narrativeEngine.key(spec) || raw.runtime !== 'online' || !Number.isFinite(raw.observedAt)) return undefined
  const levels = new Set(spec.levels.map(level => level.id))
  const objectives = new Set(spec.narrative?.chapters.flatMap(chapter => chapter.objectives.map(task => task.id)))
  const known = (list: unknown, ids: Set<string>) => Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === 'string' && ids.has(id)))].slice(0, 300) : []
  return { version: 1, storyKey: raw.storyKey, runtime: 'online', observedAt: raw.observedAt!,
    enteredLevels: known(raw.enteredLevels, levels), completedLevels: known(raw.completedLevels, levels), completedObjectives: known(raw.completedObjectives, objectives),
    openingTriggered: raw.openingTriggered === true, endingTriggered: raw.endingTriggered === true,
  }
}

export function playtestCoverage(spec: GameSpec, value: unknown) {
  const evidence = validatePlaytestEvidence(spec, value)
  const expected = spec.narrative?.chapters.flatMap(chapter => chapter.objectives.map(task => task.id)) || []
  const missingLevels = spec.levels.filter(level => !evidence?.completedLevels.includes(level.id)).map(level => level.id)
  const missingObjectives = expected.filter(id => !evidence?.completedObjectives.includes(id))
  const complete = Boolean(evidence && spec.narrative && !missingLevels.length && !missingObjectives.length && evidence.openingTriggered && evidence.endingTriggered)
  return { status: complete ? 'observed-complete' : evidence ? 'observed-partial' : 'not-tested', evidence, missingLevels, missingObjectives,
    summary: complete ? `本浏览器已记录 ${spec.levels.length} 关的任务、出口及结局触发。默认难度、操作手感、存档恢复和离线导出仍需另行确认。` : evidence ? `已试玩 ${evidence.enteredLevels.length} 关，完成 ${evidence.completedLevels.length}/${spec.levels.length} 关；尚未记录全部任务和结局。` : '尚无此版本的真实试玩记录；这里只能检查规格，不能确认实际通关。',
  }
}
