import type { BehaviorProgram, BehaviorRuntime, BehaviorStage, MapRect } from '@/types'

function createBehaviorProgramRules() {
  function validate(value: unknown): BehaviorProgram {
    const p = value as BehaviorProgram
    if (!p || p.version !== 1 || typeof p.loop !== 'boolean' || !['remove','hazard'].includes(p.onDefeat) || !Array.isArray(p.stages) || !p.stages.length || p.stages.length > 16 || Object.keys(p).some(k => !['version','loop','onDefeat','stages'].includes(k))) throw Error('Invalid behavior program')
    const ids = new Set<string>()
    const number = (v: unknown, min: number, max: number, field: string) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw Error('Invalid behavior ' + field); return v }
    const stages = p.stages.map(s => {
      if (!s || typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || ids.has(s.id) || typeof s.label !== 'string' || s.label.length > 120) throw Error('Invalid stage identity')
      ids.add(s.id)
      const fields = ['id','label','triggerDistance','triggerAbove','warningMs','activeMs','cooldownMs','repeats','motion','dx','dy','speed','leash','attack','attackEveryMs','vulnerable','transition','healthBelow']
      if (Object.keys(s).some(k => !fields.includes(k)) || !['still','offset','chase','stretch'].includes(s.motion) || !['none','contact','melee','ranged'].includes(s.attack) || !['time','health'].includes(s.transition) || typeof s.vulnerable !== 'boolean' || typeof s.triggerAbove !== 'boolean') throw Error('Unsupported behavior stage')
      return { id:s.id, label:s.label, triggerDistance:number(s.triggerDistance,0,32768,'triggerDistance'), triggerAbove:s.triggerAbove, warningMs:number(s.warningMs,0,60000,'warningMs'), activeMs:number(s.activeMs,16,120000,'activeMs'), cooldownMs:number(s.cooldownMs,0,60000,'cooldownMs'), repeats:number(s.repeats,1,8,'repeats'), motion:s.motion, dx:number(s.dx,-32768,32768,'dx'), dy:number(s.dy,-32768,32768,'dy'), speed:number(s.speed,0,30,'speed'), leash:number(s.leash,0,32768,'leash'), attack:s.attack, attackEveryMs:number(s.attackEveryMs,100,60000,'attackEveryMs'), vulnerable:s.vulnerable, transition:s.transition, healthBelow:number(s.healthBelow,0,1,'healthBelow') } as BehaviorStage
    })
    if (stages.some(s => !Number.isInteger(s.repeats))) throw Error('Stage repeats must be integral')
    return { version:1, loop:p.loop, onDefeat:p.onDefeat, stages }
  }
  function fresh(actor: MapRect): BehaviorRuntime { return { index:0, enteredAt:-1, lastAttackAt:-1, repeat:0, baseX:actor.x, baseY:actor.y, width:actor.width, height:actor.height } }
  function restore(p: BehaviorProgram, actor: MapRect, value: unknown): BehaviorRuntime {
    const s = value as BehaviorRuntime
    if (!s || !Number.isInteger(s.index) || s.index < 0 || s.index >= p.stages.length || !Number.isInteger(s.repeat) || s.repeat < 0 || s.repeat > 8 || ![s.enteredAt,s.lastAttackAt,s.baseX,s.baseY,s.width,s.height].every(v => Number.isFinite(v) && v >= -32768 && v <= 1e12) || s.width <= 0 || s.height <= 0) return fresh(actor)
    return { index:s.index, enteredAt:s.enteredAt, lastAttackAt:s.lastAttackAt, repeat:s.repeat, baseX:s.baseX, baseY:s.baseY, width:s.width, height:s.height, resolved:!!s.resolved, finished:!!s.finished }
  }
  function step(p: BehaviorProgram, state: BehaviorRuntime, actor: MapRect & { health: number; maxHealth: number }, target: MapRect, now: number, delta: number) {
    let stage = p.stages[state.index]
    const distance = Math.hypot(target.x - actor.x, target.y - actor.y)
    if (state.enteredAt < 0 && (!stage.triggerDistance || distance <= stage.triggerDistance) && (!stage.triggerAbove || target.y < actor.y - 20)) state.enteredAt = now
    let elapsed = state.enteredAt < 0 ? -1 : now - state.enteredAt
    const duration = stage.warningMs + stage.activeMs + stage.cooldownMs
    if (!state.finished && !state.resolved && elapsed >= 0 && (stage.transition === 'health' ? actor.health / actor.maxHealth <= stage.healthBelow : elapsed >= duration)) {
      if (++state.repeat < stage.repeats) state.enteredAt = -1
      else { state.repeat = 0; if (state.index + 1 < p.stages.length) state.index++; else if (p.loop) state.index = 0; else state.finished = true; state.enteredAt = -1 }
      state.lastAttackAt = -1; stage = p.stages[state.index]; elapsed = -1
    }
    const phase = state.resolved ? 'active' : state.finished ? 'finished' : elapsed < 0 ? 'waiting' : elapsed < stage.warningMs ? 'warning' : elapsed < stage.warningMs + stage.activeMs || stage.transition === 'health' ? 'active' : 'cooldown'
    const active = phase === 'active'
    let x = state.baseX, y = state.baseY, width = state.width, height = state.height
    const progress = Math.max(0, Math.min(1, (elapsed - stage.warningMs) / stage.activeMs)), triangle = 1 - Math.abs(progress * 2 - 1)
    if (active && stage.motion === 'offset') { x += stage.dx * triangle; y += stage.dy * triangle }
    if (active && stage.motion === 'stretch') { height += Math.abs(stage.dy) * progress; y -= height - state.height }
    if (active && stage.motion === 'chase') {
      const dx = target.x - actor.x, dy = target.y - actor.y, length = Math.hypot(dx,dy) || 1, distance = Math.min(length,stage.speed * delta)
      x = actor.x + dx / length * distance; y = actor.y + dy / length * distance
      const leashDistance = Math.hypot(x - state.baseX, y - state.baseY)
      if (stage.leash && leashDistance > stage.leash) { x = state.baseX + (x-state.baseX)/leashDistance*stage.leash; y = state.baseY + (y-state.baseY)/leashDistance*stage.leash }
    }
    let attack: BehaviorStage['attack'] = 'none'
    if (active && stage.attack !== 'none' && (state.lastAttackAt < 0 || now - state.lastAttackAt >= stage.attackEveryMs)) { attack = stage.attack; state.lastAttackAt = now }
    return { x,y,width,height,phase,stageId:stage.id,label:stage.label,attack,vulnerable:stage.vulnerable && !state.resolved,contact:!!state.resolved || active && stage.attack === 'contact',resolved:!!state.resolved }
  }
  function canDamage(p: BehaviorProgram, state?: BehaviorRuntime) { return !state?.resolved && !!p.stages[state?.index ?? 0]?.vulnerable }
  function defeat(p: BehaviorProgram, state: BehaviorRuntime): boolean {
    if (p.onDefeat !== 'hazard') return false
    state.resolved = true; state.index = p.stages.length - 1; state.enteredAt = -1; state.lastAttackAt = -1
    return true
  }
  return { validate, fresh, restore, step, canDamage, defeat }
}
export const behaviorProgramRules = createBehaviorProgramRules()
export function offlineBehaviorProgramSource() { return `const behaviorProgramRules=(${createBehaviorProgramRules.toString()})();` }
