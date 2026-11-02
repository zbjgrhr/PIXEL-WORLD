import { afterEach, describe, expect, it, vi } from 'vitest'
import { authoredMapRules, offlineAuthoredMapSource } from './authored-map'
import { bootOfflineMap as boot } from './test-support/offline-map'
import type { AuthoredLevelMap, MapMechanism } from '@/types'

const mapOf = (mechanisms: MapMechanism[] = []): AuthoredLevelMap => ({ version: 2, width: 1600, height: 720, groundY: 400,
  player: { x: 20, y: 336, width: 32, height: 64 }, exit: { x: 1400, y: 304, width: 64, height: 96 }, obstacles: [], enemies: [], collectibles: [], mechanisms })
const zone = (kind: 'freeze' | 'reverse' = 'freeze'): Extract<MapMechanism, { kind: 'freeze' | 'reverse' }> => ({ id: 'zone', kind, x: 0, y: 300, width: 150, height: 100, durationMs: 100, cooldownMs: 100 })

afterEach(() => vi.unstubAllGlobals())

describe('map mechanisms shared rules', () => {
  it('validates travel, versions, timers, unique IDs and safe respawn geometry', () => {
    const map = mapOf([{ id: 'lift', kind: 'movingPlatform', x: 200, y: 250, width: 80, height: 16, axis: 'x', distance: 200, speed: 2 }])
    expect(authoredMapRules.validate(map).mechanisms).toEqual(map.mechanisms)
    expect(() => authoredMapRules.validate({ ...map, version: 1 })).toThrow('version 2')
    expect(() => authoredMapRules.validate({ ...map, mechanisms: [{ ...zone(), durationMs: Infinity }] })).toThrow('durationMs')
    expect(() => authoredMapRules.validate({ ...map, mechanisms: [{ ...map.mechanisms![0], distance: 1600 }] })).toThrow('platform endpoint')
    expect(() => authoredMapRules.validate({ ...map, mechanisms: [{ ...zone(), id: '__proto__' }] })).toThrow('unique')
    expect(() => authoredMapRules.validate({ ...map, checkpoints: [{ id: 'lift', x: 30, y: 300, width: 40, height: 90, respawn: { x: 300, y: 336 } }] })).toThrow('unique')
    expect(() => authoredMapRules.validate({ ...map, checkpoints: [{ id: 'cp', x: 30, y: 300, width: 40, height: 90, respawn: { x: 300, y: 500 } }] })).toThrow('solid')
  })
  it('requires exit/reentry after expiry, uses simulation time and restores only known bounded timers', () => {
    const map = mapOf([zone()]), state = authoredMapRules.freshMechanisms()
    expect(authoredMapRules.mechanismFrame(map, state, map.player, 10, 10).frozen).toBe(true)
    expect(authoredMapRules.mechanismFrame(map, state, map.player, 111, 10).frozen).toBe(false)
    expect(authoredMapRules.mechanismFrame(map, state, map.player, 300, 10).frozen).toBe(false)
    authoredMapRules.mechanismFrame(map, state, { ...map.player, x: 300 }, 310, 10)
    expect(authoredMapRules.mechanismFrame(map, state, map.player, 320, 10).frozen).toBe(true)
    expect(authoredMapRules.restoreMechanisms(map, { entries: { zone: { inside: true, activatedAt: NaN, nextAt: 4 }, unknown: { inside: true, activatedAt: 2, nextAt: 3 } } }).entries).toEqual({})
  })
  it('carries horizontal/vertical riders, reverses at endpoints and detects blocked crushing', () => {
    for (const axis of ['x','y'] as const) {
      const map = mapOf([{ id: 'lift', kind: 'movingPlatform', x: 200, y: 250, width: 80, height: 16, axis, distance: 100, speed: 2 }])
      const frame = authoredMapRules.mechanismFrame(map, authoredMapRules.freshMechanisms(), map.player, 16.67, 16.67)
      const rider = { x: 220, y: 186, width: 32, height: 64, vx: 0, vy: 0, onGround: true }
      expect(authoredMapRules.transport(rider, frame, map)).toMatchObject({ x: axis === 'x' ? 222 : 220, y: axis === 'y' ? 188 : 186, dead: false })
      const endpoint = authoredMapRules.mechanismFrame(map, authoredMapRules.freshMechanisms(), map.player, 50 * 16.67, 16.67)
      expect(endpoint.platforms[0].after[axis]).toBeCloseTo((axis === 'x' ? 200 : 250) + 100)
    }
    const map = mapOf([{ id: 'lift', kind: 'movingPlatform', x: 200, y: 250, width: 80, height: 16, axis: 'x', distance: 100, speed: 2 }])
    map.obstacles = [{ id: 'wall', type: 'normalObstacle', x: 253, y: 180, width: 10, height: 70 }]
    const frame = authoredMapRules.mechanismFrame(map, authoredMapRules.freshMechanisms(), map.player, 16.67, 16.67)
    expect(authoredMapRules.transport({ x: 220, y: 186, width: 32, height: 64, vx: 0, vy: 0, onGround: true }, frame, map).dead).toBe(true)
    const fast = mapOf([{ id: 'fast', kind: 'movingPlatform', x: 200, y: 250, width: 1, height: 16, axis: 'x', distance: 100, speed: 20 }])
    const swept = authoredMapRules.mechanismFrame(fast, authoredMapRules.freshMechanisms(), fast.player, 33.34, 33.34)
    expect(authoredMapRules.transport({ x: 220, y: 250, width: 1, height: 16, vx: 0, vy: 0, onGround: false }, swept, fast).x).toBe(241)
  })
  it('preserves the same entry/expiry/trap warning results in exported scope', () => {
    const offline = new Function(`${offlineAuthoredMapSource()};return authoredMapRules`)() as typeof authoredMapRules
    const map = mapOf([{ ...zone(), id: 'trap', kind: 'trap', delayMs: 100 }]), a = authoredMapRules.freshMechanisms(), b = offline.freshMechanisms()
    for (const now of [10,50,110,150,211,400]) expect(offline.mechanismFrame(map,b,map.player,now,16)).toEqual(authoredMapRules.mechanismFrame(map,a,map.player,now,16))
  })
})

describe('actual exported mechanism engine', () => {
  it('freezes motion and attacks, pauses the timer, then releases without reapplying while inside', async () => {
    const game = await boot(mapOf([zone()]))
    game.key('d'); game.key('w'); game.tick()
    const frozen = game.read()
    expect(frozen.player).toMatchObject({ x: 20, y: 336, frozen: true })
    game.key('j'); expect(game.read().player.action).not.toBe('meleeAttack')
    game.pause(); game.tick(20); expect(game.read().sim).toBe(frozen.sim)
    game.pause(); game.key('d'); game.tick(8)
    expect(game.read().player.frozen).toBe(false)
    expect(game.read().player.x).toBeGreaterThan(20)
  })
  it('reverses direction only for the configured duration', async () => {
    const game = await boot(mapOf([zone('reverse')]))
    game.key('d'); game.tick()
    expect(game.read().player.x).toBe(15)
    expect(game.read().player.reversed).toBe(true)
    game.tick(7)
    expect(game.read().player.reversed).toBe(false)
    expect(game.read().player.x).toBeGreaterThan(0)
  })
  it('arms a delayed trap, kills after its warning, and retries at the checkpoint with fresh mechanisms', async () => {
    const map = mapOf([{ ...zone(), kind: 'trap', id: 'trap', delayMs: 100 }])
    map.checkpoints = [{ id: 'cp', x: 20, y: 300, width: 40, height: 100, respawn: { x: 300, y: 336 } }]
    const game = await boot(map)
    game.tick(5); expect(game.read().player.hp).toBeGreaterThan(0)
    expect(game.read().mechanismState.checkpointId).toBe('cp')
    game.tick(3); expect(game.read().player.hp).toBe(0)
    game.tick(44)
    expect(game.read().player.x).toBe(300)
    expect(game.read().player.hp).toBeGreaterThan(0)
    expect(game.read().mechanismState.checkpointId).toBe('cp')
    expect(game.read().mechanismState.entries.trap?.activatedAt ?? -1).toBe(-1)
  })
  it('restores checkpoint selection and remaining freeze time from an actual saved session', async () => {
    const map = mapOf([{ ...zone(), durationMs: 1000 }])
    map.checkpoints = [{ id: 'cp', x: 20, y: 300, width: 40, height: 100, respawn: { x: 300, y: 336 } }]
    const first = await boot(map); first.tick(10)
    const save = first.save(), previousTime = first.read().sim
    const loaded = await boot(map, save)
    expect(loaded.read().mechanismState.checkpointId).toBe('cp')
    expect(loaded.read().player.frozen).toBe(true)
    expect(loaded.read().sim).toBeCloseTo(previousTime)
    loaded.tick(60)
    expect(loaded.read().player.frozen).toBe(false)
    expect(loaded.read().mechanismState.checkpointId).toBe('cp')
  })
})
