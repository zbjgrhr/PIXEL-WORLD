import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enemyCombatRules, offlineEnemyCombatSource } from './enemy-combat'
import { createFallbackGameSpec } from './game-spec'
import { exportGameZip } from './export-game'
import { narrativeEngine } from './narrative-runtime'

afterEach(() => vi.unstubAllGlobals())

describe.each([
  ['online', enemyCombatRules],
  ['offline', new Function(`${offlineEnemyCombatSource()}return enemyCombatRules`)() as typeof enemyCombatRules],
] as const)('%s enemy combat rules', (_name, rules) => {
  it('keeps melee, ranged, flying and boss roles across survivor/save changes', () => {
    expect([0, 1, 2, 3].map(i => rules.usesRanged('patrol', 'ground', i))).toEqual([false, false, true, false])
    expect(rules.usesRanged('ranged', 'ground', 0)).toBe(true)
    expect(rules.usesRanged('patrol', 'air', 0)).toBe(true)
    expect(rules.restoredRanged({ uid: 'level-1-enemy-2', mobility: 'ground' }, 'patrol')).toBe(true)
    expect(rules.restoredRanged({ uid: 'level-1-enemy-3', mobility: 'ground' }, 'patrol')).toBe(false)
    expect(rules.restoredRanged({ uid: 'level-1-boss', mobility: 'boss' }, 'patrol')).toBe(true)
  })

  it('enforces attack range, cooldown and reaction locks with the same damage', () => {
    expect(rules.attackKind(false, false, 200, 52, 3000, false, true)).toBeNull()
    expect(rules.attackKind(false, false, 60, 52, 951, false, true)).toBe('melee')
    expect(rules.attackKind(false, false, 60, 52, 951, false, false)).toBeNull()
    expect(rules.attackKind(true, false, 200, 52, 2200, false, true)).toBeNull()
    expect(rules.attackKind(true, false, -510, 52, 2201, false, false)).toBeNull()
    expect(rules.attackKind(true, false, -350, 52, 2201, false, false)).toBe('ranged')
    expect(rules.attackKind(true, true, 200, 100, 1051, true, true)).toBeNull()
    expect(rules.projectileDamage(20, false)).toBe(12)
    expect(rules.projectileDamage(20, true)).toBe(15)
  })

  it('keeps enemies near their assigned encounter instead of stacking at the hero spawn', () => {
    expect(rules.moveWithinPatrol(270, -1, 500, 170, 370)).toBe(170)
    expect(rules.moveWithinPatrol(457, -1, 500, 357, 557)).toBe(357)
    expect(rules.moveWithinPatrol(780, -1, 500, 600, 960)).toBe(600)
  })
})

/** Execute the actual ZIP entry, including enemy update/attack/save wiring. */
it('exported game preserves melee roles on resume and deals real melee damage', async () => {
  const spec = createFallbackGameSpec('找回灯塔的光', '攻击回归', 1)
  spec.assets = []
  spec.narrative = undefined
  spec.enemies[0].behavior = 'patrol'
  const key = narrativeEngine.key(spec)
  const originalPlayer = { x: 200, y: 491, w: 54, h: 64, hp: 100, face: 1, on: true, vy: 0, invulnerable: 0, meleeReady: 0, rangedReady: 0, action: 'idle', actionStart: 0, actionUntil: 0 }
  const originalEnemy = { uid: spec.levels[0].id + '-enemy-3', x: 260, y: 501, baseY: 501, w: 52, h: 54, hp: 100, mobility: 'ground', phase: 3.45, on: true, vy: 0, lastAttack: 0, nextJump: 999999, action: 'idle', actionStart: 0, actionUntil: 0 }
  let zip: Blob | undefined
  vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { zip = blob; return 'blob:test' }, revokeObjectURL: vi.fn() })
  vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) })
  vi.stubGlobal('window', { setTimeout: vi.fn() })
  await exportGameZip(spec)
  const bytes = Buffer.from(await zip!.arrayBuffer())
  let source = '', offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLength + extraLength
    if (bytes.subarray(offset + 30, offset + 30 + nameLength).toString() === 'game.js') source = bytes.subarray(start, start + size).toString()
    offset = start + size
  }
  expect(source).not.toBe('')
  const run = async (x: number, y = originalPlayer.y) => {
    let frame: (time: number) => void = () => {}, save: () => void = () => {}, saved = ''
    const node = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, append() {}, replaceChildren() {} })
    const context = new Proxy({}, { get: () => () => {} })
    const elements = new Map<string, ReturnType<typeof node>>()
    runInNewContext(source, {
      document: {
        getElementById: () => ({ textContent: JSON.stringify(spec) }),
        querySelector: (selector: string) => {
          if (selector === 'canvas') return { getContext: () => context }
          if (!elements.has(selector)) elements.set(selector, node())
          return elements.get(selector)
        },
        querySelectorAll: () => [], createElement: node, body: node(),
      },
      performance: { now: () => 0 },
      requestAnimationFrame: (callback: typeof frame) => { frame = callback },
      setInterval: (callback: typeof save) => { save = callback }, addEventListener() {},
      localStorage: {
        getItem: () => JSON.stringify({ key, level: 0, levelScore: 0, score: 0, sim: 3000, player: { ...originalPlayer, x, y, on: y === originalPlayer.y }, enemies: [originalEnemy], items: [], story: narrativeEngine.fresh(spec), unread: [] }),
        setItem: (_key: string, value: string) => { saved = value },
      },
    })
    await new Promise(resolve => setImmediate(resolve))
    frame(16.67)
    save()
    return JSON.parse(saved)
  }
  const distant = await run(55)
  expect(distant.enemies[0].action).not.toBe('rangedAttack')
  expect(distant.enemies[0].lastAttack).toBe(0)
  expect(distant.player.hp).toBe(100)
  const nearby = await run(200)
  expect(nearby.enemies[0].action).toBe('meleeAttack')
  expect(nearby.player.hp).toBe(100 - spec.enemies[0].damage)
  const elevated = await run(200, 200)
  expect(elevated.enemies[0].lastAttack).toBe(0)
  expect(elevated.player.hp).toBe(100)
})
