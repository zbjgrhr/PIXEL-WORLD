import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFallbackGameSpec } from './game-spec'
import { offlineGameRuntimeSource } from './export-game'
import { buildGameDataFromSpec } from './virtual-levels'
import type { AuthoredLevelMap } from '@/types'

afterEach(() => vi.unstubAllGlobals())
describe('actual offline engine with authored geometry', () => {
  it('boots exact spawn dimensions, follows a tall map, blocks a thin wall and retains explicit empty spawns', async () => {
    const spec = createFallbackGameSpec('地图检查', '精确地图', 1)
    spec.narrative = undefined
    spec.assets = spec.assets.map(a => ({ ...a, enabled: false, url: '' }))
    const map: AuthoredLevelMap = { version: 1, width: 2000, height: 1600, groundY: null,
      player: { x: 60, y: 536, width: 32, height: 64 }, exit: { x: 1450, y: 1200, width: 64, height: 96 },
      obstacles: [{ id: 'floor', x: 40, y: 600, width: 250, height: 16, type: 'platform' }, { id: 'wall', x: 180, y: 500, width: 1, height: 100, type: 'normalObstacle' }], enemies: [], collectibles: [] }
    spec.levels[0] = { ...spec.levels[0], map, enemyCount: 0, collectibleCount: 0, hasBoss: false }
    const levels = buildGameDataFromSpec(spec).data!.levels
    const element = () => ({ style: {}, classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() }, dataset: {}, setAttribute: vi.fn(), append: vi.fn(), replaceChildren: vi.fn(), textContent: '' })
    const translations: Array<[number, number]> = []
    const context = new Proxy({ translate: (x: number, y: number) => translations.push([x,y]) }, { get: (target, key) => Reflect.has(target, key) ? Reflect.get(target, key) : () => undefined })
    const listeners = new Map<string, (e: { key: string; preventDefault: () => void }) => void>()
    let frame: (time: number) => void = () => { throw Error('No animation frame') }
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), body: { append: vi.fn() }, createElement: element, querySelectorAll: () => [], querySelector: (s: string) => s === 'canvas' ? { getContext: () => context } : element(), getElementById: (id: string) => ({ textContent: JSON.stringify(id === 'project-data' ? spec : { levels }) }) })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    vi.stubGlobal('performance', { now: () => 0 })
    vi.stubGlobal('setInterval', vi.fn())
    vi.stubGlobal('addEventListener', (name: string, callback: (e: { key: string; preventDefault: () => void }) => void) => listeners.set(name, callback))
    vi.stubGlobal('requestAnimationFrame', (callback: typeof frame) => { frame = callback; return 1 })
    vi.stubGlobal('__pixelWorldReadOnlySnapshot', undefined)
    new Function(offlineGameRuntimeSource())()
    await Promise.resolve(); await Promise.resolve()
    const read = () => (globalThis as unknown as { __pixelWorldReadOnlySnapshot: () => { player: { x: number; y: number; w: number; h: number }; enemies: unknown[]; worldHeight: number; obstacles: Array<{ x: number; w: number; y: number }> } }).__pixelWorldReadOnlySnapshot()
    expect(read().player).toMatchObject({ x: 60, y: 536, w: 32, h: 64 })
    expect(read().enemies).toEqual([])
    expect(read().obstacles[1]).toMatchObject({ x: 180, y: 500, w: 1 })
    expect(read().worldHeight).toBe(1600)
    listeners.get('keydown')!({ key: 'd', preventDefault: () => undefined })
    for (let i = 1; i <= 30; i++) frame(i * 16.67)
    expect(read().player.x).toBe(148)
    expect(read().player.y).toBe(536)
    expect(translations.some(([,y]) => y < 0)).toBe(true)
  })
})
