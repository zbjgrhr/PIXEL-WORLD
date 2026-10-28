import type { GameSpec } from '@/types'
import { narrativeEngine, type StoryProgress, type StoryEntry } from './narrative-runtime'
import { recordPlaytestProgress } from './playtest-evidence'

export interface CampaignSave {
  version: 1
  storyKey: string
  levelIndex: number
  score: number
  levelScore: number
  power: number
  simulationTime: number
  story: StoryProgress
  unread: StoryEntry[]
  actors: { player: unknown; enemies: unknown[]; collectibles: unknown[] }
}
const keyFor = (project: string) => `pixel-world-campaign-v1:${project}`
function finiteFields(value: unknown, fields: string[]): boolean {
  if (!value || typeof value !== 'object') return false
  return fields.every(field => Number.isFinite((value as Record<string, unknown>)[field]))
}
export function readCampaign(spec: GameSpec, project: string): CampaignSave | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(project)) || 'null') as CampaignSave | null
    if (!saved || saved.version !== 1 || saved.storyKey !== narrativeEngine.key(spec) || !Number.isInteger(saved.levelIndex) || !spec.levels[saved.levelIndex] || !saved.actors?.player || !Array.isArray(saved.actors.enemies) || !Array.isArray(saved.actors.collectibles)) return null
    if (saved.story?.storyKey !== saved.storyKey || saved.story.levelId !== spec.levels[saved.levelIndex].id
      || !finiteFields(saved, ['score', 'levelScore', 'power', 'simulationTime'])
      || !finiteFields(saved.actors.player, ['x', 'y', 'vx', 'vy', 'health', 'maxHealth', 'width', 'height', 'invulnerableUntil', 'meleeReadyAt', 'rangedReadyAt', 'actionStartedAt', 'actionUntil'])
      || saved.actors.enemies.length > 40 || saved.actors.collectibles.length > 40
      || !saved.actors.enemies.every(enemy => finiteFields(enemy, ['x', 'y', 'health', 'maxHealth', 'damage', 'speed', 'width', 'height', 'baseY', 'vy', 'phase', 'nextDecisionAt', 'idleUntil', 'removeAt', 'lastShotAt', 'actionStartedAt', 'actionUntil']))
      || !saved.actors.collectibles.every(item => finiteFields(item, ['x', 'y']))) return null
    saved.story = narrativeEngine.restore(spec, saved.story)
    saved.unread = Array.isArray(saved.unread) ? saved.unread.flatMap(item => { const entry = saved.story.history.find(entry => entry.id === item?.id); return entry ? [entry] : [] }) : []
    return saved
  } catch { return null }
}
export function writeCampaign(project: string, save: CampaignSave) {
  recordPlaytestProgress(save.story)
  try { localStorage.setItem(keyFor(project), JSON.stringify(save)) } catch { /* Storage may be unavailable; gameplay continues. */ }
}
export function clearCampaign(project: string) {
  try { localStorage.removeItem(keyFor(project)) } catch { /* No save to clear. */ }
}
