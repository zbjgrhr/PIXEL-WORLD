import { describe, expect, it } from 'vitest'
import { authoredMapRules, offlineAuthoredMapSource } from './authored-map'
import { createFallbackGameSpec, normalizeGameSpec } from './game-spec'
import { normalizeModelGameSpec } from './model-game-spec'
import { buildGameDataFromSpec } from './virtual-levels'
import { ensureEncounterClearance } from './encounter-layout'
import { stabilizeGameSpec } from './game-spec-guardrails'
import { narrativeEngine } from './narrative-runtime'
import { migrateGameData } from './store'
import type { AuthoredLevelMap } from '@/types'

export const testMap = (): AuthoredLevelMap => ({ version: 1, width: 2000, height: 1600, groundY: null, player: { x: 60, y: 536, width: 32, height: 64 }, exit: { x: 1450, y: 1200, width: 64, height: 96 }, obstacles: [{ id: 'platform-a', x: 40, y: 600, width: 250, height: 16, type: 'platform' }], enemies: [], collectibles: [] })
describe('authored maps', () => {
  it('retains exact zeros, thin platforms, dimensions and deliberately empty spawn arrays', () => {
    const spec = createFallbackGameSpec('原作地图', '精确地图', 1), map = testMap()
    map.obstacles.push({ id: 'thin', x: 0, y: 300, width: 1, height: 80, type: 'normalObstacle' })
    spec.levels[0].map = map
    const level = buildGameDataFromSpec(spec).data!.levels[0]
    expect(level.authoredMap).toEqual(map)
    expect(level.obstacles[1].x).toBe(0)
    expect(level.enemySpawns).toEqual([])
    expect(level.bossSpawn).toBeUndefined()
    expect(ensureEncounterClearance(level, 5)).toBe(level)
    const migrated = migrateGameData(buildGameDataFromSpec(spec), 'map-test')
    expect(migrated.data!.levels[0].authoredMap).toEqual(map)
    expect(migrated.data!.levels[0].layoutVersion).toBe(3)
    expect(migrated.data!.levels[0].enemySpawns).toEqual([])
  })
  it('protects maps from model rewrites, normalization and automatic final-Boss insertion', () => {
    const spec = createFallbackGameSpec('原作地图', '精确地图', 1); spec.levels[0].map = testMap()
    const candidate = { ...spec, levels: [{ ...spec.levels[0], map: { ...testMap(), width: 3000 } }] }
    expect(normalizeGameSpec(candidate, spec).levels[0].map).toEqual(testMap())
    expect(normalizeModelGameSpec(candidate, spec, 1, '').levels[0].map).toEqual(testMap())
    const stabilized = stabilizeGameSpec(spec)
    expect(stabilized.levels[0]).toMatchObject({ enemyCount: 0, collectibleCount: 0, hasBoss: false })
  })
  it('rejects NaN, unsupported mechanics, duplicate IDs and overlaps instead of silently fixing a route', () => {
    expect(() => authoredMapRules.validate({ ...testMap(), width: NaN })).toThrow('width')
    expect(() => authoredMapRules.validate({ ...testMap(), checkpoints: [] })).toThrow('version 2')
    const duplicate = testMap(); duplicate.obstacles.push({ ...duplicate.obstacles[0] })
    expect(() => authoredMapRules.validate(duplicate)).toThrow('unique')
    const overlap = testMap(); overlap.player.y = 580
    expect(() => authoredMapRules.validate(overlap)).toThrow('overlaps')
  })
  it('sweeps against thin walls and floating platforms and handles ceilings, bounce and falls', () => {
    const map = testMap(), actor = { x: 50, y: 110, width: 40, height: 40, vx: 100, vy: 0 }
    const wall = { id: 'wall', x: 110, y: 100, width: 1, height: 100, type: 'normalObstacle' }
    expect(authoredMapRules.move(actor, [wall], 1, 0.4, map, 9).x).toBe(70)
    const platform = { id: 'p', x: 200, y: 400, width: 200, height: 16, type: 'platform' }
    expect(authoredMapRules.move({ ...actor, x: 250, y: 300, vx: 0, vy: 100 }, [platform], 1, 0.4, map, 9)).toMatchObject({ y: 360, onGround: true, vy: 0 })
    expect(authoredMapRules.move({ ...actor, x: 250, y: 450, vx: 0, vy: -100 }, [platform], 1, 0.4, map, 9)).toMatchObject({ y: 416, vy: 0 })
    expect(authoredMapRules.move({ ...actor, x: 250, y: 300, vx: 0, vy: 100 }, [{ ...platform, type: 'bounceObstacle' }], 1, 0.4, map, 10)).toMatchObject({ vy: -13.5, onGround: false })
    expect(authoredMapRules.move({ ...actor, y: 1601 }, [], 1, 0.4, map, 9).dead).toBe(true)
  })
  it('runs identical geometry rules in offline scope and invalidates incompatible saves', () => {
    const offline = new Function(`${offlineAuthoredMapSource()};return authoredMapRules`)() as typeof authoredMapRules
    const map = testMap(), actor = { ...map.player, vx: 5, vy: 3 }
    expect(offline.move(actor, map.obstacles, 1.5, 0.4, map, 9)).toEqual(authoredMapRules.move(actor, map.obstacles, 1.5, 0.4, map, 9))
    const spec = createFallbackGameSpec('原作', '存档', 1), original = narrativeEngine.key(spec)
    expect(narrativeEngine.key({ ...spec, levels: [{ ...spec.levels[0], map }] })).not.toBe(original)
    expect(narrativeEngine.key({ ...spec, hero: { ...spec.hero, physics: { acceleration: 0, gravity: 0.4, airControl: 1, jumpCount: 2, releaseJumpSpeed: 4, runUpBoost: 0.5, runUpLimit: 50 } } })).not.toBe(original)
  })
})
