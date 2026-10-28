import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec, normalizeGameSpec } from '@/lib/game-spec'
import { recordNarrativeEdit } from '@/lib/narrative-editing'
import { normalizeModelGameSpec } from '@/lib/model-game-spec'
import { createPlanningTasks, createQualityTasks } from './graph'
import { changedDraftGroups, currentRunSpec, preservePlanningMedia, retryPlanningRun, reviseAgentDraft } from './draft-revision'
import { buildAgentPrompts } from './prompts'
import { agentOutputBudget, deterministicAgentResponse, localIntegratorResponse, normalizeArtifact } from './execution'
import type { AgentExecuteRequest, AgentRun, GameSpec } from '@/types'

const spec = () => createFallbackGameSpec('世界观与故事：地图师要修复灯塔，把失踪船队带回家。', '星潮', 3)
const input = { sourcePrompt: '世界观与故事：地图师要修复灯塔，把失踪船队带回家。', projectName: '星潮', levelCount: 3 }
function preparedRun(): AgentRun {
  const draft = spec()
  return { version: 1, id: 'original-run', projectId: 'draft', ...input, approved: true, status: 'producing', modelLock: { provider: 'openrouter', model: 'locked-model' }, maxReviewRounds: 2, currentRound: 1, createdAt: 1, updatedAt: 1,
    tasks: [...createPlanningTasks(), ...createQualityTasks()].map(task => ({ ...task, status: 'completed', attempts: 1, inputDigest: 'old-digest', output: task.role === 'assetCoordinator' ? { spec: draft } : { finding: task.role }, summary: `完成 ${task.role}`, usage: { promptTokens: 40, completionTokens: 60, totalTokens: 100 } })),
    artifacts: { brief: { title: draft.title, playerFantasy: '地图师', audience: '玩家', pillars: ['探索'], explicitRequirements: ['找回船队'], constraints: [], levelCount: 3 }, narrative: { narrative: draft.narrative }, mechanics: { hero: draft.hero, weapon: draft.weapon }, artDirection: { artDirection: draft.visualStyle.artDirection }, levelPlan: { levels: draft.levels }, mergedSpec: draft, revisedSpec: draft, productionSpec: draft, reviewIssues: [], visualReport: { checked: true }, playtestReport: { status: 'observed-complete' }, releaseReport: { ready: true } } }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('dependency-scoped draft updates', () => {
  it('turns an Agent planned aerial enemy into a spawnable second enemy', () => {
    const seed = spec()
    const request: AgentExecuteRequest = {
      runId: 'air-enemy-plan', taskId: 'integrator-r1', role: 'integrator', round: 1,
      provider: 'openrouter', model: 'locked-model', apiKey: '', ...input, baseSpec: seed,
      artifacts: {
        mechanics: { enemies: [
          { id: 'gust', name: '风息者', health: 30, damage: 12, speed: 3.5, behavior: 'ground patrol' },
          { id: 'cloud', name: '云哨兵', health: 45, damage: 15, speed: 2.8, behavior: 'floating aerial enemy', attackPattern: '远程投掷云团', spawnLevel: [2] },
        ] },
        levelPlan: { levels: seed.levels.map(level => ({ ...level, enemyTypes: level.id === 'level-2' ? ['gust', 'cloud'] : ['gust'] })) },
      },
    }
    const output = localIntegratorResponse(request, new Error('program integration')).data!.artifact.spec as GameSpec
    const air = output.assets.find(asset => asset.category === 'airEnemy')!
    expect(output.enemies[1]).toMatchObject({ name: '云哨兵', category: 'airEnemy', behavior: 'ranged' })
    expect(air.enabled).toBe(true)
    expect(air.levelIds).toEqual(['level-2'])
  })
  it('supplies real task contracts to one-click and chapter writers with bounded output space', () => {
    const seed = spec(), request: AgentExecuteRequest = { runId: 'prompt-optimize-test', taskId: 'prompt-integrator', role: 'integrator', round: 1, provider: 'openrouter', model: 'locked-model', apiKey: '', ...input, baseSpec: seed, artifacts: {} }
    const prompt = buildAgentPrompts(request)
    expect(prompt.user).toContain(seed.narrative!.chapters[1].objectives[1].id)
    expect(prompt.user).toContain(seed.narrative!.chapters[1].objectives[1].target)
    expect(prompt.system).toContain('update related chapter and task wording together')
    expect(agentOutputBudget(request)).toBeGreaterThan(1800)
    expect(agentOutputBudget({ ...request, levelCount: 10 })).toBeLessThanOrEqual(6500)
    const levelPrompt = buildAgentPrompts({ ...request, role: 'levelDesigner', runId: 'planning' })
    expect(levelPrompt.system).toContain('objectives:[{id,description,feedback,count}]')
    expect(levelPrompt.system).toContain('patch its collect or defeat objective count to match')
    expect(levelPrompt.user).toContain(seed.narrative!.chapters[0].objectives[0].id)
    expect(levelPrompt.user).not.toContain(seed.narrative!.chapters[0].objectives[0].feedback)
    const revisionPrompt = buildAgentPrompts({ ...request, role: 'revision', runId: 'planning', artifacts: { reviewIssues: [] } })
    expect(revisionPrompt.user).toContain('enabledEnemyNames')
    expect(revisionPrompt.user).toContain('attackPattern')
    expect(revisionPrompt.user).toContain(seed.narrative!.chapters.at(-1)!.objectives.at(-1)!.id)
    expect(revisionPrompt.user).not.toContain('[truncated]')
    const assetPrompt = buildAgentPrompts({ ...request, role: 'assetCoordinator', runId: 'planning', artifacts: { artDirection: {} } })
    expect(assetPrompt.user).toContain('imageAssets')
    expect(assetPrompt.user).not.toContain('narrative')
    expect(assetPrompt.user).not.toContain('[truncated]')
    const criticPrompt = buildAgentPrompts({ ...request, role: 'consistencyCritic', runId: 'planning' })
    expect(criticPrompt.system).toContain('clue payoffs are displayed at the assigned level exit')
    expect(criticPrompt.system).toContain('击退')
    expect(criticPrompt.user).toContain('enabledEnemyNames')
    expect(criticPrompt.user).not.toContain('[truncated]')
    const locked = clone(seed)
    locked.narrative!.source.lockedFields['chapters.level-1.arrival'] = '玩家要求保留的开场。'
    expect(buildAgentPrompts({ ...request, role: 'levelDesigner', baseSpec: locked }).user).toContain('玩家要求保留的开场。')
  })
  it('does not turn a proposal-only model patch into unrelated story or asset changes', () => {
    const seed = spec()
    const request: AgentExecuteRequest = { runId: 'test', taskId: 'assetCoordinator-r1', role: 'assetCoordinator', round: 1, provider: 'openrouter', model: 'locked-model', apiKey: '', ...input, baseSpec: seed, artifacts: {} }
    const production = normalizeArtifact(request, { artifact: { assetPromptPatches: [] } }).artifact.spec as GameSpec
    production.narrative = recordNarrativeEdit(production.narrative!, 'chapters.level-2.arrival', production.narrative!.chapters[1].arrival)
    const baseline = { ...seed, narrative: { ...seed.narrative!, source: production.narrative.source } }
    const oneClickBase = normalizeGameSpec(production, baseline, 3)
    expect(changedDraftGroups(production, oneClickBase)).toEqual([])
    const after = normalizeArtifact({ ...request, role: 'integrator', runId: 'prompt-optimize-test', baseSpec: oneClickBase }, { artifact: { spec: { narrative: { chapters: [{ levelId: 'level-2', arrival: '地图师放弃寻找船队，转向陌生城市继续独自旅行。' }] } } } }).artifact.spec as GameSpec
    expect(changedDraftGroups(production, after)).toEqual([])
    expect(after.narrative!.suggestions).toHaveLength(1)
    expect(after.narrative!.chapters).toEqual(production.narrative!.chapters)
  })
  it('keeps director, narrative and mechanics results for an art-only edit and invalidates downstream reports', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    edited.visualStyle.artDirection = '夕阳暖橙与青蓝阴影，轮廓清楚的侧视像素画面。'
    const next = reviseAgentDraft(run, edited, input)
    expect(next.id).toBe(run.id)
    expect(next.modelLock).toBe(run.modelLock)
    expect(next.approved).toBe(false)
    expect(next.status).toBe('paused')
    for (const role of ['director', 'narrative', 'mechanics']) expect(next.tasks.find(task => task.role === role)).toBe(run.tasks.find(task => task.role === role))
    for (const role of ['artDirector', 'levelDesigner', 'integrator', 'consistencyCritic', 'engineQa', 'revision', 'assetCoordinator']) expect(next.tasks.find(task => task.role === role)!.status).toBe('waiting')
    expect(next.artifacts.narrative).toBe(run.artifacts.narrative)
    expect(next.artifacts.productionSpec).toBeUndefined()
    expect(next.artifacts.artDirection).toBeUndefined()
    expect(next.artifacts.visualReport).toBeUndefined()
    expect(next.artifacts.playtestReport).toBeUndefined()
    expect(next.artifacts.releaseReport).toBeUndefined()
    expect(next.pendingRevision!.groups).toEqual(['art'])
    expect(next.pendingRevision!.retainedTaskIds).toHaveLength(3)
    expect(next.archivedTasks!.some(task => task.role === 'artDirector' && task.output)).toBe(true)
    expect(currentRunSpec(next)).toBe(edited)
  })
  it('keeps other professional work when editing chapters, and does not replay later review rounds', () => {
    const run = preparedRun()
    run.currentRound = 2
    run.tasks.push(...createQualityTasks(2).map(task => ({ ...task, status: 'completed' as const, output: { report: 'old second round' } })))
    const edited = clone(currentRunSpec(run)!)
    edited.narrative!.chapters[1].arrival = '旧灯塔的维修记录指出了船队最后一次经过的航路。'
    const next = reviseAgentDraft(run, edited, input)
    for (const role of ['director', 'narrative', 'mechanics', 'artDirector']) expect(next.tasks.find(task => task.role === role)!.status).toBe('completed')
    expect(next.currentRound).toBe(1)
    expect(next.tasks.every(task => task.round === 1 && task.phase !== 'quality')).toBe(true)
    expect(next.artifacts.levelPlan).toBeUndefined()
    expect(next.archivedTasks!.some(task => task.round === 2)).toBe(true)
    expect(next.planningSpec!.narrative!.chapters[1].levelId).toBe(run.artifacts.productionSpec!.narrative!.chapters[1].levelId)
  })
  it('replans shared story dependencies after an authored motive changes, keeping the original director brief', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    edited.narrative = recordNarrativeEdit({ ...edited.narrative!, motivation: '地图师想兑现童年伙伴的约定，把受困船员全部带回港口。' }, 'motivation', '地图师想兑现童年伙伴的约定，把受困船员全部带回港口。')
    const next = reviseAgentDraft(run, edited, input)
    expect(next.artifacts.brief).toBe(run.artifacts.brief)
    expect(next.artifacts.narrative).toBeUndefined()
    expect(next.artifacts.mechanics).toBeUndefined()
    expect(next.artifacts.artDirection).toBeUndefined()
    expect(next.tasks.find(task => task.role === 'director')!.status).toBe('completed')
    expect(next.tasks.find(task => task.role === 'narrative')!.status).toBe('waiting')
    expect(next.pendingRevision!.groups).toContain('story')
  })
  it('invalidates all planning roles when the original story, title or level count changes', () => {
    for (const change of ['source', 'title', 'count']) {
      const run = preparedRun(), edited = clone(currentRunSpec(run)!), changed = { ...input }
      if (change === 'source') changed.sourcePrompt += '\n主角改为护林人。'
      if (change === 'title') { edited.title = '森林'; changed.projectName = '森林' }
      if (change === 'count') changed.levelCount = 4
      const next = reviseAgentDraft(run, edited, changed)
      expect(next.tasks.every(task => task.status === 'waiting')).toBe(true)
      expect(next.artifacts.brief).toBeUndefined()
      expect(next.modelLock).toBe(run.modelLock)
    }
  })
  it('keeps narrative and art when changing only gameplay values', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    edited.hero.maxHealth += 20
    const next = reviseAgentDraft(run, edited, input)
    expect(next.pendingRevision!.groups).toEqual(['gameplay'])
    expect(next.artifacts.narrative).toBe(run.artifacts.narrative)
    expect(next.artifacts.artDirection).toBe(run.artifacts.artDirection)
    expect(next.artifacts.mechanics).toBeUndefined()
    expect(next.tasks.find(task => task.role === 'artDirector')!.status).toBe('completed')
  })
  it('rechecks integration and review after adding a lock without paying for unchanged specialists', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    edited.narrative!.source.lockedFields.opening = edited.narrative!.opening
    const next = reviseAgentDraft(run, edited, input)
    expect(next.pendingRevision!.groups).toEqual(['locks'])
    for (const role of ['director', 'narrative', 'mechanics', 'artDirector', 'levelDesigner']) expect(next.tasks.find(task => task.role === role)!.status).toBe('completed')
    expect(next.tasks.find(task => task.role === 'integrator')!.status).toBe('waiting')
  })
  it('does not duplicate archives on repeated typing, and accumulates the actual affected groups', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    edited.visualStyle.artDirection = '暖色'
    const first = reviseAgentDraft(run, edited, input), again = clone(edited)
    again.visualStyle.artDirection = '暖色光照与清晰轮廓'
    const second = reviseAgentDraft(first, again, input)
    expect(second.archivedTasks).toHaveLength(first.archivedTasks!.length)
    expect(second.tasks.find(task => task.role === 'director')).toBe(first.tasks.find(task => task.role === 'director'))
    const gameplayEdit = clone(again)
    gameplayEdit.hero.maxHealth += 10
    const third = reviseAgentDraft(second, gameplayEdit, input)
    expect(third.pendingRevision!.groups).toEqual(expect.arrayContaining(['art', 'gameplay']))
    expect(third.tasks.find(task => task.role === 'mechanics')!.status).toBe('waiting')
  })
  it('ignores hydration, upload completion and suggestion decisions as planning changes', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    edited.assets[0].url = 'data:image/png;base64,uploaded'
    edited.assets[0].status = 'success'
    edited.narrative!.source.origin = 'player'
    edited.narrative!.suggestions = []
    expect(changedDraftGroups(currentRunSpec(run)!, edited)).toEqual([])
    expect(reviseAgentDraft(run, edited, input)).toBe(run)
    expect(run.approved).toBe(true)
  })
  it('revokes approval for new pending alternatives even when the active story text did not change', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    edited.narrative!.suggestions = [{ id: 'new-alternative', path: 'motivation', label: '主角动机', before: edited.narrative!.motivation, after: '地图师决定留下帮助岛民，暂时放下寻找船队的计划。', reason: '需要玩家确认', status: 'pending' }]
    const next = reviseAgentDraft(run, edited, input)
    expect(next.approved).toBe(false)
    expect(next.status).toBe('awaiting_approval')
    expect(next.tasks).toBe(run.tasks)
    expect(next.pendingRevision).toBeUndefined()
    expect(next.artifacts.productionSpec).toBe(edited)
    expect(next.modelLock).toBe(run.modelLock)
  })
  it('does not discard or mutate an actively running Agent job', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    edited.world = '另一个世界'
    expect(reviseAgentDraft({ ...run, status: 'planning' }, edited, input).status).toBe('planning')
    run.tasks[0].status = 'running'
    expect(reviseAgentDraft(run, edited, input)).toBe(run)
  })
  it('keeps the local-draft path deterministic and ready for a new manual review', () => {
    const run = preparedRun(), edited = clone(currentRunSpec(run)!)
    run.reviewMode = 'local-draft'; run.tasks = run.tasks.filter(task => task.role === 'engineQa')
    edited.narrative!.opening += '地图师带上了旧罗盘。'
    const next = reviseAgentDraft(run, edited, input)
    expect(next.status).toBe('draft')
    expect(next.reviewMode).toBe('local-draft')
    expect(next.tasks).toHaveLength(1)
    expect(next.tasks[0].role).toBe('engineQa')
    expect(next.tasks[0].dependencies).toEqual([])
    expect(next.approved).toBe(false)
    expect(currentRunSpec(next)).toBe(edited)
  })
  it('retains successful single images and action strips through replanning', () => {
    const before = spec(), after = clone(before)
    const hero = before.assets.find(asset => asset.category === 'hero')!
    hero.url = 'data:image/png;base64,upload-static'; hero.status = 'success'
    hero.animation!.clips!.walk!.url = 'data:image/webp;base64,upload-walk'; hero.animation!.clips!.walk!.status = 'success'
    const restored = preservePlanningMedia(after, before).assets.find(asset => asset.id === hero.id)!
    expect(restored.url).toBe(hero.url)
    expect(restored.animation!.clips!.walk!.url).toBe(hero.animation!.clips!.walk!.url)
    expect(restored.prompt).toBe(after.assets.find(asset => asset.id === hero.id)!.prompt)
    expect(restored.animation!.clips!.walk!.status).toBe('success')
  })
  it('preserves an explicit new art direction and supplies it as an override of older wording', () => {
    const seed = spec(), newDirection = '暖橙夕照与青蓝阴影，保留主角的红色围巾。'
    seed.visualStyle.artDirection = newDirection
    seed.narrative!.source.playerFields['visualStyle.artDirection'] = newDirection
    const patch = normalizeModelGameSpec({ visualStyle: { artDirection: '灰色废墟', palette: '橙色、青蓝和红色' } }, seed, 3, '整体像素风格：旧的蓝色单色画面')
    expect(patch.visualStyle.artDirection).toBe(newDirection)
    expect(patch.visualStyle.palette).toContain('橙色')
    const request: AgentExecuteRequest = { runId: 'run', taskId: 'artDirector-r1', role: 'artDirector', round: 1, provider: 'openrouter', model: 'locked-model', apiKey: '', sourcePrompt: '整体像素风格：旧的蓝色单色画面', projectName: seed.title, levelCount: 3, baseSpec: seed, artifacts: {} }
    expect(buildAgentPrompts(request).user).toContain(newDirection)
    expect(buildAgentPrompts(request).user).toContain('supersede older wording')
    request.role = 'integrator'; request.artifacts.artDirection = { artDirection: '灰色废墟' }
    const integrated = deterministicAgentResponse(request)!.data!.artifact.spec as GameSpec
    expect(integrated.visualStyle.artDirection).toBe(newDirection)
  })
  it('removes old quality approval and reports when explicitly retrying an upstream planner', () => {
    const run = preparedRun(), next = retryPlanningRun(run, 'artDirector-r1')
    expect(next.tasks.some(task => task.phase === 'quality')).toBe(false)
    expect(next.artifacts.visualReport).toBeUndefined()
    expect(next.artifacts.playtestReport).toBeUndefined()
    expect(next.artifacts.releaseReport).toBeUndefined()
    expect(next.approved).toBe(false)
    expect(next.tasks.find(task => task.role === 'narrative')).toBe(run.tasks.find(task => task.role === 'narrative'))
    expect(next.archivedTasks!.some(task => task.role === 'playtest')).toBe(true)
    expect(next.modelLock).toBe(run.modelLock)
    expect(next.planningSpec).toBe(run.artifacts.productionSpec)
  })
  it('recreates the coordinator task when retrying a task that only exists in round two', () => {
    const run = preparedRun()
    const coordinator = run.tasks.find(task => task.role === 'assetCoordinator')!
    run.tasks = [...run.tasks.filter(task => task.role !== 'assetCoordinator'), { ...coordinator, id: 'assetCoordinator-r2', round: 2 }]
    run.currentRound = 2
    const next = retryPlanningRun(run, 'assetCoordinator-r2')
    expect(next.currentRound).toBe(1)
    expect(next.tasks.find(task => task.role === 'assetCoordinator')!.id).toBe('assetCoordinator-r1')
    expect(next.tasks.find(task => task.role === 'assetCoordinator')!.status).toBe('waiting')
    expect(next.tasks.find(task => task.role === 'revision')!.status).toBe('completed')
    expect(next.artifacts.productionSpec).toBeUndefined()
  })
})
