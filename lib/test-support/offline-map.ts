import type { PlaytestTrace } from '../playtest-trace'
import { vi } from 'vitest'
import { authoredMapRules } from '../authored-map'
import { createFallbackGameSpec } from '../game-spec'
import { offlineGameRuntimeSource } from '../export-game'
import { buildGameDataFromSpec } from '../virtual-levels'
import type { AuthoredLevelMap, GameSpec, CharacterRosterState, BehaviorRuntime } from '@/types'
export async function bootOfflineMap(map: AuthoredLevelMap, stored?: string | Record<string,string>, configure?: (spec: GameSpec) => void) {
  const spec = createFallbackGameSpec('机制检查', '合成机制', 1)
  spec.narrative = undefined
  spec.hero.moveSpeed = 5
  spec.assets = spec.assets.map(a => ({ ...a, enabled: false, url: '' }))
  spec.levels[0] = { ...spec.levels[0], map: authoredMapRules.validate(map), enemyCount: 0, collectibleCount: 0, hasBoss: false }
  configure?.(spec)
  const levels = buildGameDataFromSpec(spec).data!.levels
  const nodes = new Map<string, ReturnType<typeof element>>()
  const element = () => ({ style: {}, classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() }, dataset: {}, setAttribute: vi.fn(), append: vi.fn(), replaceChildren: vi.fn(), textContent: '', onclick: () => {} })
  const node = (s: string) => { if (!nodes.has(s)) nodes.set(s, element()); return nodes.get(s)! }
  const draws:unknown[][]=[]
  const context = new Proxy({drawImage:(...args:unknown[])=>draws.push(args)}, { get: (target,key) => Reflect.has(target,key)?Reflect.get(target,key):()=>undefined })
  const listeners = new Map<string, (e: { key: string; preventDefault: () => void }) => void>()
  let frame: (time: number) => void = () => { throw Error('No frame') }, time = 0, save = () => {}, storage = typeof stored === 'string' ? stored : ''
  const savedValues=new Map<string,string>(typeof stored==='object'?Object.entries(stored):[])
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), body: { append: vi.fn() }, createElement: element, querySelectorAll: () => [], querySelector: (s: string) => s === 'canvas' ? { getContext: () => context } : node(s), getElementById: (id: string) => ({ textContent: JSON.stringify(id === 'project-data' ? spec : { levels }) }) })
  vi.stubGlobal('localStorage', { getItem: (key:string) => savedValues.get(key) || (!key.endsWith(':trace')?storage:null), setItem: (key: string, value: string) => { savedValues.set(key,value);if(!key.endsWith(':trace'))storage = value }, removeItem: (key:string) => { savedValues.delete(key);if(!key.endsWith(':trace'))storage = '' } })
  vi.stubGlobal('performance', { now: () => 0 })
  vi.stubGlobal('setInterval', (callback: () => void) => { save = callback; return 1 })
  vi.stubGlobal('addEventListener', (name: string, callback: (e: { key: string; preventDefault: () => void }) => void) => listeners.set(name, callback))
  vi.stubGlobal('requestAnimationFrame', (callback: typeof frame) => { frame = callback; return 1 })
  vi.stubGlobal('__pixelWorldReadOnlySnapshot', undefined)
  new Function(offlineGameRuntimeSource())()
  await Promise.resolve(); await Promise.resolve()
  type Snapshot = { trace:PlaytestTrace; rosterState?: CharacterRosterState; enemies: Array<{hp:number; programState?: BehaviorRuntime; programLabel?:string;programPhase?:string}>; score:number; won:boolean; sim: number; player: { x: number; y: number; vy:number; hp: number; w:number;h:number;meleeReady:number; frozen: boolean; reversed: boolean; action: string }; mechanismState: { checkpointId?: string; entries: Record<string, { activatedAt: number }> }; obstacles: unknown[] }
  return {
    read: () => ({...(globalThis as unknown as { __pixelWorldReadOnlySnapshot: () => Snapshot }).__pixelWorldReadOnlySnapshot(),trace:(globalThis as unknown as {__pixelWorldReadOnlyTrace:()=>PlaytestTrace}).__pixelWorldReadOnlyTrace()}),
    draws,
    key: (key: string, down = true) => listeners.get(down ? 'keydown' : 'keyup')!({ key, preventDefault: () => {} }),
    tick: (count = 1) => { for (let i = 0; i < count; i++) { time += 16.67; frame(time) } },
    pause: () => node('[data-pause]').onclick(),
    save: () => { save(); return storage },
    saveAll: () => { save(); return Object.fromEntries(savedValues) },
  }
}
