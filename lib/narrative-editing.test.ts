import { describe, expect, it, vi, afterEach } from 'vitest'
import { createFallbackGameSpec, normalizeGameSpec } from './game-spec'
import { alignNarrativeCast, normalizeNarrative, narrativeProblems } from './narrative'
import { recordNarrativeEdit } from './narrative-editing'
import { mergeRefinement } from './refine-game-spec'
import { deterministicAgentResponse, normalizeArtifact } from './agents/execution'
import { narrativeEngine } from './narrative-runtime'
import { playtestCoverage, readPlaytestEvidence, recordPlaytestProgress } from './playtest-evidence'
import type { AgentExecuteRequest } from '@/types'
import { extractStoryAnchors } from './story-anchors'
import { buildGameDataFromSpec } from './virtual-levels'
import { migrateGameData } from './store'

afterEach(() => vi.unstubAllGlobals())
const draft = () => createFallbackGameSpec('世界观与故事：年轻地图师要找回失踪船队，修复三座灯塔。\n主角：阿禾 — 红色外套，测绘工具\nBoss：风暴守卫 — 受损的航路看守者\n结局方向：船队平安回港，阿禾留下修复灯塔。', '星潮', 3)
const request = (role: AgentExecuteRequest['role'], spec = draft()): AgentExecuteRequest => ({ role, runId: 'review', taskId: role, round: 1, projectName: spec.title, sourcePrompt: '', levelCount: spec.levels.length, baseSpec: spec, artifacts: {}, provider: 'openrouter', model: 'google/gemini-2.5-flash', apiKey: '' })

describe('narrative editing and truthful evidence', () => {
  it('keeps the named protagonist, occupation, appearance, core events and ending of a complete player story', () => {
    const story = '艾岚是一名失去听力的钟表匠，常穿灰色工装。矿城的报时核心突然停摆，妹妹被困在封锁区。她决定沿着地下传动管廊寻找故障源，收集三枚发条片。旧维修单记录着父亲留下的校时顺序，她逐渐发现封锁并非报时核心的本意，而是守卫仍在执行多年前的避险指令。她必须穿过三片维修区，确认各处的传动记录，找到能够解除错误命令的入口。最后，艾岚修好了报时核心，带着妹妹回到钟表铺，继续修理普通人的时钟。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}\n人物关系：艾岚与妹妹相互信任，营救妹妹是她出发的原因。`, '停摆的钟声', 3)
    expect(spec.hero.name).toBe('艾岚')
    expect(spec.hero.appearance).toContain('失去听力的钟表匠')
    expect(spec.hero.appearance).toContain('灰色工装')
    expect(spec.narrative!.source.originalStory).toBe(story)
    expect(spec.narrative!.opening).toContain('妹妹被困在封锁区')
    expect(spec.narrative!.opening).not.toContain('带着妹妹回到钟表铺')
    expect(spec.narrative!.opening).not.toContain('她逐渐发现')
    expect(spec.narrative!.ending).toContain('带着妹妹回到钟表铺')
    expect(spec.narrative!.characters[0].relationship).toContain('相互信任')
    expect(narrativeProblems(spec)).toEqual([])
  })
  it('does not turn people or a missing fleet into collectible items', () => {
    expect(extractStoryAnchors('地图师要找回失踪船队，收集星火并修复灯塔。').collectible).toBe('星火')
    expect(extractStoryAnchors('骑士要寻找失踪的妹妹。').collectible).toBeUndefined()
    expect(createFallbackGameSpec('世界观与故事：地图师要找回失踪船队。', '归航', 2).collectible.name).not.toContain('船队')
  })
  it('creates no solid obstacles when all obstacle assets have been disabled', () => {
    const spec = draft()
    spec.assets.forEach(asset => { asset.url = 'test.png'; if (['normalObstacle', 'bounceObstacle', 'deathObstacle'].includes(asset.category)) asset.enabled = false })
    expect(buildGameDataFromSpec(spec).data!.levels.every(level => level.obstacles.length === 0)).toBe(true)
  })
  it('keeps source, locks and save identity when storing a new game; adds no task gates to legacy games', () => {
    const spec = draft(); spec.narrative!.source.lockedFields.opening = spec.narrative!.opening
    const game = buildGameDataFromSpec(spec)
    const migrated = migrateGameData(game, 'custom-project-id').data!.spec
    expect(migrated.narrative!.source).toEqual(spec.narrative!.source)
    expect(migrated.narrative).toEqual(spec.narrative)
    expect(narrativeEngine.key(migrated)).toBe(narrativeEngine.key(spec))
    const legacy = structuredClone(game); delete legacy.data!.spec.narrative
    const restored = migrateGameData(legacy, 'legacy-project')
    expect(restored.data!.spec.narrative).toBeUndefined()
    expect(restored.data!.levels).toEqual(legacy.data!.levels)
  })
  it('keeps player names, explicit resolution and original source across normalization', () => {
    const spec = draft()
    expect(spec.narrative!.characters.find(c => c.id === 'hero')!.name).toBe('阿禾')
    expect(spec.narrative!.characters.find(c => c.id === 'boss')!.name).toBe('风暴守卫')
    expect(spec.narrative!.resolution).toBe('船队平安回港，阿禾留下修复灯塔。')
    const normalized = normalizeGameSpec(spec, spec, 3)
    expect(normalized.narrative!.source.originalStory).toBe(spec.narrative!.source.originalStory)
    expect(normalized.narrative!.ending).toContain('船队平安回港')
  })
  it('locks characters, clues, chapter feedback and tasks across model refinements', () => {
    const spec = draft(), n = spec.narrative!, chapter = n.chapters[0], task = chapter.objectives[0]
    n.source.lockedFields = { 'characters.hero.name': '玩家主角', 'clues.main-clue.payoff': '玩家设定的线索答案', [`chapters.${chapter.levelId}.departure`]: '玩家写下的本关结尾', [`chapters.${chapter.levelId}.objectives.${task.id}.feedback`]: '玩家指定的完成反馈' }
    const candidate = structuredClone(spec)
    candidate.narrative!.characters[0].name = '模型改名'
    candidate.narrative!.clues[0].payoff = '模型改线索'
    candidate.narrative!.chapters[0].departure = '模型改结尾'
    const normalized = normalizeNarrative({ ...candidate.narrative, source: n.source }, candidate, n)
    expect(normalized.characters[0].name).toBe('玩家主角')
    expect(normalized.clues[0].payoff).toBe('玩家设定的线索答案')
    expect(normalized.chapters[0].departure).toBe('玩家写下的本关结尾')
    expect(normalized.chapters[0].objectives[0].feedback).toBe('玩家指定的完成反馈')
    expect(alignNarrativeCast({ ...candidate, narrative: normalized }).hero.name).toBe('玩家主角')
    expect(recordNarrativeEdit(normalized, 'characters.hero.name', '新的玩家姓名').source.lockedFields['characters.hero.name']).toBe('新的玩家姓名')
  })
  it('fills blank character, clue, chapter, art and story fields without replacing existing text or cached art', () => {
    const spec = draft(), candidate = structuredClone(spec)
    spec.narrative!.characters[0].motivation = ''
    spec.narrative!.clues[0].payoff = ''
    spec.narrative!.chapters[1].arrival = ''
    spec.visualStyle.artDirection = ''
    spec.assets[0].url = 'data:image/png;base64,player-upload'
    const merged = mergeRefinement(spec, candidate, 'missing')
    expect(merged.narrative!.characters[0].motivation).toBe(candidate.narrative!.characters[0].motivation)
    expect(merged.narrative!.clues[0].payoff).toBe(candidate.narrative!.clues[0].payoff)
    expect(merged.narrative!.chapters[1].arrival).toBe(candidate.narrative!.chapters[1].arrival)
    expect(merged.visualStyle.artDirection).toBe(candidate.visualStyle.artDirection)
    expect(merged.narrative!.opening).toBe(spec.narrative!.opening)
    expect(merged.assets).toBe(spec.assets)
  })
  it('rejects cross-level duplicate task IDs, wrong interaction targets and payoffs before their clue', () => {
    const spec = draft(), n = spec.narrative!
    n.chapters[1].objectives[0].id = n.chapters[0].objectives[0].id
    n.chapters[0].objectives[1].target = 'exit'
    n.clues[0].levelId = spec.levels[2].id
    n.clues[0].payoffLevelId = spec.levels[0].id
    const messages = narrativeProblems(spec).map(item => item.message).join('\n')
    expect(messages).toContain('任务 ID 重复')
    expect(messages).toContain('类型不符')
    expect(messages).toContain('不能早于')
  })
  it('marks unsupported narrative mechanics as unimplemented instead of certifying them as gameplay', () => {
    const spec = draft()
    spec.narrative!.clues[0].payoff = '主角利用信件碎片干扰哨兵的防御系统，使护盾失效。'
    const issues = narrativeProblems(spec)
    expect(issues.some(issue => issue.path === 'narrative.unimplemented' && issue.severity === 'warning')).toBe(true)
  })
  it('flags unsupported Boss descriptions and repeated chapter outcomes for review', () => {
    const spec = draft()
    spec.boss.attackPattern = '挥动盾牌产生冲击波，砸地造成范围伤害。'
    spec.narrative!.chapters[1].departure = spec.narrative!.chapters[0].departure
    const issues = narrativeProblems(spec)
    expect(issues.some(issue => issue.path === 'narrative.unimplemented' && issue.message.includes('Boss'))).toBe(true)
    expect(issues.some(issue => issue.path === 'narrative.chapters.departure' && issue.severity === 'warning')).toBe(true)
  })
  it('never accepts a model claim as proof of actual gameplay or inspecting unsupplied images', () => {
    const req = request('playtest')
    const report = normalizeArtifact(req, { artifact: { verdict: 'all passed', checks: ['won game'] } }).artifact
    expect(report.status).toBe('not-tested')
    const visual = normalizeArtifact({ ...req, role: 'visualQa', imageUrls: ['https://example.com/hero.png'], imageLabels: ['hero:idle'] }, { artifact: { checkedAssets: ['unseen-boss:walk'] } }).artifact
    expect(visual.checkedAssets).toEqual([])
    const publisher = deterministicAgentResponse({ ...req, role: 'publisher', artifacts: { playtestReport: report, visualReport: visual } })
    expect(publisher!.data!.artifact.ready).toBe(false)
    expect(publisher!.data!.usage.totalTokens).toBe(0)
  })
  it('does not label an empty or unrelated model object as a successful creative patch', () => {
    const req = { ...request('integrator'), runId: 'prompt-optimize-empty' }
    expect(() => normalizeArtifact(req, { artifact: { spec: {} } })).toThrow('没有返回可用的设定字段')
    expect(() => normalizeArtifact(req, { artifact: { spec: { irrelevant: true } } })).toThrow('没有返回可用的设定字段')
  })
  it('preserves the original player source and locks through actual specialist integration and model revision', () => {
    const spec = draft()
    spec.narrative!.source.lockedFields.motivation = '邮差承诺把每封信亲手交给收信人。'
    spec.narrative!.motivation = spec.narrative!.source.lockedFields.motivation
    const req = { ...request('integrator', spec), artifacts: { narrative: { narrative: { motivation: '模型改写了玩家锁定的动机。' } } } }
    const integrated = deterministicAgentResponse(req)!.data!.artifact.spec as typeof spec
    expect(integrated.narrative!.motivation).toBe(spec.narrative!.motivation)
    expect(integrated.narrative!.source.origin).toBe('model')
    const revised = normalizeArtifact({ ...req, role: 'revision', artifacts: { mergedSpec: integrated } }, { artifact: { spec: { narrative: { motivation: '修订再次改变原文。' } } } }).artifact.spec as typeof spec
    expect(revised.narrative!.motivation).toBe(spec.narrative!.motivation)
    expect(revised.narrative!.source.originalStory).toBe(spec.narrative!.source.originalStory)
  })
  it('applies a one-level revision without duplicating other levels or replacing interaction IDs', () => {
    const spec = draft(), point = spec.narrative!.chapters[0].points[0]
    const revised = normalizeGameSpec({ levels: [{ id: spec.levels[0].id, platformMode: 'ground' }], narrative: { chapters: [{ levelId: spec.levels[0].id, points: [{ id: point.id, description: '检查信件残页，找到下一站的方向。' }] }] } }, spec, 3)
    expect(revised.levels.map(level => level.id)).toEqual(spec.levels.map(level => level.id))
    expect(revised.narrative!.chapters.map(chapter => chapter.levelId)).toEqual(spec.levels.map(level => level.id))
    expect(revised.narrative!.chapters[0].points[0].id).toBe(point.id)
    expect(revised.narrative!.chapters[0].points[0].position).toBe(point.position)
    expect(narrativeProblems(revised)).toEqual([])
  })
  it('rejects a model revision that introduces an invalid task reference and keeps the original review outstanding', () => {
    const spec = draft()
    const req = { ...request('revision', spec), artifacts: { reviewIssues: [{ id: 'story-review', severity: 'blocking' as const, source: 'consistencyCritic' as const, path: 'narrative.conflict', message: '需要说明对手阻拦的原因。', suggestion: '定向补充原因。' }] } }
    const task = spec.narrative!.chapters[0].objectives.find(item => item.kind === 'interact')!
    const output = normalizeArtifact(req, { artifact: { spec: { narrative: { chapters: [{ levelId: spec.levels[0].id, objectives: [{ id: task.id, target: 'missing-chapter-point' }] }] } } } })
    expect(output.artifact.patchRejected).toBe(true)
    expect(narrativeProblems(output.artifact.spec as typeof spec)).toEqual([])
    expect(output.issues.some(issue => issue.id === 'story-review' && issue.severity === 'blocking')).toBe(true)
  })
  it('collects real runtime completion evidence across chapters and keeps it separate from the current save', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    const spec = draft()
    let state = narrativeEngine.fresh(spec)
    for (const level of spec.levels) {
      state = narrativeEngine.begin(spec, state, level.id)
      if (level.id === spec.levels[0].id) expect(state.history.some(entry => entry.id.startsWith('clue:'))).toBe(false)
      for (const task of spec.narrative!.chapters.find(c => c.levelId === level.id)!.objectives) for (let i = 0; i < task.count; i++) state = narrativeEngine.emit(spec, state, { id: `${task.id}-${i}`, kind: task.kind, target: task.target, levelId: level.id })
      state = narrativeEngine.finish(spec, state)
      recordPlaytestProgress(state)
    }
    expect(playtestCoverage(spec, readPlaytestEvidence(spec)).status).toBe('observed-complete')
    expect(state.history.some(entry => entry.id === 'clue:main-clue:setup')).toBe(true)
    expect(state.history.some(entry => entry.id === 'clue:main-clue:payoff')).toBe(true)
    recordPlaytestProgress(narrativeEngine.fresh(spec))
    expect(playtestCoverage(spec, readPlaytestEvidence(spec)).status).toBe('observed-complete')
    const changed = structuredClone(spec); changed.narrative!.ending = '另一个结局'
    expect(readPlaytestEvidence(changed)).toBeUndefined()
  })
})
