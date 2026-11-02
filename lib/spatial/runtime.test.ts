import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpatialProject } from './spec'

const source = readFileSync(new URL('../../public/spatial/runtime.js', import.meta.url), 'utf8')
afterEach(() => vi.unstubAllGlobals())
function boot(genre: 'rhythm' | 'exploration') {
  const events = new Map<string, (e?: unknown) => unknown>(), nodes = new Map<string, ReturnType<typeof element>>()
  const gl = new Proxy({}, { get: (_, key) => String(key).toUpperCase() === key ? 1 : () => ({}) })
  const element = () => ({ style: {}, dataset: {} as Record<string, string>, textContent: '', clientWidth: 800, clientHeight: 600, width: 800, height: 600, disabled: false,
    setAttribute: vi.fn(), focus: vi.fn(), appendChild: vi.fn(), getContext: () => gl,
    addEventListener: vi.fn(), getBoundingClientRect: () => ({ width: 800, height: 600 }) })
  const node = (id: string) => { if (!nodes.has(id)) { const n = element(); n.addEventListener = vi.fn((event, fn) => events.set(`${id}:${event}`, fn)); nodes.set(id, n) } return nodes.get(id)! }
  const spec = createSpatialProject('星夜', genre); spec.rhythm = { bpm: 160, bars: 4, offsetMs: 0 }
  node('spatial-project').textContent = JSON.stringify(spec)
  const context2d = new Proxy({}, { get: () => () => {} })
  const audio = { state: 'suspended', currentTime: 0, destination: {}, resume: async () => { audio.state = 'running' }, suspend: async () => { audio.state = 'suspended' }, close: vi.fn(async () => {}),
    createOscillator: () => ({ type: '', frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }),
    createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }) }
  let frame: (time: number) => void = () => {}, timestamp = 0
  const win = { AudioContext: function () { return audio }, addEventListener: (name: string, fn: (e?: unknown) => unknown) => events.set(`window:${name}`, fn), pixelWorldSpatial: undefined as unknown as { snapshot: () => { playing: boolean; won: boolean; score: number; hits: number; time: number; position: { x: number; z: number } } } }
  vi.stubGlobal('window', win); vi.stubGlobal('navigator', {}); vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('requestAnimationFrame', (fn: typeof frame) => { frame = fn; return 1 }); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('document', { getElementById: node, querySelector: () => node('actions'), querySelectorAll: () => [], createElement: () => ({ ...element(), getContext: () => context2d }), pointerLockElement: null, addEventListener: (name: string, fn: (e?: unknown) => unknown) => events.set(`document:${name}`, fn) })
  new Function(source)()
  return { read: () => win.pixelWorldSpatial.snapshot(), audio,
    start: async () => { events.get('start:click')!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() },
    pause: () => events.get('pause:click')!(),
    key: (key: string, down = true) => events.get(`window:${down ? 'keydown' : 'keyup'}`)!({ key, repeat: false, preventDefault: vi.fn() }),
    tick: (seconds: number) => { audio.currentTime += seconds; timestamp += seconds * 1000; frame(timestamp) },
    dispose: () => events.get('window:pagehide')!(),
  }
}
describe('shared online/offline spatial runtime', () => {
  it('starts audio, judges a four-lane note and reaches the rhythm ending', async () => {
    const game = boot('rhythm'); await game.start(); expect(game.read().playing).toBe(true)
    game.tick(2); for (const key of ['d', 'f', 'j', 'k']) game.key(key)
    expect(game.read().hits).toBe(1); expect(game.read().score).toBe(100)
    game.tick(7); expect(game.read().won).toBe(true); expect(game.read().playing).toBe(false)
  })
  it('freezes the audio clock and rejects note hits while paused', async () => {
    const game = boot('rhythm'); await game.start(); game.tick(1); game.pause(); const before = game.read().time
    game.tick(2); for (const key of ['d', 'f', 'j', 'k']) game.key(key)
    expect(game.read().time).toBe(before); expect(game.read().hits).toBe(0)
    await game.start(); expect(game.read().time).toBe(before)
  })
  it('moves the exploration player and releases audio on leaving the frame', async () => {
    const game = boot('exploration'); await game.start(); const before = game.read().position.x; game.key('d')
    for (let i = 0; i < 20; i++) game.tick(.016)
    expect(game.read().position.x).toBeGreaterThan(before)
    game.dispose(); expect(game.audio.close).toHaveBeenCalledOnce()
  })
})
