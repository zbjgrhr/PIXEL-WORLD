import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec, normalizeGameSpec } from './game-spec'
import { normalizeModelGameSpec } from './model-game-spec'
import { carryPendingNarrativeSuggestions, decideNarrativeSuggestion, narrativeSuggestionStatus, pendingNarrativeSuggestions, sameSpecExceptSuggestions } from './narrative-suggestions'
import { narrativeEngine, offlineNarrativeRuntimeSource } from './narrative-runtime'
import { recordNarrativeEdit } from './narrative-editing'
import { normalizeArtifact, deterministicAgentResponse } from './agents/execution'
import { updateRunNarrativeDecisions } from './agents/narrative-decisions'
import { mergeRefinement } from './refine-game-spec'
import { applyWebLlmCreativePatch } from './agents/webllm-lite'
import { buildAgentPrompts } from './agents/prompts'
import type { AgentExecuteRequest, AgentRun } from '@/types'

const original = () => createFallbackGameSpec('世界观与故事：地图师阿禾要修复灯塔，找回失踪船队。\n主角姓名：阿禾\n主角动机：阿禾要履行对失踪船队的承诺，让船员平安回家。', '星潮', 3)
const model = (base = original()) => normalizeModelGameSpec({ hero: { name: '小明' }, narrative: { motivation: '小明想赢得全国冒险比赛的冠军，这是他唯一的目标。', conflict: '航路被潮汐切断，必须先修复灯塔才能接近守桥核心。' } }, base, 3, '')
const request = (role: AgentExecuteRequest['role'], spec = original()): AgentExecuteRequest => ({ role, runId: 'suggestion-test', taskId: role, round: 1, provider: 'openrouter', model: 'test-model', apiKey: '', projectName: spec.title, levelCount: 3, sourcePrompt: '', baseSpec: spec, artifacts: {} })

describe('player decisions on narrative edits', () => {
  it('rejects a model visual rewrite that turns the stated animals into unrelated characters', () => {
    const before = createFallbackGameSpec('世界观与故事：小企鹅在日本世界打败怪物和熊猫Boss，最后找到了妈妈。', '小企鹅找妈妈', 3)
    const changed = normalizeModelGameSpec({
      hero: { appearance: 'A young armored knight with a blue cape.' },
      boss: { appearance: 'A huge red dragon breathing fire.' },
      assets: before.assets.map(asset => asset.category === 'hero' ? { ...asset, prompt: 'A young armored knight with a blue cape.' } : asset.category === 'boss' ? { ...asset, prompt: 'A huge red dragon breathing fire.' } : asset),
    }, before, 3, '')
    expect(changed.hero.name).toBe('小企鹅')
    expect(changed.hero.appearance).toBe(before.hero.appearance)
    expect(changed.boss.name).toBe('熊猫')
    expect(changed.boss.appearance).toBe(before.boss.appearance)
    expect(changed.assets.find(asset => asset.category === 'hero')?.prompt).toBe(before.assets.find(asset => asset.category === 'hero')?.prompt)
    expect(changed.assets.find(asset => asset.category === 'boss')?.prompt).toBe(before.assets.find(asset => asset.category === 'boss')?.prompt)
    const faithful = normalizeModelGameSpec({ hero: { appearance: 'Small black-and-white penguin with orange feet.' } }, before, 3, '')
    expect(faithful.hero.appearance).toContain('penguin')
  })
  it('keeps authored names and motives active, while allowing generated fields to improve', () => {
    const before = original(), next = model(before), pending = pendingNarrativeSuggestions(next)
    expect(next.hero.name).toBe('阿禾')
    expect(next.narrative!.motivation).toBe(before.narrative!.motivation)
    expect(next.narrative!.conflict).toContain('航路被潮汐切断')
    expect(pending.map(item => item.path)).toEqual(expect.arrayContaining(['motivation', 'characters.hero.name']))
    expect(next.narrative!.source.originalStory).toBe(before.narrative!.source.originalStory)
    expect(next.narrative!.opening).not.toContain('小明')
  })
  it('shows proposed edits to locked nested text, retaining missing protected records', () => {
    const before = original(), n = before.narrative!, path = `chapters.${n.chapters[0].levelId}.points.${n.chapters[0].points[0].id}.description`
    n.source.lockedFields[path] = n.chapters[0].points[0].description
    n.source.lockedFields['characters.hero.name'] = before.hero.name
    const next = normalizeModelGameSpec({ narrative: { chapters: [{ levelId: n.chapters[0].levelId, points: [{ id: n.chapters[0].points[0].id, description: '新建议：这里藏着一份沉没船队的航行记录。' }] }], characters: [{ id: 'boss', name: before.boss.name, role: '最终对手' }] } }, before, 3, '')
    expect(next.narrative!.chapters[0].points[0].description).toBe(n.chapters[0].points[0].description)
    expect(pendingNarrativeSuggestions(next).find(item => item.path === path)?.after).toContain('新建议')
    expect(next.narrative!.characters.find(c => c.id === 'hero')?.name).toBe(before.hero.name)
  })
  it('adopts only the chosen field, updates its lock and leaves original input intact', () => {
    const before = original()
    before.narrative!.source.lockedFields.motivation = before.narrative!.motivation
    const next = model(before), proposal = pendingNarrativeSuggestions(next).find(item => item.path === 'motivation')!
    const accepted = decideNarrativeSuggestion(next, proposal.id, 'accepted')
    expect(accepted.narrative!.motivation).toBe(proposal.after)
    expect(accepted.narrative!.motivation).not.toContain('小明')
    expect(accepted.narrative!.source.lockedFields.motivation).toBe(proposal.after)
    expect(accepted.narrative!.source.playerFields['narrative.motivation']).toBe(proposal.after)
    expect(accepted.hero.name).toBe('阿禾')
    expect(accepted.narrative!.source.originalStory).toBe(before.narrative!.source.originalStory)
    expect(pendingNarrativeSuggestions(accepted).some(item => item.path === 'characters.hero.name')).toBe(true)
    expect(normalizeGameSpec(accepted, accepted, 3).narrative!.motivation).toBe(proposal.after)
  })
  it('updates character references after adopting a rename without changing locked prose', () => {
    const before = original()
    before.narrative!.clues[0].payoff = '阿禾终于认出了熟悉的航线。'
    before.narrative!.source.lockedFields.ending = before.narrative!.ending
    const next = model(before), proposal = pendingNarrativeSuggestions(next).find(item => item.path === 'characters.hero.name')!
    const accepted = decideNarrativeSuggestion(next, proposal.id, 'accepted')
    expect(accepted.hero.name).toBe('小明')
    expect(accepted.narrative!.characters.find(c => c.id === 'hero')!.name).toBe('小明')
    expect(accepted.narrative!.clues[0].payoff).toContain('小明')
    expect(accepted.narrative!.ending).toBe(before.narrative!.ending)
  })
  it('keeps discarded suggestions from reappearing and preserves runtime save identity', () => {
    const next = model(), dismissed = pendingNarrativeSuggestions(next).reduce((spec, item) => decideNarrativeSuggestion(spec, item.id, 'dismissed'), next)
    expect(pendingNarrativeSuggestions(dismissed)).toHaveLength(0)
    expect(sameSpecExceptSuggestions(next, dismissed)).toBe(true)
    expect(narrativeEngine.key(dismissed)).toBe(narrativeEngine.key(next))
    const offline = new Function(`${offlineNarrativeRuntimeSource()}; return storyEngine;`)() as typeof narrativeEngine
    expect(offline.key(next)).toBe(narrativeEngine.key(next))
    expect(offline.restore(dismissed, offline.fresh(next)).storyKey).toBe(narrativeEngine.key(next))
    const metadata = { ...dismissed, narrative: { ...dismissed.narrative!, source: { ...dismissed.narrative!.source, origin: 'player' as const, lockedFields: { opening: dismissed.narrative!.opening } } } }
    expect(narrativeEngine.key(metadata)).toBe(narrativeEngine.key(next))
    expect(offline.key(metadata)).toBe(narrativeEngine.key(next))
    const again = model(dismissed)
    expect(again.narrative!.suggestions!.length).toBe(dismissed.narrative!.suggestions!.length)
    expect(pendingNarrativeSuggestions(again)).toHaveLength(0)
    expect(normalizeGameSpec(JSON.parse(JSON.stringify(dismissed)), dismissed, 3).narrative!.suggestions).toEqual(dismissed.narrative!.suggestions)
  })
  it('never overwrites an intervening manual edit with an outdated proposal', () => {
    const next = model(), proposal = pendingNarrativeSuggestions(next).find(item => item.path === 'motivation')!
    next.narrative = recordNarrativeEdit({ ...next.narrative!, motivation: '我改成了寻找童年失散的朋友，其他事情可以等一等。' }, 'motivation', '我改成了寻找童年失散的朋友，其他事情可以等一等。')
    expect(narrativeSuggestionStatus(next.narrative, proposal)).toBe('stale')
    const accepted = decideNarrativeSuggestion(next, proposal.id, 'accepted')
    expect(accepted.narrative!.motivation).toBe(next.narrative.motivation)
    expect(accepted.narrative!.suggestions!.find(item => item.id === proposal.id)!.status).toBe('stale')
  })
  it('does not trust model-supplied accepted decisions or arbitrary edit paths', () => {
    const before = original(), next = normalizeModelGameSpec({ narrative: { suggestions: [{ path: '__proto__.name', before: '', after: 'bad', status: 'accepted' }, { path: 'motivation', before: before.narrative!.motivation, after: 'forged', status: 'accepted' }] } }, before, 3, '')
    expect(next.narrative!.suggestions || []).toEqual([])
    expect(next.narrative!.motivation).toBe(before.narrative!.motivation)
  })
  it('shares retained facts with specialists and carries suggestions through program integration', () => {
    const before = original(), narrative = normalizeArtifact(request('narrative', before), { artifact: { narrative: { motivation: '我决定放弃找人，转而赢得竞赛的冠军。', characters: [{ id: 'hero', role: '主角', name: '小明' }] } } }).artifact
    expect((narrative.narrative as typeof before.narrative)!.motivation).toBe(before.narrative!.motivation)
    expect((narrative.narrative as typeof before.narrative)!.characters[0].name).toBe('阿禾')
    expect((narrative.narrative as typeof before.narrative)!.chapters).toBeUndefined()
    const mechanics = request('mechanics', before)
    mechanics.artifacts.narrative = narrative
    expect(buildAgentPrompts(mechanics).user).not.toContain('转而赢得竞赛')
    expect(buildAgentPrompts(mechanics).user).not.toContain('小明')
    const task = request('integrator', before)
    task.artifacts.narrative = narrative
    const integrated = deterministicAgentResponse(task)!.data!.artifact.spec as typeof before
    expect(pendingNarrativeSuggestions(integrated).some(item => item.path === 'motivation')).toBe(true)
    expect(integrated.hero.name).toBe('阿禾')
  })
  it('applies the same decision requirement to WebLLM and scoped refinements', () => {
    const before = original(), candidate = model(before)
    const browser = applyWebLlmCreativePatch(before, { heroName: '小明', world: '一座仍在运转的星光群岛。' })
    expect(browser.hero.name).toBe('阿禾')
    expect(pendingNarrativeSuggestions(browser).some(item => item.path === 'characters.hero.name')).toBe(true)
    const story = mergeRefinement(before, candidate, 'story')
    expect(pendingNarrativeSuggestions(story).map(item => item.path)).toEqual(['motivation'])
    expect(story.narrative!.motivation).toBe(before.narrative!.motivation)
    const carried = carryPendingNarrativeSuggestions(before, candidate.narrative!.suggestions!.map(item => ({ ...item, status: 'accepted' })))
    expect(carried.narrative!.suggestions!.every(item => item.status === 'pending')).toBe(true)
  })
  it('preserves completed task results and approval for decisions alone; rejects content or active-run changes', () => {
    const next = model(), dismissed = pendingNarrativeSuggestions(next).reduce((spec, item) => decideNarrativeSuggestion(spec, item.id, 'dismissed'), next)
    const run: AgentRun = { version: 1, id: 'decision-run', projectId: 'draft', sourcePrompt: '', projectName: next.title, levelCount: 3, currentRound: 1, maxReviewRounds: 2, createdAt: 1, updatedAt: 1, status: 'awaiting_approval', approved: false, modelLock: { provider: 'openrouter', model: 'locked-test-model' }, tasks: [{ id: 'integrator-r1', role: 'integrator', phase: 'planning', round: 1, dependencies: [], status: 'completed', attempts: 1, usage: { promptTokens: 60, completionTokens: 40, totalTokens: 100 }, output: { spec: next } }], artifacts: { productionSpec: next } }
    const updated = updateRunNarrativeDecisions(run, dismissed)
    expect(updated.modelLock).toBe(run.modelLock)
    expect(updated.tasks[0].status).toBe('completed')
    expect(updated.tasks[0].usage).toBe(run.tasks[0].usage)
    expect(updated.approved).toBe(false)
    expect(pendingNarrativeSuggestions(updated.artifacts.productionSpec)).toHaveLength(0)
    expect(updateRunNarrativeDecisions(run, { ...dismissed, title: 'changed' })).toBe(run)
    expect(updateRunNarrativeDecisions({ ...run, status: 'planning' }, dismissed).status).toBe('planning')
  })
})
