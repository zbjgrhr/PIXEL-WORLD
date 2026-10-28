import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec, normalizeGameSpec, preserveExplicitPromptFields } from './game-spec'
import { alignGeneratedPassages, ensureNarrative, narrativeProblems, normalizeNarrative } from './narrative'
import { narrativeEngine as engine, offlineNarrativeRuntimeSource } from './narrative-runtime'
import { mergeRefinement } from './refine-game-spec'
import { normalizeModelGameSpec } from './model-game-spec'
import { pendingNarrativeSuggestions } from './narrative-suggestions'
import { extractStoryAnchors } from './story-anchors'

describe('complete narrative generation and task execution', () => {
  it('keeps a named rescue as the hero goal when the story also describes repairs', () => {
    const story = '钟表匠林澈带着妹妹阿遥来到倒走的城。守钟机械带走阿遥。林澈穿过三处街巷，修好三枚钟芯，击败守钟机械，救回阿遥，最后把中央钟调回正向。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '钟芯任务浏览器验收', 3)
    expect(spec.narrative!.motivation).toContain('救回阿遥')
    expect(spec.narrative!.incitingIncident).toBe('守钟机械带走阿遥。')
    expect(spec.narrative!.bossRelation).toContain('守钟机械带走了阿遥')
    expect(spec.narrative!.conflict).toContain('救回阿遥')
    expect(spec.creativeBrief?.heroGoal).toContain('救回阿遥')
    expect(spec.narrative!.opening).toContain('救回阿遥')
    expect(spec.narrative!.opening).not.toContain('林澈击败守钟机械')
    expect(spec.narrative!.ending).toContain('救回阿遥')
  })
  it('turns three repairs in the player story into three playable chapter actions before the Boss', () => {
    const story = '钟表匠林澈穿过停摆街巷，修好三枚钟芯，在中央钟室击败守钟机械，救回妹妹阿遥。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '倒走的城', 3)
    const chapters = spec.narrative!.chapters
    const repairs = chapters.map(chapter => chapter.objectives.find(task => task.id.includes('-story-action-'))!)
    expect(repairs.map(task => task.description)).toEqual([
      expect.stringContaining('修好第一枚钟芯'), expect.stringContaining('修好第二枚钟芯'), expect.stringContaining('修好第三枚钟芯'),
    ])
    expect(chapters.every((chapter, index) => chapter.points.some(point => point.id === repairs[index].target))).toBe(true)
    const boss = chapters[2].objectives.find(task => task.kind === 'boss')!
    expect(boss.prerequisites).toContain(repairs[2].id)
    let state = engine.begin(spec, engine.fresh(spec), chapters[2].levelId)
    expect(engine.objectives(spec, state).find(task => task.id === boss.id)?.available).toBe(false)
    const clue = chapters[2].objectives.find(task => task.id.endsWith('-interact'))!
    for (let index = 0; index < chapters[2].objectives.find(task => task.kind === 'collect')!.count; index++)
      state = engine.emit(spec, state, { id: `pickup-${index}`, kind: 'collect', target: 'collectible', levelId: chapters[2].levelId })
    state = engine.emit(spec, state, { id: 'clue', kind: 'interact', target: clue.target, levelId: chapters[2].levelId })
    state = engine.emit(spec, state, { id: 'repair', kind: 'interact', target: repairs[2].target, levelId: chapters[2].levelId })
    expect(engine.objectives(spec, state).find(task => task.id === boss.id)?.available).toBe(true)
  })
  it('keeps an explicit multi-part story action when a model drops its point and objective', () => {
    const story = '地图师点亮三座灯塔，击败守卫，找回船队。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '灯塔归航', 3)
    const base = spec.narrative!
    const rewritten = normalizeNarrative({ chapters: base.chapters.map(chapter => ({
      ...chapter,
      points: chapter.points.filter(point => !point.id.includes('-story-point-')),
      objectives: chapter.objectives.filter(task => !task.id.includes('-story-action-')),
    })) }, spec, base)
    rewritten.chapters.forEach(chapter => {
      const action = chapter.objectives.find(task => task.id.includes('-story-action-'))!
      expect(action.description).toContain('点亮')
      expect(chapter.points.some(point => point.id === action.target)).toBe(true)
      expect(chapter.objectives.find(task => task.target === 'exit')!.prerequisites).toContain(action.id)
    })
  })
  it('keeps named characters and the authored resolution in a complete rescue story', () => {
    const story = '钟表匠林澈带着妹妹阿遥来到一座每天倒走一分钟的城。她在维修中央报时钟时被城里的守钟机械带走。林澈从旧钟表铺找到一张被涂改的维修单，得知机械把维修者误认成破坏者。他穿过停摆街巷、报时钟楼，修好三枚钟芯，在中央钟室让机械认出真正的维修指令。机械放走阿遥，兄妹把钟调回正向，广场重新响起清晨的钟声。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '倒走的城', 3)
    expect(spec.hero.name).toBe('林澈')
    expect(spec.boss.name).toBe('守钟机械')
    expect(spec.world).toContain('每天倒走一分钟的城')
    expect(spec.world).not.toContain('雾城钟坊')
    expect(spec.narrative!.motivation).toContain('阿遥')
    expect(spec.narrative!.bossRelation).toContain('误把维修者当成破坏者')
    expect(spec.narrative!.opening).not.toContain('机械放走阿遥')
    expect(spec.narrative!.ending).toContain('机械放走阿遥')
    expect(spec.narrative!.ending).toContain('广场重新响起清晨的钟声')
    expect(spec.narrative!.source.originalStory).toBe(story)
    const final = spec.narrative!.chapters.at(-1)!
    const adjustment = final.objectives.find(task => task.id.endsWith('-adjust-clock'))!
    const bossTask = final.objectives.find(task => task.kind === 'boss')!
    const recognition = final.objectives.find(task => task.id.endsWith('-recognize-instruction'))!
    expect(bossTask.description).toBe('使守钟机械停止攻击')
    expect(recognition.description).toContain('让守钟机械认出真正的维修指令')
    expect(recognition.prerequisites).toContain(bossTask.id)
    expect(final.points.some(point => point.id === recognition.target)).toBe(true)
    expect(narrativeProblems(spec).filter(issue => issue.severity !== 'warning')).toEqual([])
    expect(adjustment.prerequisites).toContain(bossTask.id)
    expect(adjustment.prerequisites).toContain(recognition.id)
    expect(final.points.some(point => point.id === adjustment.target)).toBe(true)
    expect(final.objectives.find(task => task.kind === 'reach' && task.target === 'exit')!.prerequisites).toContain(adjustment.id)
    let state = engine.begin(spec, engine.fresh(spec), final.levelId)
    state = engine.emit(spec, state, { id: 'early-adjust', kind: 'interact', target: adjustment.target, levelId: final.levelId })
    expect(state.counts[adjustment.id] || 0).toBe(0)
    const collect = final.objectives.find(task => task.kind === 'collect')!
    for (let index = 0; index < collect.count; index++) state = engine.emit(spec, state, { id: `final-pickup-${index}`, kind: 'collect', target: 'collectible', levelId: final.levelId })
    const clue = final.objectives.find(task => task.id.endsWith('-interact'))!
    state = engine.emit(spec, state, { id: 'final-clue', kind: 'interact', target: clue.target, levelId: final.levelId })
    const repair = final.objectives.find(task => task.id.includes('-story-action-'))!
    state = engine.emit(spec, state, { id: 'final-repair', kind: 'interact', target: repair.target, levelId: final.levelId })
    state = engine.emit(spec, state, { id: 'defeat-boss', kind: 'boss', target: 'boss', levelId: final.levelId })
    state = engine.emit(spec, state, { id: 'early-adjust-after-boss', kind: 'interact', target: adjustment.target, levelId: final.levelId })
    expect(state.counts[adjustment.id] || 0).toBe(0)
    state = engine.emit(spec, state, { id: 'recognize-instruction', kind: 'interact', target: recognition.target, levelId: final.levelId })
    expect(state.counts[recognition.id]).toBe(1)
    state = engine.emit(spec, state, { id: 'adjust-clock', kind: 'interact', target: adjustment.target, levelId: final.levelId })
    expect(state.counts[adjustment.id]).toBe(1)
  })
  it('restores the authored instruction recognition when a model omits it', () => {
    const story = '钟表匠林澈带着妹妹阿遥来到倒走的城。她被守钟机械带走。林澈修好三枚钟芯，在中央钟室让守钟机械认出真正的维修指令。机械放走阿遥，林澈把中央钟调回正向。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '钟芯故事', 3)
    expect(spec.boss.name).toBe('守钟机械')
    const final = spec.narrative!.chapters.at(-1)!
    expect(final.objectives.some(task => task.id.endsWith('-recognize-instruction'))).toBe(true)
    const rewritten = normalizeNarrative({ chapters: spec.narrative!.chapters.map(chapter => chapter.levelId === final.levelId
      ? { ...chapter, points: chapter.points.filter(point => !point.id.endsWith('-instruction-point')), objectives: chapter.objectives.filter(task => !task.id.endsWith('-recognize-instruction')) }
      : chapter) }, spec, spec.narrative!)
    const restored = rewritten.chapters.at(-1)!
    const task = restored.objectives.find(objective => objective.id.endsWith('-recognize-instruction'))!
    expect(task.prerequisites).toContain(restored.objectives.find(objective => objective.kind === 'boss')!.id)
    expect(restored.points.some(point => point.id === task.target)).toBe(true)
    expect(restored.objectives.find(objective => objective.id.endsWith('-adjust-clock'))!.prerequisites).toContain(task.id)
  })
  it('recognizes the abductor as the Boss when a short story does not say Boss or defeat', () => {
    const story = '钟表匠林澈来到倒走的城。守钟机械带走阿遥。林澈修好三枚钟芯，让守钟机械认出真正的维修指令。机械放走阿遥，林澈把中央钟调回正向。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '倒走的城', 3)
    expect(spec.boss.name).toBe('守钟机械')
    expect(spec.creativeBrief?.heroGoal).toContain('救回阿遥')
    expect(spec.narrative!.motivation).toContain('救回阿遥')
    expect(spec.narrative!.bossRelation).toContain('守钟机械带走了阿遥')
    expect(spec.narrative!.opening).toContain('救回阿遥')
    expect(spec.narrative!.chapters[2].objectives.some(task => task.description.includes('让守钟机械认出真正的维修指令'))).toBe(true)
  })
  it('does not mistake a parent taking a child to safety for an antagonist', () => {
    const anchors = extractStoryAnchors('小企鹅在冰原迷路。企鹅妈妈带走小企鹅避开暴风雪，后来他们一起找到了家。')
    expect(anchors.antagonist).toBeUndefined()
    expect(extractStoryAnchors('小企鹅被企鹅妈妈带到温暖的洞穴避开暴风雪，后来他们一起回家。').antagonist).toBeUndefined()
  })
  it('retains a player-authored ending action when a model omits its task and point', () => {
    const story = '钟表匠林澈来到倒走的城市。守钟机械带走妹妹阿遥。林澈修好钟芯并击败机械。机械放走阿遥，兄妹把中央钟调回正向。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '倒走的城', 3)
    const base = spec.narrative!
    const final = base.chapters.at(-1)!
    const rewritten = normalizeNarrative({ ...base, chapters: base.chapters.map(chapter => chapter.levelId === final.levelId
      ? { ...chapter, points: chapter.points.filter(point => !point.id.endsWith('-clock')), objectives: chapter.objectives.filter(task => !task.id.endsWith('-adjust-clock')) }
      : chapter) }, spec, base)
    const revisedFinal = rewritten.chapters.at(-1)!
    const action = revisedFinal.objectives.find(task => task.id.endsWith('-adjust-clock'))!
    expect(action).toBeDefined()
    expect(revisedFinal.points.some(point => point.id === action.target)).toBe(true)
    expect(revisedFinal.objectives.find(task => task.target === 'exit')!.prerequisites).toContain(action.id)
  })
  it('blocks invented item gates, Boss phases and an early rescue in model chapters', () => {
    const story = '钟表匠林澈带着妹妹阿遥来到一座每天倒走一分钟的城。她被守钟机械带走。林澈找到了三枚钟芯，最后机械放走阿遥。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '倒走的城', 3)
    const middle = spec.narrative!.chapters[1]
    middle.objectives.find(task => task.kind === 'interact')!.description = '将阿遥的怀表嵌入C7-α凹槽，激活隐藏通道。'
    const final = spec.narrative!.chapters[2]
    final.objectives.find(task => task.kind === 'boss')!.description = '瞄准守钟机械透镜，依三阶段节奏破防。'
    final.objectives.find(task => task.kind === 'boss')!.feedback = '第三枚钟芯嵌入基座，守钟机械重新识别维修者。'
    final.bossAfter = '守钟机械单膝跪地，阿遥自基座后走出。'
    const problems = narrativeProblems(spec)
    expect(problems.some(problem => problem.path.endsWith('level-2-interact') && problem.message.includes('物品使用机制'))).toBe(true)
    expect(problems.some(problem => problem.path.endsWith('level-3-boss') && problem.message.includes('阶段破防'))).toBe(true)
    expect(problems.some(problem => problem.path.endsWith('bossAfter') && problem.message.includes('提前完成'))).toBe(true)
  })
  it('rejects an Agent repair that adds health-triggered Boss attacks or silently inserts a quest item', () => {
    const spec = createFallbackGameSpec('世界观与故事：钟表匠林澈收集钟芯，击败守钟机械后救回阿遥。', '倒走的城', 3)
    const bossTask = spec.narrative!.chapters[2].objectives.find(task => task.kind === 'boss')!
    bossTask.description = '击败守钟机械；当生命≤140时追加震地冲击，≤70时释放减速脉冲。'
    bossTask.feedback = '第三枚钟芯嵌入基座，机械发出指令校准完成的语音。'
    expect(narrativeProblems(spec).some(problem => problem.path.endsWith(bossTask.id) && problem.message.includes('阶段攻击'))).toBe(true)
  })
  it('rejects an exact-hit Boss promise that does not follow actual health and damage', () => {
    const spec = createFallbackGameSpec('世界观与故事：林澈击败守钟机械，救回阿遥。', '倒走的城', 3)
    const bossTask = spec.narrative!.chapters[2].objectives.find(task => task.kind === 'boss')!
    bossTask.description = '击败守钟机械，击中三次即可使其停机。'
    expect(narrativeProblems(spec).some(problem => problem.path.endsWith(bossTask.id) && problem.message.includes('固定击中次数'))).toBe(true)
  })
  it('checks enemy identities promised in completion feedback as well as task instructions', () => {
    const spec = createFallbackGameSpec('世界观与故事：林澈击败守钟机械，救回阿遥。', '倒走的城', 3)
    spec.enemies.push({ ...spec.enemies[0], name: '齿轮哨兵' })
    const task = spec.narrative!.chapters[1].objectives.find(item => item.kind === 'defeat')!
    task.description = '击败本关敌人。'
    task.feedback = '最后一名齿轮哨兵瘫痪。'
    expect(narrativeProblems(spec).some(problem => problem.path.endsWith(task.id) && problem.message.includes('齿轮哨兵'))).toBe(true)
  })
  it('keeps clue payoffs and investigation feedback within actual quest timing', () => {
    const spec = createFallbackGameSpec('世界观与故事：林澈收集钟芯并击败守钟机械，救回阿遥。', '倒走的城', 3)
    spec.narrative!.clues[0].payoff = '林澈将阿遥怀表按入C7-α凹槽，激活隐藏通道。'
    const final = spec.narrative!.chapters[2]
    const interact = final.objectives.find(task => task.kind === 'interact')!
    interact.feedback = '防御协议终止，守钟机械停止攻击。'
    const issues = narrativeProblems(spec)
    expect(issues.some(issue => issue.path.endsWith('.payoff') && issue.message.includes('物品使用机制'))).toBe(true)
    expect(issues.some(issue => issue.path.endsWith(interact.id) && issue.message.includes('提前宣告'))).toBe(true)
    interact.feedback = '投影放大涂改笔迹，防御协议尚未终止。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(interact.id) && issue.message.includes('提前宣告'))).toBe(false)
  })
  it('catches a model Boss phase and enemy count that the engine will not implement', () => {
    const spec = createFallbackGameSpec('世界观与故事：林澈击败守钟机械，救回阿遥。', '倒走的城', 3)
    spec.boss.attackPattern = 'Phase 2 (≤140 HP): stomp, 40px stun; Phase 3 (≤70 HP): chronal pulse slows hero.'
    const task = spec.narrative!.chapters[0].objectives.find(item => item.kind === 'defeat')!
    task.count = 3
    task.description = '击退四只锈蚀游丝犬。'
    const issues = narrativeProblems(spec)
    expect(issues.some(issue => issue.path === 'boss.attackPattern' && issue.message.includes('阶段技能'))).toBe(true)
    expect(issues.some(issue => issue.path.endsWith(task.id) && issue.message.includes('敌人数量'))).toBe(true)
    spec.boss.attackPattern = '守钟机械受击时后退，随后继续发射齿轮子弹。'
    expect(narrativeProblems(spec).some(issue => issue.path === 'boss.attackPattern' && issue.message.includes('受击位移'))).toBe(true)
  })
  it('checks chapter departures for unsupported item gates as well as task text', () => {
    const spec = createFallbackGameSpec('世界观与故事：林澈收集钟芯并击败守钟机械。', '倒走的城', 3)
    spec.narrative!.chapters[1].departure = '他将阿遥怀表按入C7-α凹槽，齿轮阵列开启直通钟室的暗道。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith('.1.departure') && issue.message.includes('物品使用机制'))).toBe(true)
    spec.narrative!.chapters[1].departure = '林澈认出铭牌编号，通道自动开启。'
    spec.narrative!.clues[0].payoff = '通道开启无需插入动作。'
    spec.narrative!.chapters[2].bossAfter = '基座浮现出校准接口。'
    const invented = narrativeProblems(spec)
    expect(invented.some(issue => issue.path.endsWith('.1.departure') && issue.message.includes('已有出口'))).toBe(true)
    expect(invented.some(issue => issue.path.endsWith('.payoff') && issue.message.includes('原有出口'))).toBe(true)
    expect(invented.some(issue => issue.path.endsWith('.2.bossAfter') && issue.message.includes('已有出口'))).toBe(true)
    spec.narrative!.clues[0].payoff = '出口轮廓随之在幕墙光影中稳定浮现。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith('.payoff') && issue.message.includes('原有出口'))).toBe(true)
  })
  it('flags a promised projection when only text feedback exists', () => {
    const spec = createFallbackGameSpec('世界观与故事：林澈核对维修单，击败守钟机械后救出阿遥。', '倒走的城', 3)
    spec.narrative!.clues[0].payoff = '中央钟室穹顶投射完整回溯影像，证明阿遥没有破坏时钟。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith('.payoff') && issue.message.includes('投影'))).toBe(true)
    spec.narrative!.clues[0].payoff = '林澈对照维修单与机械记录，确认阿遥没有破坏时钟。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith('.payoff') && issue.message.includes('投影'))).toBe(false)
    const task = spec.narrative!.chapters[0].objectives.find(objective => objective.kind === 'interact')!
    task.feedback = '投影放大维修单的笔迹，显示被涂改的名字。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(task.id) && issue.message.includes('投影'))).toBe(true)
    task.feedback = '影像定格于阿遥触碰玻璃罩之前。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(task.id) && issue.message.includes('投影'))).toBe(true)
  })
  it('rejects a newly appearing Boss interface and repeated final action', () => {
    const story = '林澈击败守钟机械后救回阿遥，兄妹把中央钟调回正向。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '倒走的城', 3)
    const final = spec.narrative!.chapters.at(-1)!
    const boss = final.objectives.find(task => task.kind === 'boss')!
    const exit = final.objectives.find(task => task.target === 'exit')!
    boss.feedback = '守钟机械停机，基座浮现校准接口。'
    exit.feedback = '林澈与阿遥一同把中央钟调回正向。'
    const issues = narrativeProblems(spec)
    expect(issues.some(issue => issue.path.endsWith(boss.id) && issue.message.includes('机关接口'))).toBe(true)
    expect(issues.some(issue => issue.path.endsWith(exit.id) && issue.message.includes('重复'))).toBe(true)
    boss.feedback = '守钟机械停机，低沉语音响起：指令校准完成。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(boss.id) && issue.message.includes('提前宣布'))).toBe(true)
  })
  it('aligns invented passages with existing exits while preserving player locks and explicit passages', () => {
    const spec = createFallbackGameSpec('世界观与故事：林澈寻找阿遥，最终击败守钟机械。', '倒走的城', 3)
    spec.narrative!.chapters[1].departure = '怀表指向C7-α，通道自动开启。'
    spec.narrative!.chapters[2].bossAfter = '基座浮现出校准接口。'
    spec.narrative!.clues[0].payoff = '通道开启无需插入动作。'
    const repaired = alignGeneratedPassages(spec)
    expect(repaired.repairedPaths).toHaveLength(3)
    expect(repaired.spec.narrative!.chapters[1].departure).toContain(spec.levels[2].name)
    expect(repaired.spec.narrative!.chapters[1].departure).toContain('怀表指向C7-α')
    expect(repaired.spec.narrative!.chapters[2].bossAfter).toContain('前往出口')
    expect(repaired.spec.narrative!.clues[0].payoff).not.toContain('无需插入动作')
    expect(repaired.spec.narrative!.source.originalStory).toBe(spec.narrative!.source.originalStory)
    spec.narrative!.source.lockedFields[`chapters.${spec.levels[1].id}.departure`] = spec.narrative!.chapters[1].departure
    expect(alignGeneratedPassages(spec).spec.narrative!.chapters[1].departure).toBe(spec.narrative!.chapters[1].departure)
    spec.narrative!.source.originalStory = '林澈找到暗道并走进中央钟室。'
    expect(alignGeneratedPassages(spec).repairedPaths).toEqual([])
  })
  it('keeps a complete clockmaker story and treats a trapped sister as a rescue goal', () => {
    const story = '雾城的钟表匠小今发现全城时钟突然停摆，妹妹被困在中央钟室。他带着维修单穿过停摆的街巷和报时钟楼，发现失序的报时核心误把维修者当成入侵者。小今修好核心，钟声再次响起，他终于在广场与妹妹重逢。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '雾城钟声', 3)
    const narrative = spec.narrative!
    expect(narrative.opening).toContain('妹妹被困在中央钟室')
    expect(narrative.opening).toContain('报时钟楼')
    expect(narrative.opening).not.toContain('广场与妹妹重逢')
    expect(narrative.motivation).toContain('救出妹妹')
    expect(narrative.bossRelation).toContain('误把维修者当成入侵者')
    expect(narrative.chapters.at(-1)!.arrival).not.toContain('阻止了维修者接近中央钟室')
    expect(narrative.ending).toContain('广场与妹妹重逢')
    expect(narrative.chapters[0].arrival).not.toContain('第一次')
    expect(JSON.stringify(narrative.chapters)).not.toContain('妹妹可能经过这里')
    expect(narrative.chapters.at(-1)!.objectives.find(task => task.kind === 'boss')?.feedback).toContain('妹妹被困地点')
    expect(narrative.chapters.at(-1)!.departure).toContain('妹妹被困的地方')
    expect(narrative.chapters.at(-1)!.departure).not.toContain('广场与妹妹重逢')
    expect(narrative.chapters[1].departure).toContain('报时钟楼')
    expect(narrative.opening).not.toContain('也许能揭开真相')
  })
  it('does not route the clockmaker back through a place already visited', () => {
    const story = '年轻钟表匠小今在雾城发现妹妹被困，城里的钟全停了。他在旧钟表铺拿到一张维修单，穿过停摆的街巷，发现中央报时核心误把维修者当成入侵者。小今修好了报时钟楼，击败失控核心，在广场救出妹妹。'
    const narrative = createFallbackGameSpec(`世界观与故事：${story}`, '雾城钟表匠', 3).narrative!
    expect(narrative.chapters[0].title).toBe('旧钟表铺')
    expect(narrative.chapters[1].departure).not.toContain('途经旧钟表铺')
    expect(narrative.bossRelation).toContain('误把维修者当成入侵者')
    expect(narrative.chapters[2].bossBefore).toContain('误把维修者当成入侵者')
  })
  it('restores the current three-chapter family quest and reaches its ending in both runtimes', () => {
    const story = '小企鹅在日本世界发现妈妈失踪了。他追踪熊猫Boss，最后救出了妈妈。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '小企鹅找妈妈', 3)
    expect(spec.world).toContain('妈妈失踪')
    expect(spec.narrative!.opening).toContain('纸条')
    expect(spec.narrative!.chapters[0].arrival).not.toContain('第一次在这里出现')
    expect(spec.narrative!.chapters[0].objectives.find(task => task.kind === 'interact')?.feedback).toContain('稻田小径')
    expect(spec.narrative!.chapters[1].objectives.find(task => task.kind === 'interact')?.feedback).toContain('竹林深处')
    expect(spec.narrative!.chapters[2].departure).not.toBe(spec.narrative!.ending)
    expect(spec.narrative!.chapters[2].objectives.find(task => task.kind === 'boss')?.feedback).not.toContain('救出了妈妈')
    const offline = new Function(`${offlineNarrativeRuntimeSource()}return storyEngine`)() as typeof engine
    for (const runtime of [engine, offline]) {
      let state = runtime.fresh(spec)
      for (const [index, level] of spec.levels.entries()) {
        state = runtime.begin(spec, state, level.id)
        const chapter = spec.narrative!.chapters[index]
        expect(runtime.canExit(spec, state)).toBe(false)
        for (const task of chapter.objectives) {
          for (let count = 0; count < task.count; count++) {
            state = runtime.emit(spec, state, { id: `${task.id}:${count}`, kind: task.kind, target: task.target, levelId: level.id })
          }
        }
        expect(runtime.objectives(spec, state).every(task => task.complete)).toBe(true)
        expect(runtime.canExit(spec, state)).toBe(true)
        state = runtime.finish(spec, state)
        state = runtime.restore(spec, JSON.parse(JSON.stringify(state)))
        expect(state.completedLevels).toContain(level.id)
        expect(state.endingSeen).toBe(index === spec.levels.length - 1)
      }
      expect(state.history.find(entry => entry.id === 'ending')?.text).toContain('妈妈')
      expect(state.history.filter(entry => entry.id === 'ending')).toHaveLength(1)
    }
  })
  it('keeps the protagonist, place, Boss and family ending from one short sentence', () => {
    const story = '小企鹅在日本世界打败所有怪物和熊猫boss，最后找到了自己的妈妈'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '小企鹅找妈妈', 3)
    expect(spec.narrative!.source.originalStory).toBe(story)
    expect(spec.hero.name).toBe('小企鹅')
    expect(spec.boss.name).toBe('熊猫')
    expect(spec.narrative!.motivation).toContain('找到妈妈')
    expect(spec.narrative!.ending).toContain('妈妈')
    expect(spec.narrative!.chapters.at(-1)!.bossBefore).toContain('熊猫')
    expect(spec.world).toContain('海边村庄')
    expect(spec.world).toContain('稻田小径')
    expect(spec.world).toContain('竹林深处')
    expect(spec.world).toContain('妈妈')
    expect(spec.world).not.toContain('穿越不同区域')
    expect(JSON.stringify(spec.narrative)).not.toMatch(/骑士岚|曙光城堡|灰烬守门龙/)
  })
  it('uses a player-specified clue in the family story without inventing a paper note', () => {
    const spec = createFallbackGameSpec('世界观与故事：小企鹅在日本世界寻找妈妈，击败熊猫Boss后救出了妈妈。\n关键线索：一枚刻着竹叶的铜铃', '铜铃寻亲记', 3)
    expect(spec.narrative!.clues[0].setup).toContain('铜铃')
    expect(spec.narrative!.clues[0].payoff).toContain('线索上的记号')
    expect(spec.narrative!.clues[0].payoff).not.toContain('纸条')
  })
  it('recognizes an animal protagonist and explicit Boss despite different word order', () => {
    const stories = [
      '一只小企鹅在日本打败妖怪和熊猫Boss，最后与妈妈团聚。',
      '在日本，小企鹅为了找到妈妈，打败了熊猫Boss。',
    ]
    for (const story of stories) {
      const spec = createFallbackGameSpec(`世界观与故事：${story}`, '企鹅寻亲记', 3)
      expect(spec.hero.name).toBe('小企鹅')
      expect(spec.boss.name).toBe('熊猫')
      expect(spec.narrative!.source.originalStory).toBe(story)
      expect(JSON.stringify(spec.narrative)).not.toMatch(/骑士岚|曙光城堡|灰烬守门龙/)
    }
  })
  it('keeps an unfamiliar protagonist and setting from a complete player story', () => {
    const story = '一只来自深海的章鱼，在火星水族馆修复传送门。他收集三枚失落的齿轮，避开巡逻机器人，最后打败机械海马Boss，回到地球。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '火星归途', 3)
    expect(spec.narrative!.source.originalStory).toBe(story)
    expect(spec.hero.name).toContain('章鱼')
    expect(spec.boss.name).toContain('机械海马')
    expect(spec.enemies[0].name).toBe('巡逻机器人')
    expect(spec.enemies[0].appearance).toContain('patrol robot')
    expect(spec.collectible.name).toBe('失落的齿轮')
    expect(spec.world).toContain('火星水族馆')
    expect(spec.world).not.toMatch(/回声海湾|归港航线|潮汐/)
    expect(spec.narrative!.opening).not.toMatch(/海湾潮汐|归港航线|船队/)
    expect(spec.narrative!.chapters.map(chapter => chapter.title).join(' ')).toContain('火星水族馆')
    expect(spec.narrative!.chapters.map(chapter => chapter.title).join(' ')).not.toMatch(/退潮船坞|珊瑚隧道|潮汐控制室/)
    expect(spec.narrative!.chapters.at(-1)!.departure).not.toContain('回到地球')
    expect(spec.narrative!.ending).toContain('地球')
    expect(spec.world).not.toContain('主角必须')
    expect(JSON.stringify(spec.narrative)).not.toMatch(/骑士岚|曙光城堡|灰烬守门龙/)
  })
  it('uses the stated hero, setting, ordinary enemy and collected item in a sea story', () => {
    const story = '小海马在海底邮局送出最后一封信。它收集发光贝壳，避开海胆怪，最后打败章鱼Boss，将信交给灯塔守望人。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '海底邮局', 3)
    expect(spec.hero.name).toBe('小海马')
    expect(spec.world).toContain('海底邮局')
    expect(spec.enemies[0].name).toBe('海胆怪')
    expect(spec.collectible.name).toBe('发光贝壳')
    expect(spec.narrative!.motivation).toContain('送出最后一封信')
    expect(spec.narrative!.opening).toContain('准备送出最后一封信')
    expect(spec.narrative!.ending).toContain('小海马')
    expect(spec.narrative!.opening).not.toContain('交给灯塔守望人')
  })
  it('treats an explicitly collected item as the pickup, not the final prize', () => {
    const story = '小画家在未来都市寻找被偷走的画笔。她收集三块彩色芯片，战胜机器人Boss，夺回画笔，让整座城市重新出现颜色。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '夜城寻画', 3)
    expect(spec.collectible.name).toBe('彩色芯片')
    expect(spec.narrative!.ending).toContain('夺回画笔')
    expect(spec.narrative!.opening).not.toContain('重新出现颜色')
  })
  it('uses named waypoints and the reunion location from a short ice story', () => {
    const story = '白狐在冰原寻找失踪的弟弟。它沿着脚印穿过雪松林，打败雪狼Boss，在洞穴里找到了弟弟。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '冰原归乡', 3)
    expect(spec.levels.map(level => level.name)).toEqual(['冰原入口', '雪松林', '洞穴'])
    expect(spec.narrative!.opening).not.toContain('找到了弟弟')
    expect(spec.narrative!.ending).toContain('白狐打败雪狼')
  })
  it('grounds the ordinary enemy image in the stated setting while respecting an explicit image prompt', () => {
    const story = '主角是小企鹅，在日本世界打败怪物和熊猫Boss，最后找到妈妈。'
    const draft = createFallbackGameSpec(`世界观与故事：${story}`, '企鹅寻亲记', 2)
    expect(draft.hero.name).toBe('小企鹅')
    expect(draft.boss.name).toBe('熊猫')
    expect(draft.enemies[0].appearance).toContain('日本世界')
    expect(draft.assets.find(asset => asset.category === 'groundEnemy')?.prompt).toContain('日本世界')
    const custom = createFallbackGameSpec(`世界观与故事：${story}\n地面敌人 / Ground Enemy：红色灯笼妖怪`, '企鹅寻亲记', 2)
    expect(custom.enemies[0].appearance).toBe('红色灯笼妖怪')
  })
  it('lets a stated world outrank a character profession when selecting the local story setting', () => {
    const story = '年轻地图师阿澜在日本世界寻找失踪的妹妹。他沿街收集留下的信件，最后击败熊猫Boss，终于和妹妹团聚。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '寻人旅程', 3)
    expect(spec.narrative!.source.originalStory).toBe(story)
    expect(spec.narrative!.ending).toContain('妹妹团聚')
    expect(spec.narrative!.opening).not.toContain('妹妹团聚')
    expect(JSON.stringify(spec.narrative!.chapters)).not.toMatch(/潮汐群岛|星桥|守桥巨像|曙光城堡/)
    expect(spec.narrative!.chapters[0].title).toContain('日本世界')
    expect(spec.narrative!.chapters.at(-1)!.bossBefore).toContain('熊猫')
  })
  it('keeps a short story’s named Boss and world during model revisions', () => {
    const story = '小企鹅在日本世界打败怪物和熊猫Boss，最后找到妈妈。'
    const original = createFallbackGameSpec(`世界观与故事：${story}`, '企鹅寻亲记', 3)
    const revised = normalizeModelGameSpec({
      world: '曙光城堡的骑士王国',
      boss: { name: '灰烬守门龙' },
      narrative: { characters: [{ id: 'boss', name: '灰烬守门龙' }] },
    }, original, 3, '')
    expect(revised.world).toBe(original.world)
    expect(revised.boss.name).toBe('熊猫')
    expect(revised.narrative!.characters.find(character => character.id === 'boss')?.name).toBe('熊猫')
    expect(pendingNarrativeSuggestions(revised).some(item => item.path === 'characters.boss.name')).toBe(true)
  })
  it('retains a plain-text idea as the story source, even with an unrelated numeric title', () => {
    const idea = '邮差，风，失踪的信。'
    const spec = createFallbackGameSpec(idea, '132', 3)
    expect(spec.narrative!.source.originalStory).toBe(idea)
    expect(spec.hero.name).toContain('邮差')
    expect(spec.narrative!.premise).toContain('风铃邮路')
    expect(spec.narrative!.premise).not.toBe(idea)
    expect(spec.narrative!.resolution).not.toContain('目标终于实现')
    expect(spec.narrative!.opening).not.toContain('邮差，风，失踪的信')
    expect(spec.narrative!.opening).toContain('邮差小禾')
    expect(spec.narrative!.incitingIncident).not.toContain('晨钟')
    expect(spec.narrative!.ending).toContain('信件')
    const blank = createFallbackGameSpec('游戏标题：132\n世界观与故事：\n背景故事：\n主角 / Hero：', '132', 3)
    expect(blank.narrative!.source.originalStory).toBe('')
    expect(blank.narrative!.opening).not.toContain('主角 / Hero')
  })
  it('turns a numeric-only story into a commission that is resolved in the ending', () => {
    const spec = createFallbackGameSpec('世界观与故事：132', '132', 3)
    expect(spec.narrative!.source.originalStory).toBe('132')
    expect(spec.narrative!.opening).toContain('编号“132”')
    expect(spec.narrative!.clues[0].setup).toContain('编号“132”')
    expect(spec.narrative!.clues[0].payoff).toContain('编号“132”')
    expect(spec.narrative!.ending).toContain('编号“132”')
    expect(spec.narrative!.chapters).toHaveLength(3)
  })
  it('keeps explicit zero counts and creates a playable investigation without phantom pickups', () => {
    const spec = createFallbackGameSpec('世界观与故事：地图师调查熄灭的灯塔。\n关卡 1：旧港候船所\n敌人数：0\n收集品数：0\n关卡 2：灯塔顶层\n敌人数：0\n收集品数：0', '雾海归航', 2)
    expect(spec.levels.map(level => [level.enemyCount, level.collectibleCount])).toEqual([[0, 0], [0, 0]])
    expect(narrativeProblems(spec)).toEqual([])
    let state = engine.fresh(spec)
    for (const chapter of spec.narrative!.chapters) {
      state = engine.begin(spec, state, chapter.levelId)
      expect(chapter.objectives.some(o => o.kind === 'collect' || o.kind === 'defeat')).toBe(false)
      expect(chapter.arrival).not.toContain('先寻找')
      const interact = chapter.objectives.find(o => o.kind === 'interact')!
      expect(interact.prerequisites).toEqual([])
      expect(engine.exitReady(spec, state, 0)).toBe(false)
      for (const task of chapter.objectives) state = engine.emit(spec, state, { id: task.id, kind: task.kind, target: task.target, levelId: chapter.levelId })
      expect(engine.exitReady(spec, state, 0)).toBe(true)
      state = engine.finish(spec, state)
    }
    expect(state.endingSeen).toBe(true)
  })

  it('uses coastal clues for a lighthouse story without inventing a star-bridge setting', () => {
    const spec = createFallbackGameSpec('世界观与故事：年轻地图师收集星火，修复灯塔，接回失联的船队。', '雾海归航', 3)
    const story = JSON.stringify(spec.narrative)
    expect(story).not.toMatch(/星桥|核心插槽/)
    expect(spec.narrative!.incitingIncident).toContain('灯塔')
    expect(spec.narrative!.clues[0].setup).toContain('航线日志')
    expect(spec.narrative!.clues[0].payoff).toContain('灯塔指引')
    const explicit = createFallbackGameSpec('世界观与故事：群岛由星桥相连，地图师点亮灯塔恢复星桥航线。', '星桥', 3)
    expect(explicit.narrative!.incitingIncident).toContain('星桥')
  })
  const draft = () => ensureNarrative(createFallbackGameSpec('世界观与故事：0135156【已选灵感】群岛会随着潮汐缓缓升降。主角是一名修理飞艇的年轻地图师。', '132', 2))
  it('turns limited input and inspiration into a complete authored plan', () => {
    const spec = draft()
    expect(spec.narrative!.opening).not.toContain('【已选灵感】')
    expect(spec.narrative!.ending.length).toBeGreaterThan(20)
    expect(spec.hero.name).not.toBe('Hero')
    expect(spec.narrative!.source.originalStory).toContain('0135156')
    expect(new Set(spec.narrative!.chapters.map(c => c.title)).size).toBe(2)
    expect(narrativeProblems(spec)).toEqual([])
  })
  it('keeps unsupported task kinds visible to validation rather than inventing runtime behavior', () => {
    const spec = draft(), n = spec.narrative!
    const next = normalizeNarrative({ ...n, chapters: [{ ...n.chapters[0], objectives: [{ id:'bad', kind:'time-travel', target:'anything', count:1 }] }, n.chapters[1]] }, spec, n)
    expect(narrativeProblems({ ...spec, narrative: next }).some(i => i.message.includes('尚未实现'))).toBe(true)
  })
  it('warns when a clue promises an item-triggered Boss state the engine cannot play', () => {
    const spec = draft()
    spec.narrative!.clues[0].payoff = '小禾将邮票按入哨兵膝关节，短路使它停火。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(`${spec.narrative!.clues[0].id}.payoff`) && issue.severity !== 'warning')).toBe(true)
  })
  it('blocks a Boss task that promises item insertion instead of the supported defeat condition', () => {
    const spec = draft()
    const chapter = spec.narrative!.chapters.at(-1)!
    const task = chapter.objectives.find(objective => objective.kind === 'boss')!
    task.description = '将邮票插入哨兵关节，使其跪地暴露弱点。'
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(task.id) && issue.severity !== 'warning')).toBe(true)
  })
  it('blocks a task that promises an air enemy when the level only spawns ground enemies', () => {
    const spec = draft()
    const chapter = spec.narrative!.chapters[0]
    const task = chapter.objectives.find(objective => objective.kind === 'defeat')!
    task.description = '击退三名守卫，包括空中云哨兵。'
    const airAsset = spec.assets.find(asset => asset.category === 'airEnemy')!
    airAsset.enabled = false
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(task.id) && issue.message.includes('空中敌人'))).toBe(true)
    airAsset.enabled = true
    airAsset.levelIds = [chapter.levelId]
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(task.id) && issue.message.includes('空中敌人'))).toBe(false)
  })
  it('does not accept a named second enemy while its sprite is disabled', () => {
    const spec = draft()
    const chapter = spec.narrative!.chapters[0]
    const task = chapter.objectives.find(objective => objective.kind === 'defeat')!
    spec.enemies.push({ ...spec.enemies[0], name: '云哨兵', category: 'airEnemy' })
    task.description = '击退巡逻敌人，包括云哨兵。'
    const airAsset = spec.assets.find(asset => asset.category === 'airEnemy')!
    airAsset.enabled = false
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(task.id) && issue.message.includes('云哨兵'))).toBe(true)
    airAsset.enabled = true
    airAsset.levelIds = [chapter.levelId]
    expect(narrativeProblems(spec).some(issue => issue.path.endsWith(task.id) && issue.message.includes('云哨兵'))).toBe(false)
  })
  it('does not mistake input fragments and a generic outcome for a finished story', () => {
    const spec = createFallbackGameSpec('邮差，风，失踪的信。', '云中邮差', 3)
    spec.narrative!.premise = '邮差，风，失踪的信。'
    spec.narrative!.resolution = '这次冒险的目标终于实现，沿途收集的线索揭开了危机的原因。'
    const problems = narrativeProblems(spec)
    expect(problems.some(issue => issue.path === 'narrative.premise')).toBe(true)
    expect(problems.some(issue => issue.path === 'narrative.resolution')).toBe(true)
  })
  it('does not block a short story that already names a hero, place, conflict and outcome', () => {
    const story = '小企鹅在日本世界打败熊猫Boss，最后找到了妈妈。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '小企鹅找妈妈', 3)
    expect(narrativeProblems(spec).some(issue => issue.path === 'narrative.premise')).toBe(false)
    expect(spec.narrative!.incitingIncident).toContain('妈妈最后出现地点')
    expect(spec.narrative!.incitingIncident).toContain('怪物占据')
    expect(spec.narrative!.premise).not.toBe(story)
    expect(spec.narrative!.opening).toContain('标着妈妈最后出现地点的纸条')
    expect(spec.narrative!.chapters[0].arrival).toContain('先前发现的线索')
    expect(spec.narrative!.chapters[0].arrival).not.toContain('第一次在这里出现')
    expect(spec.narrative!.bossRelation).toContain('小企鹅')
    expect(spec.narrative!.bossRelation).not.toContain('主角')
  })
  it('keeps a stated incident instead of replacing it with a generated family clue', () => {
    const story = '小企鹅在日本世界发现妈妈失踪了。他追踪熊猫Boss，最后救出了妈妈。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '小企鹅找妈妈', 3)
    expect(spec.narrative!.incitingIncident).toContain('妈妈失踪')
    expect(spec.narrative!.opening).toContain('妈妈失踪')
    expect(spec.narrative!.opening).not.toContain('发现一张标着妈妈最后出现地点的纸条')
    expect(spec.hero.name).toBe('小企鹅')
    expect(spec.boss.name).toBe('熊猫')
    expect(spec.world).toContain('日本世界')
    expect(spec.levels[0].name).toContain('日本世界')
    expect(spec.narrative!.ending).toContain('小企鹅')
    expect(spec.narrative!.ending).toContain('救出了妈妈')
  })
  it('preserves concrete English character identity when adding narrative to an existing game', () => {
    const spec = draft()
    delete spec.narrative
    spec.hero.appearance = 'One young mapmaker with short silver hair, blue cape, brown boots and an amber compass on belt.'
    const hero = spec.assets.find(asset => asset.category === 'hero')!
    hero.url = '/existing-mapmaker.png'
    hero.prompt = spec.hero.appearance
    const next = ensureNarrative(spec, '', '年轻地图师寻找失踪的船队。')
    expect(next.hero.appearance).toBe(spec.hero.appearance)
    expect(next.assets.find(asset => asset.id === hero.id)).toEqual(hero)
    expect(next.narrative!.source.originalStory).toBe('年轻地图师寻找失踪的船队。')
  })
  it('applies a named chapter patch only to that chapter, including reordered patches', () => {
    const spec = draft(), n = spec.narrative!
    const arrival = '地图师在第二处灯塔发现了船队留下的维修记录。'
    const next = normalizeNarrative({ chapters: [{ levelId: spec.levels[1].id, arrival }] }, spec, n)
    expect(next.chapters[0]).toEqual(n.chapters[0])
    expect(next.chapters[1]).toEqual({ ...n.chapters[1], arrival })
    const unknown = normalizeNarrative({ chapters: [{ levelId: 'unknown-level', arrival }] }, spec, n)
    expect(unknown.chapters).toEqual(n.chapters)
  })
  it('keeps unmodified background prompts and intentionally unassigned assets during normalization', () => {
    const spec = draft()
    const disabled = spec.assets.find(asset => asset.category === 'waterEnemy')!
    disabled.enabled = false; disabled.levelIds = []
    const backgrounds = spec.assets.filter(asset => asset.category === 'levelBackground')
    backgrounds.forEach(asset => { asset.prompt = '已确认的具体背景构图，保留这段提示词。' })
    const next = normalizeGameSpec({ narrative: { chapters: [{ levelId: spec.levels[1].id, arrival: '只更新第二关的进入剧情。' }] } }, spec)
    expect(next.assets.find(asset => asset.id === disabled.id)?.levelIds).toEqual([])
    expect(next.assets.filter(asset => asset.category === 'levelBackground').map(asset => asset.prompt)).toEqual(backgrounds.map(asset => asset.prompt))
  })
  it('updates individual task feedback without deleting sibling objectives or interaction points', () => {
    const spec = draft(), chapter = spec.narrative!.chapters[1]
    chapter.points.push({ id: 'extra-record', kind: 'interact', position: .7, name: '旧航路记录', description: '船员留下的记录。' })
    const next = normalizeModelGameSpec({ narrative: { chapters: [{ levelId: chapter.levelId, points: [{ id: chapter.points[0].id, description: '读取灯塔中保存的船队航线。' }], objectives: [{ id: chapter.objectives[1].id, feedback: '维修单记下了船队穿越海雾的方向。' }] }] } }, spec, 2, '')
    expect(next.narrative!.chapters[0]).toEqual(spec.narrative!.chapters[0])
    const updated = next.narrative!.chapters[1]
    expect(updated.points).toHaveLength(2)
    expect(updated.points[1]).toEqual(chapter.points[1])
    expect(updated.objectives).toHaveLength(chapter.objectives.length)
    expect(updated.objectives[1]).toEqual({ ...chapter.objectives[1], feedback: '维修单记下了船队穿越海雾的方向。' })
    expect(updated.objectives.at(-1)).toEqual(chapter.objectives.at(-1))
  })
  it('updates one clue payoff without deleting other clues or their level references', () => {
    const spec = draft()
    const clue = spec.narrative!.clues[0]
    const payoff = '击败守卫后，旧回执说明了信件应送往的驿站。'
    const next = normalizeModelGameSpec({ narrative: { clues: [{ id: clue.id, payoff }] } }, spec, 2, '')
    expect(next.narrative!.clues[0]).toEqual({ ...clue, payoff })
    expect(next.narrative!.clues).toHaveLength(spec.narrative!.clues.length)
    expect(narrativeProblems(next).some(issue => issue.path === 'narrative.clues')).toBe(false)
  })
  it('repairs unambiguous model ID separators without moving an unknown chapter', () => {
    const spec = draft(), chapter = spec.narrative!.chapters[1], task = chapter.objectives[1]
    const alias = (id: string) => id.replace(/-/g, '_')
    const candidate = { narrative: {
      clues: [{ id: 'new-clue', setup: '旧信封留下寄件人的印记。', payoff: '收件人认出了这个印记。', levelId: alias(spec.levels[0].id), payoffLevelId: alias(spec.levels[1].id) }],
      chapters: [{ levelId: alias(chapter.levelId), arrival: '第二站发现了完整的航路记录。', objectives: [{ id: alias(task.id), target: alias(task.target), feedback: '记录揭示了船队最后停靠的港口。' }] }, { levelId: 'unknown_level', arrival: '不能按顺序写入第一关。' }],
    } }
    const next = normalizeModelGameSpec(candidate, spec, 2, '')
    expect(next.narrative!.chapters[0]).toEqual(spec.narrative!.chapters[0])
    expect(next.narrative!.chapters[1].arrival).toBe('第二站发现了完整的航路记录。')
    expect(next.narrative!.chapters[1].objectives[1]).toEqual({ ...task, feedback: '记录揭示了船队最后停靠的港口。' })
    expect(next.narrative!.clues[0]).toMatchObject({ levelId: spec.levels[0].id, payoffLevelId: spec.levels[1].id })
  })
  it('requires actual collection, combat, interaction and exit events in order; deduplicates rewards and scenes', () => {
    const spec = draft(), first = spec.levels[0], chapter = spec.narrative!.chapters[0]
    let state = engine.begin(spec, engine.fresh(spec), first.id)
    state = engine.emit(spec, state, { id:'early', kind:'interact', target:chapter.points[0].id, levelId:first.id })
    expect(state.counts[chapter.objectives[1].id]).toBeUndefined()
    const before = state
    state = engine.emit(spec, state, { id:'early-exit', kind:'reach', target:'exit', levelId:first.id })
    expect(engine.finish(spec, state).completedLevels).toEqual([])
    expect(engine.canExit(spec, state)).toBe(false)
    for (const objective of chapter.objectives) for (let i=0;i<objective.count;i++) state = engine.emit(spec, state, { id:`${objective.id}-${i}`, kind:objective.kind, target:objective.target, levelId:first.id })
    const repeated = engine.emit(spec, state, { id:`${chapter.objectives[0].id}-0`, kind:'collect', target:'collectible', levelId:first.id })
    expect(repeated).toBe(state)
    state = engine.finish(spec, state)
    expect(state.completedLevels).toEqual([first.id])
    expect(state.endingSeen).toBe(false)
    state = engine.begin(spec, state, spec.levels[1].id)
    for (const o of spec.narrative!.chapters[1].objectives) for(let i=0;i<o.count;i++) state=engine.emit(spec,state,{id:`${o.id}-${i}`,kind:o.kind,target:o.target,levelId:state.levelId})
    expect(engine.finish(spec,state).endingSeen).toBe(true)
    const retry=engine.begin(spec,engine.restore(spec,JSON.parse(JSON.stringify(before))),first.id,true)
    expect(engine.canExit(spec,retry)).toBe(false)
    expect(Object.values(retry.counts).every(count => count === 0)).toBe(true)
  })
  it('executes the exact runtime in an isolated offline JavaScript scope', () => {
    const engineOffline = new Function(`${offlineNarrativeRuntimeSource()}return storyEngine`)() as typeof engine
    const spec=draft()
    expect(engineOffline.key(spec)).toBe(engine.key(spec))
    expect(engineOffline.begin(spec,engineOffline.fresh(spec),spec.levels[0].id)).toEqual(engine.begin(spec,engine.fresh(spec),spec.levels[0].id))
  })
  it('opens the exit for the approved task count without requiring unlisted kills, online and offline', () => {
    const spec = draft(), chapter = spec.narrative!.chapters[0]
    const defeat = chapter.objectives.find(task => task.kind === 'defeat')!
    defeat.count = 1
    const offline = new Function(`${offlineNarrativeRuntimeSource()}return storyEngine`)() as typeof engine
    for (const runtime of [engine, offline]) {
      let state = runtime.begin(spec, runtime.fresh(spec), chapter.levelId)
      expect(runtime.exitReady(spec, state, 0)).toBe(false)
      for (const task of chapter.objectives.filter(item => item.target !== 'exit')) for (let i = 0; i < task.count; i++) state = runtime.emit(spec, state, { id: `${task.id}-${i}`, kind: task.kind, target: task.target, levelId: chapter.levelId })
      expect(runtime.exitReady(spec, state, 2)).toBe(true)
      expect(runtime.exitReady({ ...spec, narrative: undefined }, state, 2)).toBe(false)
      expect(runtime.exitReady({ ...spec, narrative: undefined }, state, 0)).toBe(true)
      expect(runtime.exitReady(spec, null, 0)).toBe(false)
    }
  })
  it('invalidates saves when task definitions change and preserves locked narration', () => {
    const spec=draft(), saved=engine.fresh(spec)
    const changed={...spec,narrative:{...spec.narrative!,ending:'Changed ending'}}
    expect(engine.restore(changed,saved).storyKey).not.toBe(saved.storyKey)
    const n=normalizeNarrative({...spec.narrative!,opening:'模型重写',source:{...spec.narrative!.source,lockedFields:{opening:'玩家明确锁定的开场剧情'}}},spec,spec.narrative)
    expect(n.opening).toBe('玩家明确锁定的开场剧情')
  })
  it('rejects old actor progress after gameplay changes in both browser and exported runtimes', () => {
    const offline = new Function(`${offlineNarrativeRuntimeSource()}return storyEngine`)() as typeof engine
    const spec = draft()
    const changes: Array<(next: typeof spec) => void> = [
      next => { next.hero.maxHealth += 20 },
      next => { next.hero.moveSpeed += 1 },
      next => { next.hero.jumpPower += 1 },
      next => { next.weapon.meleeDamage += 10 },
      next => { next.weapon.cooldownMs += 100 },
      next => { next.enemies[0].health += 20 },
      next => { next.enemies[0].behavior = next.enemies[0].behavior === 'ranged' ? 'chase' : 'ranged' },
      next => { next.boss.damage += 10 },
      next => { next.collectible.value += 1 },
      next => { next.levels[0].platformMode = next.levels[0].platformMode === 'air' ? 'ground' : 'air' },
      next => { const obstacle = next.assets.find(a => a.category === 'deathObstacle')!; obstacle.enabled = !obstacle.enabled },
      next => { const enemy = next.assets.find(a => a.category === 'groundEnemy')!; enemy.levelIds = ['different-level'] },
    ]
    for (const runtime of [engine, offline]) {
      const saved = runtime.begin(spec, runtime.fresh(spec), spec.levels[0].id)
      for (const change of changes) {
        const next = structuredClone(spec); change(next)
        expect(runtime.restore(next, saved)).toEqual(runtime.fresh(next))
        expect(runtime.key(next)).not.toBe(saved.storyKey)
      }
    }
  })
  it('keeps progress when replacing art or recording editorial decisions without changing gameplay', () => {
    const offline = new Function(`${offlineNarrativeRuntimeSource()}return storyEngine`)() as typeof engine
    const spec = draft()
    spec.assets.forEach(asset => { asset.url = '/original.png' })
    const next = structuredClone(spec)
    next.assets.forEach(asset => { asset.url = '/replacement.png'; asset.prompt = '调整画面构图'; asset.status = 'pending' })
    next.visualStyle.artDirection = '新的配色'
    next.narrative!.source.lockedFields.opening = next.narrative!.opening
    next.narrative!.suggestions = [{ id: 'proposal', path: 'opening', label: '开场', before: next.narrative!.opening, after: '待考虑的建议', reason: '补充气氛', status: 'pending' }]
    for (const runtime of [engine, offline]) {
      const saved = runtime.begin(spec, runtime.fresh(spec), spec.levels[0].id)
      expect(runtime.key(next)).toBe(runtime.key(spec))
      const restored = runtime.restore(next, saved)
      expect(restored.history).toEqual(saved.history)
      expect(restored.openingSeen).toBe(true)
    }
  })
  it('keeps the campaign when a missing Boss image is supplied later', () => {
    const offline = new Function(`${offlineNarrativeRuntimeSource()}return storyEngine`)() as typeof engine
    const before = draft()
    before.assets = before.assets.map(asset => asset.category === 'boss' ? { ...asset, url: '' } : asset)
    const after = structuredClone(before)
    after.assets = after.assets.map(asset => asset.category === 'boss' ? { ...asset, url: '/new-boss.png' } : asset)
    for (const runtime of [engine, offline]) {
      const saved = runtime.begin(before, runtime.fresh(before), before.levels[0].id)
      expect(runtime.key(after)).toBe(runtime.key(before))
      expect(runtime.restore(after, saved).history).toEqual(saved.history)
    }
  })
  it('does not strand a sequence when a physical pickup occurred before an earlier task', () => {
    const spec=draft(), level=spec.levels[0], chapter=spec.narrative!.chapters[0]
    const pickup=chapter.objectives[0], investigate=chapter.objectives[1]
    chapter.objectives=[{...investigate,prerequisites:[]},{...pickup,prerequisites:[investigate.id]}]
    let state=engine.begin(spec,engine.fresh(spec),level.id)
    for(let i=0;i<pickup.count;i++)state=engine.emit(spec,state,{id:`coin-${i}`,kind:'collect',target:'collectible',levelId:level.id})
    expect(state.counts[pickup.id]||0).toBe(0)
    state=engine.emit(spec,state,{id:'look',kind:'interact',target:investigate.target,levelId:level.id})
    expect(state.counts[pickup.id]).toBe(pickup.count)
  })
  it('keeps a partial refinement confined to its group and respects player text locks', () => {
    const spec=draft()
    spec.narrative!.source.lockedFields.opening='玩家要求保持这段开场原文不变。'
    const candidate=structuredClone(spec);candidate.narrative!.opening='模型新写的故事。';candidate.narrative!.motivation='新的角色动机。';candidate.hero.name='模型换掉的名字'
    const merged=mergeRefinement(spec,candidate,'story')
    expect(merged.narrative!.opening).toBe('玩家要求保持这段开场原文不变。')
    expect(merged.narrative!.motivation).toBe('新的角色动机。')
    expect(merged.hero).toBe(spec.hero)
    expect(merged.levels).toBe(spec.levels)
    expect(merged.assets).toBe(spec.assets)
  })
})
