import type { AgentArtifacts, AgentDraftChangeGroup, AgentRole, AgentRun, AgentTask, GameSpec } from '@/types'
import { stableStringify } from './hash'
import { createPlanningTasks } from './graph'
import { pendingNarrativeSuggestions } from '@/lib/narrative-suggestions'

export const DRAFT_CHANGE_LABELS: Record<AgentDraftChangeGroup, string> = { requirements: '名称、故事或整体要求', story: '故事主线', characters: '角色与人物关系', gameplay: '玩法与数值', chapters: '关卡、线索与任务', art: '画面与风格', assets: '素材安排', locks: '原文保护与填写要求' }
const different = (before: unknown, after: unknown) => stableStringify(before) !== stableStringify(after)
const complete = (task: AgentTask) => task.status === 'completed' || task.status === 'needs-review'

export function currentRunSpec(run: AgentRun): GameSpec | undefined {
  return run.artifacts.productionSpec || run.artifacts.revisedSpec || run.artifacts.mergedSpec || run.planningSpec
}

export function changedDraftGroups(before: GameSpec, after: GameSpec): AgentDraftChangeGroup[] {
  const groups: AgentDraftChangeGroup[] = []
  const a = before.narrative, b = after.narrative
  if (before.title !== after.title || before.version !== after.version || before.levels.length !== after.levels.length || a?.source.originalStory !== b?.source.originalStory || a?.source.originalTitle !== b?.source.originalTitle) groups.push('requirements')
  const story = (spec: GameSpec) => [spec.world, spec.backgroundStory, spec.creativeBrief?.heroGoal, ...(['premise', 'incitingIncident', 'motivation', 'conflict', 'bossRelation', 'resolution', 'opening', 'ending'] as const).map(key => spec.narrative?.[key])]
  if (different(story(before), story(after))) groups.push('story')
  const cast = (spec: GameSpec) => [spec.narrative?.characters, ...[spec.hero, spec.boss, spec.weapon, spec.collectible, ...spec.enemies].map(item => [item.name, item.appearance])]
  if (different(cast(before), cast(after))) groups.push('characters')
  const gameplay = (spec: GameSpec) => [spec.hero.maxHealth, spec.hero.moveSpeed, spec.hero.jumpPower, spec.weapon, spec.boss, spec.collectible, spec.enemies].map(value => value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'name' && key !== 'appearance')) : value)
  if (different([gameplay(before), before.creativeBrief?.difficulty], [gameplay(after), after.creativeBrief?.difficulty])) groups.push('gameplay')
  if (different([before.levels, a?.chapters, a?.clues, before.creativeBrief?.pacing], [after.levels, b?.chapters, b?.clues, after.creativeBrief?.pacing])) groups.push('chapters')
  if (different([before.visualStyle, before.creativeBrief?.identityRules], [after.visualStyle, after.creativeBrief?.identityRules])) groups.push('art')
  // Cache hydration and successful image uploads do not invalidate text planning.
  const assets = (spec: GameSpec) => spec.assets.map(asset => ({ id: asset.id, category: asset.category, kind: asset.kind, enabled: asset.enabled, levelIds: asset.levelIds, prompt: asset.prompt }))
  if (different([assets(before), before.projectile, before.attackEffect], [assets(after), after.projectile, after.attackEffect])) groups.push('assets')
  if (different(a?.source.lockedFields, b?.source.lockedFields) || !groups.length && different(a?.source.playerFields, b?.source.playerFields)) groups.push('locks')
  return groups
}

export function invalidatedTaskIds(tasks: AgentTask[], roots: Iterable<string>): Set<string> {
  const ids = new Set(roots)
  let changed = true
  while (changed) {
    changed = false
    for (const task of tasks) if (!ids.has(task.id) && task.dependencies.some(id => ids.has(id))) { ids.add(task.id); changed = true }
  }
  return ids
}

export function clearArtifactsForRoles(artifacts: AgentArtifacts, roles: Set<AgentRole>): AgentArtifacts {
  const next = { ...artifacts }
  const keys: Partial<Record<AgentRole, keyof AgentArtifacts>> = { director: 'brief', narrative: 'narrative', mechanics: 'mechanics', artDirector: 'artDirection', levelDesigner: 'levelPlan', integrator: 'mergedSpec', revision: 'revisedSpec', assetCoordinator: 'productionSpec', visualQa: 'visualReport', playtest: 'playtestReport', publisher: 'releaseReport' }
  for (const role of roles) { const key = keys[role]; if (key) delete next[key] }
  if ([...roles].some(role => ['consistencyCritic', 'engineQa', 'revision', 'integrator'].includes(role))) delete next.reviewIssues
  return next
}

/** Called only after player edits, never as an automatic paid continuation. */
export function reviseAgentDraft(run: AgentRun, spec: GameSpec, input: { sourcePrompt: string; projectName: string; levelCount: number }): AgentRun {
  if (['planning', 'reviewing', 'quality_check'].includes(run.status) || run.tasks.some(task => task.status === 'running')) return run
  const previous = currentRunSpec(run)
  const groups = previous ? changedDraftGroups(previous, spec) : ['requirements' as const]
  if (run.sourcePrompt !== input.sourcePrompt || run.projectName !== input.projectName || run.levelCount !== input.levelCount) groups.push('requirements')
  if (!groups.length) {
    const oldPending = new Set(pendingNarrativeSuggestions(previous).map(item => item.id))
    if (!pendingNarrativeSuggestions(spec).some(item => !oldPending.has(item.id))) return run
    // A new alternative still needs a player decision even when the active text
    // stays unchanged. Keep completed work and revoke approval without model calls.
    const artifacts = { ...run.artifacts }
    const key = artifacts.productionSpec ? 'productionSpec' : artifacts.revisedSpec ? 'revisedSpec' : artifacts.mergedSpec ? 'mergedSpec' : undefined
    if (key) artifacts[key] = spec
    return { ...run, approved: false, status: run.approved || run.status === 'awaiting_approval' ? 'awaiting_approval' : run.status, planningSpec: spec, artifacts, updatedAt: Date.now() }
  }
  const allGroups = [...new Set([...(run.pendingRevision?.groups || []), ...groups])]
  const roots = new Set<AgentRole>(['integrator'])
  if (allGroups.includes('requirements')) roots.add('director')
  if (allGroups.includes('story') || allGroups.includes('characters')) roots.add('narrative')
  if (allGroups.includes('gameplay')) roots.add('mechanics')
  if (allGroups.includes('chapters')) roots.add('levelDesigner')
  if (allGroups.includes('art')) roots.add('artDirector')
  const templates = createPlanningTasks(1)
  const invalidIds = invalidatedTaskIds(templates, templates.filter(task => roots.has(task.role)).map(task => task.id))
  const roles = new Set(templates.filter(task => invalidIds.has(task.id)).map(task => task.role))
  // Every actual change invalidates visual/release reports from the previous specification.
  roles.add('visualQa'); roles.add('playtest'); roles.add('publisher')
  const archived = run.tasks.filter(task => complete(task) && (roles.has(task.role) || task.round > 1))
  const tasks = run.reviewMode === 'local-draft'
    ? [{ ...templates.find(task => task.role === 'engineQa')!, dependencies: [] }]
    : templates.map(template => {
      const old = run.tasks.find(task => task.role === template.role && task.round === 1)
      return old && !roles.has(template.role) ? old : { ...template, attempts: old?.attempts || 0 }
    })
  return { ...run, ...input, status: run.reviewMode === 'local-draft' ? 'draft' : 'paused', approved: false, currentRound: 1, error: undefined, planningSpec: spec,
    artifacts: run.reviewMode === 'local-draft' ? {} : clearArtifactsForRoles(run.artifacts, roles), tasks,
    archivedTasks: [...(run.archivedTasks || []), ...archived].slice(-150),
    pendingRevision: { groups: allGroups, invalidatedRoles: [...roles], retainedTaskIds: tasks.filter(complete).map(task => task.id) }, updatedAt: Date.now() }
}

/** Explicit retries invalidate later reviews and quality reports, including second-round tasks. */
export function retryPlanningRun(run: AgentRun, selectedId: string): AgentRun {
  const selected = run.tasks.find(task => task.id === selectedId)
  if (!selected || selected.phase === 'quality') return run
  const templates = createPlanningTasks(1)
  const root = templates.find(task => task.role === selected.role)
  if (!root) return run
  const invalidIds = invalidatedTaskIds(templates, [root.id])
  const roles = new Set<AgentRole>([...templates.filter(task => invalidIds.has(task.id)).map(task => task.role), 'visualQa', 'playtest', 'publisher'])
  const tasks = templates.map(template => {
    const old = run.tasks.find(task => task.id === template.id)
    const latest = old || [...run.tasks].reverse().find(task => task.role === template.role)
    return !roles.has(template.role) && old ? old : { ...template, attempts: latest?.attempts || 0 }
  })
  return { ...run, status: 'planning', currentRound: 1, approved: false, error: undefined, tasks,
    planningSpec: currentRunSpec(run), artifacts: clearArtifactsForRoles(run.artifacts, roles),
    archivedTasks: [...(run.archivedTasks || []), ...run.tasks.filter(task => complete(task) && (roles.has(task.role) || task.round > 1))].slice(-150),
    pendingRevision: run.pendingRevision ? { ...run.pendingRevision, invalidatedRoles: [...roles], retainedTaskIds: tasks.filter(complete).map(task => task.id) } : undefined, updatedAt: Date.now() }
}

/** Successful player media survive replanning; changed art can be regenerated explicitly later. */
export function preservePlanningMedia(spec: GameSpec, seed?: GameSpec): GameSpec {
  if (!seed) return spec
  return { ...spec, assets: spec.assets.map(asset => {
    const original = seed.assets.find(item => item.id === asset.id && item.kind === asset.kind)
    if (!original) return asset
    const animation = asset.animation && original.animation ? { ...asset.animation, clips: Object.fromEntries(Object.entries(asset.animation.clips || {}).map(([pose, clip]) => {
      const prior = original.animation?.clips?.[pose as keyof NonNullable<typeof original.animation.clips>]
      return [pose, prior?.url ? { ...clip, url: prior.url, status: prior.status, error: prior.error } : clip]
    })) } : asset.animation
    return { ...asset, animation, ...(original.url ? { url: original.url, status: original.status, error: original.error } : {}) }
  }) }
}
