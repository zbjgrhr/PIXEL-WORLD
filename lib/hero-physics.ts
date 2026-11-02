import type { HeroPhysicsSpec } from '@/types'

/** Self-contained factory: both live and exported games execute these rules. */
function createHeroPhysics() {
  type State = { vx: number; vy: number; onGround: boolean; jumpsUsed?: number; jumpHeld?: boolean; runUp?: number }
  type Input = { direction: number; jump: boolean; locked: boolean }
  function validate(value: HeroPhysicsSpec): HeroPhysicsSpec {
    const limits: Record<keyof HeroPhysicsSpec, [number, number]> = {
      acceleration: [0, 30], gravity: [0.05, 5], airControl: [0, 1], jumpCount: [1, 8],
      releaseJumpSpeed: [0, 60], runUpBoost: [0, 2], runUpLimit: [0, 100],
    }
    for (const key of Object.keys(limits) as Array<keyof HeroPhysicsSpec>) {
      const number = value[key], [min, max] = limits[key]
      if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || key === 'jumpCount' && !Number.isInteger(number)) throw new Error(`Invalid hero.physics.${key}`)
    }
    return Object.fromEntries(Object.keys(limits).map(key => [key, value[key as keyof HeroPhysicsSpec]])) as unknown as HeroPhysicsSpec
  }
  function drive(state: State, input: Input, speed: number, jumpPower: number, delta: number, settings?: HeroPhysicsSpec) {
    const direction = Math.max(-1, Math.min(1, input.direction))
    if (!settings) {
      const jumped = !input.locked && input.jump && state.onGround
      return { vx: input.locked ? 0 : direction * speed, vy: jumped ? -jumpPower : state.vy,
        onGround: jumped ? false : state.onGround, jumpsUsed: jumped ? 1 : state.jumpsUsed || 0, jumpHeld: input.jump, runUp: 0, jumped }
    }
    let used = state.onGround ? 0 : state.jumpsUsed ?? 1
    const runUp = state.onGround && direction && !input.locked ? Math.min(settings.runUpLimit, (state.runUp || 0) + delta) : 0
    const target = direction * speed
    const control = state.onGround ? 1 : settings.airControl
    const approach = settings.acceleration === 0 ? Math.abs(target - state.vx) * (1 - Math.pow(1 - control, delta)) : settings.acceleration * delta * control
    const vx = input.locked ? 0 : state.vx + Math.sign(target - state.vx) * Math.min(Math.abs(target - state.vx), approach)
    const jumped = !input.locked && input.jump && !state.jumpHeld && used < settings.jumpCount
    let vy = state.vy
    if (jumped) { vy = -(jumpPower + runUp * settings.runUpBoost); used++ }
    if (!input.jump && state.jumpHeld && vy < -settings.releaseJumpSpeed) vy = -settings.releaseJumpSpeed
    return { vx, vy, onGround: jumped ? false : state.onGround, jumpsUsed: used, jumpHeld: input.jump, runUp, jumped }
  }
  function gravity(settings: HeroPhysicsSpec | undefined, mode: string, offline = false) {
    if (settings) return settings.gravity * (mode === 'water' ? 0.34 : mode === 'air' ? 0.68 : 1)
    // Preserve historical defaults in both runtimes for existing projects.
    return offline ? mode === 'water' ? 0.29 : mode === 'air' ? 0.56 : 0.82 : 0.82 * (mode === 'water' ? 0.34 : mode === 'air' ? 0.68 : 1)
  }
  return { drive, gravity, validate }
}

export const heroPhysics = createHeroPhysics()
export function offlineHeroPhysicsSource(): string { return `const heroPhysics=(${createHeroPhysics.toString()})();` }
