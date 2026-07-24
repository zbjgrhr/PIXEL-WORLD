import type { AgentArtifacts, AgentRole } from '@/types'

const ROLE_FIELDS: Record<AgentRole, string[]> = {
  director: ['title', 'playerFantasy', 'audience', 'pillars', 'explicitRequirements', 'constraints', 'levelCount'],
  narrative: ['world', 'conflict', 'heroGoal', 'collectibleMeaning', 'bossRole', 'backgroundStory'],
  mechanics: ['combatMode', 'hero', 'weapon', 'enemies', 'boss', 'collectible', 'difficultyCurve', 'rules'],
  artDirector: ['artDirection', 'palette', 'lighting', 'pixelScale', 'characterRules', 'backgroundRules', 'assetIsolationRules', 'animationRules'],
  levelDesigner: ['levels', 'progressionNotes'],
  integrator: [],
  consistencyCritic: ['issues'],
  engineQa: ['issues'],
  revision: [],
  assetCoordinator: ['estimatedImageJobs', 'productionNotes'],
  visualQa: ['verdict', 'checkedAssets', 'recommendations'],
  playtest: ['verdict', 'checks', 'recommendations'],
  publisher: ['ready', 'blockingIssues', 'warnings', 'summary'],
}

const FORBIDDEN_KEYS = /^(?:__proto__|prototype|constructor|apiKey|authorization|token|accessToken|secret)$/i

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 7 || value === undefined) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 8000)
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(-1_000_000_000, Math.min(1_000_000_000, value)) : 0
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item, depth + 1)).filter((item) => item !== undefined)
  if (typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !FORBIDDEN_KEYS.test(key))
    .slice(0, 100)
    .map(([key, item]) => [key.slice(0, 120), safeValue(item, depth + 1)])
    .filter(([, item]) => item !== undefined))
}

export function sanitizeAgentArtifact(role: AgentRole, value: unknown): Record<string, unknown> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const fields = new Set(ROLE_FIELDS[role])
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => fields.has(key))
    .map(([key, item]) => [key, safeValue(item)])
    .filter(([, item]) => item !== undefined))
}

export function sanitizeSharedArtifacts(value: unknown): AgentArtifacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const allowed = new Set(['brief', 'narrative', 'mechanics', 'artDirection', 'levelPlan', 'mergedSpec', 'reviewIssues', 'revisedSpec', 'productionSpec', 'visualReport', 'playtestReport', 'releaseReport'])
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => allowed.has(key) && !FORBIDDEN_KEYS.test(key))
    .map(([key, item]) => [key, safeValue(item)])
    .filter(([, item]) => item !== undefined)) as AgentArtifacts
}
