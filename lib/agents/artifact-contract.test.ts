import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec } from '@/lib/game-spec'
import type { AgentExecuteRequest } from '@/types'
import { hasUsableRevisionPatch, normalizeArtifact } from './execution'

const request = (role: AgentExecuteRequest['role']): AgentExecuteRequest => ({
  runId: 'contract-check', taskId: `${role}-r1`, role, round: 1,
  provider: 'openrouter', model: 'test-model', apiKey: '', projectName: '云中邮差',
  sourcePrompt: '邮差，风，失踪的信。', levelCount: 2,
  baseSpec: createFallbackGameSpec('邮差，风，失踪的信。', '云中邮差', 2), artifacts: {},
})

describe('specialist output contract', () => {
  it('accepts bare role fields while stripping credentials and unrelated fields', () => {
    const artifact = normalizeArtifact(request('director'), { title: '云中邮差', playerFantasy: '穿越风暴送达信件', apiKey: 'never-store', levels: [{ id: 'intruder' }] }).artifact
    expect(artifact).toEqual({ title: '云中邮差', playerFantasy: '穿越风暴送达信件' })
  })
  it('keeps bare level and chapter content for later integration', () => {
    const raw = { levels: [{ id: 'level-1', name: '浮岛邮站' }], narrative: { chapters: [{ levelId: 'level-1', arrival: '邮差找到破损邮包的碎片。' }] } }
    expect(normalizeArtifact(request('levelDesigner'), raw).artifact).toEqual(raw)
    expect(normalizeArtifact(request('levelDesigner'), { artifact: raw }).artifact).toEqual(raw)
  })
  it('does not silently advance empty or unrecognized author outputs', () => {
    for (const role of ['director', 'narrative', 'mechanics', 'artDirector', 'levelDesigner', 'assetCoordinator'] as const) {
      for (const output of [{}, { summary: '完成' }, { artifact: {} }, { artifact: { unrelated: '说明' } }]) {
        expect(() => normalizeArtifact(request(role), output)).toThrow('原草案已保留')
      }
    }
    expect(() => normalizeArtifact(request('levelDesigner'), { artifact: { progressionNotes: '逐渐增加难度' } })).toThrow('没有返回关卡或章节内容')
  })
  it('accepts an explicit empty review list as a valid review result', () => {
    expect(normalizeArtifact(request('consistencyCritic'), { artifact: { issues: [] } }).artifact.issues).toEqual([])
    expect(normalizeArtifact(request('assetCoordinator'), { artifact: { assetPromptPatches: [] } }).artifact.spec).toBeDefined()
  })
  it('does not treat five ordinary enemies plus a Boss as a numeric violation', () => {
    const original = request('consistencyCritic')
    const levels = original.baseSpec!.levels.map((level, index) => index === 1 ? { ...level, enemyCount: 5, hasBoss: true } : level)
    const result = normalizeArtifact({ ...original, baseSpec: { ...original.baseSpec!, levels } }, {
      artifact: { issues: [{ severity: 'blocking', path: 'levels[1].enemyCount', message: '五名普通敌人已占满名额，无法再容纳Boss。', suggestion: '删去一名敌人。' }] },
    })
    expect(result.issues.find(item => item.path === 'levels[1].enemyCount')?.severity).toBe('warning')
  })
  it('checks final narrative criticism against implemented combat and clue timing', () => {
    const original = request('consistencyCritic')
    const story = '林澈击败守钟机械，让它认出真正的维修指令，救回阿遥。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '倒走的城', 3)
    spec.levels[2].enemyCount = 5
    const issues = normalizeArtifact({ ...original, sourcePrompt: story, levelCount: 3, baseSpec: spec }, { artifact: { issues: [
      { severity: 'blocking', path: 'narrative.chapters[2].objectives[3].description', message: 'Boss任务击败守钟机械与认出维修指令矛盾，须改成逻辑识别类Boss机制。', suggestion: '用特殊机制取代战斗。' },
      { severity: 'blocking', path: 'narrative.chapters[2].objectives[2].description', message: '五名普通敌人加Boss超过上限，无法容纳Boss。', suggestion: '删掉一名敌人。' },
      { severity: 'blocking', path: 'narrative.clues[1].payoff', message: '这条线索必须在Boss战前得知。', suggestion: '移到此前调查。' },
    ] } }).issues
    expect(issues.filter(item => item.severity === 'blocking')).toEqual([])
    expect(issues).toHaveLength(3)
    const pacifist = createFallbackGameSpec('世界观与故事：林澈不能伤害守钟机械，只能说服它。', '和平钟楼', 3)
    const pacifistIssues = normalizeArtifact({ ...original, sourcePrompt: pacifist.narrative!.source.originalStory, levelCount: 3, baseSpec: pacifist }, { artifact: { issues: [
      { severity: 'blocking', path: 'narrative.chapters[2].objectives[3].description', message: 'Boss任务击败守钟机械与认出维修指令矛盾，须改成逻辑识别类Boss机制。', suggestion: '改为非暴力。' },
    ] } }).issues
    expect(pacifistIssues.some(item => item.severity === 'blocking')).toBe(true)
  })
  it('runs program checks after the last independent review even when the model reports no issues', () => {
    const original = request('consistencyCritic')
    const spec = createFallbackGameSpec('世界观与故事：林澈击败守钟机械后找回阿遥。', '倒走的城', 3)
    spec.narrative!.chapters[2].bossAfter = '基座浮现校准接口。'
    const result = normalizeArtifact({ ...original, taskId: 'consistencyCritic-final-r2', levelCount: 3, baseSpec: spec }, { artifact: { issues: [] } })
    expect(result.issues.some(item => item.severity === 'blocking' && item.path.endsWith('bossAfter'))).toBe(true)
  })
  it('accepts a direct revision patch but rejects a summary without changes', () => {
    expect(hasUsableRevisionPatch({ levels: [{ id: 'level-2', collectibleCount: 2 }] })).toBe(true)
    expect(hasUsableRevisionPatch({ spec: { narrative: { chapters: [{ levelId: 'level-2', departure: '新线索' }] } } })).toBe(true)
    expect(hasUsableRevisionPatch({ issues: [], summary: '已修订' })).toBe(false)
  })
  it('does not block production for speculative prompt-improvement advice', () => {
    const result = normalizeArtifact(request('assetCoordinator'), {
      artifact: { assetPromptPatches: [] },
      issues: [{ severity: 'blocking', path: 'assets[0].prompt', message: '细节可能不够', suggestion: '补足画面细节' }],
    })
    expect(result.issues.find(issue => issue.path === 'assets[0].prompt')?.severity).toBe('warning')
  })
  it('keeps reviewed platform modes when a story-only revision tries to change them', () => {
    const original = request('revision')
    const baseSpec = { ...original.baseSpec!, levels: original.baseSpec!.levels.map(level => ({ ...level, platformMode: 'ground' as const })) }
    const revised = normalizeArtifact({ ...original, baseSpec, artifacts: {
      reviewIssues: [{ id: 'boss-copy', source: 'consistencyCritic', severity: 'blocking', path: 'narrative.chapters.1.objectives.level-2-boss', message: 'Boss 文案承诺额外物品操作。', suggestion: '改成普通战斗。' }],
    } }, { artifact: { spec: { levels: [{ id: baseSpec.levels[0].id, platformMode: 'air' }], narrative: { resolution: '战斗结束后读出信件，继续前往收信人的灯塔。' } } } }).artifact.spec as typeof baseSpec
    expect(revised.levels[0].platformMode).toBe('ground')
  })
  it('keeps a Boss objective executable when a prose revision calls it an ordinary defeat task', () => {
    const original = request('revision')
    const baseSpec = original.baseSpec!
    const chapter = baseSpec.narrative!.chapters.find(item => item.objectives.some(task => task.kind === 'boss'))!
    const bossTask = chapter.objectives.find(task => task.kind === 'boss')!
    const result = normalizeArtifact({ ...original, artifacts: { reviewIssues: [] } }, {
      artifact: { spec: { narrative: { chapters: [{ levelId: chapter.levelId, objectives: [{ id: bossTask.id,
        kind: 'defeat', target: 'enemies', count: 1, prerequisites: [], description: '击败最终 Boss。' }] }] } } },
    })
    const revised = result.artifact.spec as typeof baseSpec
    const task = revised.narrative!.chapters.find(item => item.levelId === chapter.levelId)!.objectives.find(item => item.id === bossTask.id)!
    expect(task.kind).toBe('boss')
    expect(task.target).toBe('boss')
    expect(task.description).toBe('击败最终 Boss。')
  })
  it('replaces a model-invented corridor with an existing exit and reports the correction', () => {
    const original = request('revision')
    const baseSpec = original.baseSpec!
    const levelId = baseSpec.levels[0].id
    const output = normalizeArtifact({ ...original, artifacts: { reviewIssues: [{ id: 'passage', source: 'engineQa', severity: 'blocking', path: 'narrative.chapters.0.departure', message: '暗道不在游戏里。', suggestion: '使用现有出口。' }] } }, {
      artifact: { spec: { narrative: { chapters: [{ levelId, departure: '怀表指向铭牌，通道自动开启。' }] } } },
    })
    const revised = output.artifact.spec as typeof baseSpec
    expect(revised.narrative!.chapters[0].departure).toContain('沿出口继续前行')
    expect(output.issues.some(issue => issue.id === 'revision-align-existing-exit')).toBe(true)
    expect(output.issues.some(issue => issue.severity === 'blocking')).toBe(false)
  })
})
