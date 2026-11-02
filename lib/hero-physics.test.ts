import { describe, expect, it } from 'vitest'
import { heroPhysics, offlineHeroPhysicsSource } from './hero-physics'
import { createFallbackGameSpec, normalizeGameSpec } from './game-spec'
import { changedDraftGroups } from './agents/draft-revision'
import type { HeroPhysicsSpec } from '@/types'

const settings: HeroPhysicsSpec = { acceleration: 0, gravity: 0.4, airControl: 1, jumpCount: 2, releaseJumpSpeed: 4, runUpBoost: 0.5, runUpLimit: 50 }
const ground = { vx: 0, vy: 0, onGround: true }
const input = (jump: boolean, direction = 0) => ({ jump, direction, locked: false })

describe('shared hero movement', () => {
  it('retains old single-jump and held-key controls without an advanced profile', () => {
    expect(heroPhysics.drive(ground, input(true, 1), 5, 15, 1).vy).toBe(-15)
    expect(heroPhysics.drive({ ...ground, onGround: false }, input(true, 1), 5, 15, 1).vy).toBe(0)
  })
  it('requires a release between jumps, cuts ascent on release, and rejects a third jump until landing', () => {
    const first = heroPhysics.drive(ground, input(true), 5, 9, 1, settings)
    const held = heroPhysics.drive({ ...first, vy: -8 }, input(true), 5, 9, 1, settings)
    expect(held.jumpsUsed).toBe(1)
    const release = heroPhysics.drive(held, input(false), 5, 9, 1, settings)
    expect(release.vy).toBe(-4)
    const second = heroPhysics.drive(release, input(true), 5, 9, 1, settings)
    expect(second.jumpsUsed).toBe(2)
    const third = heroPhysics.drive({ ...second, jumpHeld: false }, input(true), 5, 9, 1, settings)
    expect(third.jumped).toBe(false)
    expect(heroPhysics.drive({ ...third, onGround: true }, input(false), 5, 9, 1, settings).jumpsUsed).toBe(0)
  })
  it('applies acceleration, preserves airborne momentum with zero control, and limits run-up boost', () => {
    expect(heroPhysics.drive(ground, input(false, 1), 5, 9, 1, { ...settings, acceleration: 0.5 }).vx).toBe(0.5)
    expect(heroPhysics.drive({ ...ground, vx: 3, onGround: false }, input(false, -1), 5, 9, 1, { ...settings, airControl: 0 }).vx).toBe(3)
    expect(heroPhysics.drive({ ...ground, vx: 3, onGround: false }, input(false, 1), 5, 9, 1, { ...settings, airControl: 0.5 }).vx).toBe(4)
    expect(heroPhysics.drive({ ...ground, runUp: 100 }, input(true, 1), 5, 9, 1, settings).vy).toBe(-34)
  })
  it('runs the exact serialized rules in an offline scope with identical results', () => {
    const offline = new Function(`${offlineHeroPhysicsSource()}; return heroPhysics`)() as typeof heroPhysics
    for (const state of [ground, { ...ground, vx: 3, onGround: false, jumpsUsed: 1, jumpHeld: true }]) {
      for (const jump of [true, false]) for (const direction of [-1, 0, 1]) {
        expect(offline.drive(state, input(jump, direction), 5, 9, 1.5, settings)).toEqual(heroPhysics.drive(state, input(jump, direction), 5, 9, 1.5, settings))
      }
    }
    for (const mode of ['ground', 'water', 'air']) expect(offline.gravity(settings, mode, true)).toBe(heroPhysics.gravity(settings, mode))
  })
  it('rejects invalid imported values and preserves player physics against model replacement', () => {
    expect(() => heroPhysics.validate({ ...settings, gravity: NaN })).toThrow('gravity')
    expect(() => heroPhysics.validate({ ...settings, jumpCount: 1.2 })).toThrow('jumpCount')
    const spec = createFallbackGameSpec('森林', '测试', 1)
    spec.hero.physics = settings
    expect(normalizeGameSpec({ ...spec, hero: { ...spec.hero, physics: { ...settings, gravity: 4 } } }, spec).hero.physics).toEqual(settings)
    expect(changedDraftGroups(spec, { ...spec, hero: { ...spec.hero, physics: { ...settings, gravity: 0.5 } } })).toContain('gameplay')
  })
})
