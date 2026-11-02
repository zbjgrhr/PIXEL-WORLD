import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpatialProject } from './spec'
import { createRhythmEngine } from './rhythm-engine'

const source = readFileSync(new URL('../../public/spatial/runtime.js', import.meta.url), 'utf8')
afterEach(() => vi.unstubAllGlobals())
function boot(genre: 'rhythm' | 'exploration', chartVersion: 1 | 2 = 1, feedback?: { effects: number; hitVolume: number; musicVolume: number; shake: boolean }, reducedMotion = false) {
  const events = new Map<string, (e?: unknown) => unknown>(), nodes = new Map<string, ReturnType<typeof element>>()
  const gl = new Proxy({}, { get: (_, key) => String(key).toUpperCase() === key ? 1 : () => ({}) })
  const element = () => ({ id: '', style: { setProperty: vi.fn(), transform: '' }, dataset: {} as Record<string, string>, textContent: '', clientWidth: 800, clientHeight: 600, width: 800, height: 600, disabled: false,
    setAttribute: vi.fn(), setPointerCapture: vi.fn(), focus: vi.fn(), appendChild: vi.fn(), getContext: () => gl,
    addEventListener: vi.fn(), getBoundingClientRect: () => ({ width: 800, height: 600 }) })
  const node = (id: string) => { if (!nodes.has(id)) { const n = element(); n.addEventListener = vi.fn((event, fn) => events.set(`${id}:${event}`, fn)); nodes.set(id, n) } return nodes.get(id)! }
  const spec = createSpatialProject('星夜', genre); spec.rhythm = { bpm: 160, bars: 4, offsetMs: 0, chartVersion, ...(feedback ? { feedback } : {}) }
  node('spatial-project').textContent = JSON.stringify(spec)
  const context2d = new Proxy({}, { get: () => () => {} })
  const gainValues: number[] = []
  const audio = { state: 'suspended', currentTime: 0, destination: {}, resume: async () => { audio.state = 'running' }, suspend: async () => { audio.state = 'suspended' }, close: vi.fn(async () => {}),
    createOscillator: () => ({ type: '', frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }),
    createGain: () => ({ gain: { setValueAtTime: vi.fn((value: number) => gainValues.push(value)), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }) }
  let frame: (time: number) => void = () => {}, timestamp = 0
  const win = { AudioContext: function () { return audio }, matchMedia: () => ({ matches: reducedMotion }), addEventListener: (name: string, fn: (e?: unknown) => unknown) => events.set(`window:${name}`, fn), pixelWorldSpatial: undefined as unknown as { snapshot: () => { playing: boolean; won: boolean; score: number; hits: number; time: number; rhythm: ReturnType<ReturnType<typeof createRhythmEngine>['snapshot']>; position: { x: number; z: number } } } }
  vi.stubGlobal('window', win); vi.stubGlobal('navigator', {}); vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('requestAnimationFrame', (fn: typeof frame) => { frame = fn; return 1 }); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('document', { getElementById: node, querySelector: () => node('actions'), querySelectorAll: () => [], createElement: () => { const el = { ...element(), getContext: () => context2d }; el.addEventListener = vi.fn((name, fn) => { if (el.id) nodes.set(el.id, el as ReturnType<typeof element>); events.set(`${el.id}:${name}`, fn) }); return el }, pointerLockElement: null, addEventListener: (name: string, fn: (e?: unknown) => unknown) => events.set(`document:${name}`, fn) })
  new Function('createRhythmEngine', source)(createRhythmEngine)
  return { read: () => win.pixelWorldSpatial.snapshot(), audio, gainValues, canvas: node('world'),
    start: async () => { events.get('start:click')!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() },
    pause: () => events.get('pause:click')!(),
    key: (key: string, down = true) => events.get(`window:${down ? 'keydown' : 'keyup'}`)!({ key, repeat: false, preventDefault: vi.fn() }),
    pointer: (lane: number, down = true, pointerId = 1) => events.get(`lane-${lane}:${down ? 'pointerdown' : 'pointerup'}`)!({ pointerId, preventDefault: vi.fn() }),
    data: () => node('world').dataset,
    tick: (seconds: number) => { audio.currentTime += seconds; timestamp += seconds * 1000; frame(timestamp) },
    dispose: () => events.get('window:pagehide')!(),
  }
}
describe('shared online/offline spatial runtime', () => {
  it('starts audio, judges a four-lane note and reaches the rhythm ending', async () => {
    const game = boot('rhythm'); await game.start(); expect(game.read().playing).toBe(true)
    const first = game.read().rhythm.notes[0]
    game.tick(first.time); game.key(['d', 'f', 'j', 'k'][first.lane])
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
  it('completes a held note even if a second input source releases, then recognizes a real chord', async () => {
    const game = boot('rhythm', 2); await game.start()
    const hold = game.read().rhythm.notes.find(n => n.kind === 'hold')!, keys = ['d', 'f', 'j', 'k']
    game.tick(hold.time); game.key(keys[hold.lane]); game.pointer(hold.lane, true); game.pointer(hold.lane, false)
    game.tick(hold.end - hold.time); game.key(keys[hold.lane], false)
    expect(game.read().rhythm.holdsCompleted).toBe(1); expect(game.data().holdsCompleted).toBe('1')
    const chord = game.read().rhythm.notes.find(n => n.chord >= 0)!, group = game.read().rhythm.notes.filter(n => n.chord === chord.chord)
    game.tick(chord.time - game.read().time); for (const n of group) game.key(keys[n.lane])
    expect(game.read().rhythm.chordHits).toBe(1)
  })
  it('keeps judging with muted buses and disables shake for reduced motion', async () => {
    const game = boot('rhythm', 2, { effects: 1, hitVolume: 0, musicVolume: 0, shake: true }, true)
    await game.start(); expect(game.gainValues.slice(0, 2)).toEqual([0, 0])
    const first = game.read().rhythm.notes[0]; game.tick(first.time); game.key(['d', 'f', 'j', 'k'][first.lane]); game.tick(.01)
    expect(game.read().rhythm.hits).toBe(1); expect(game.canvas.style.transform).toBe('none')
    expect(game.read().playing).toBe(true)
  })
})
