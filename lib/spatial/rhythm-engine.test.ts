import { describe, expect, it } from 'vitest'
import { createRhythmEngine } from './rhythm-engine'

const settings = { bpm: 120, bars: 4, chartVersion: 2 as const, difficulty: 'normal' as const }
const classic = (chart = [{ time: 2, lane: 0 }]) => createRhythmEngine({ bpm: 120, bars: 4 }, 42, chart)
describe('rhythm judgment and phrase composition', () => {
  it('composes reproducible phrases with holds, simultaneous notes and clear same-lane spacing', () => {
    const a = createRhythmEngine(settings, 125), b = createRhythmEngine(settings, 125)
    expect(a.snapshot()).toEqual(b.snapshot()); expect(a.notes.some(n => n.kind === 'hold')).toBe(true)
    expect(a.notes.some(n => n.chord >= 0)).toBe(true)
    for (let lane = 0; lane < 4; lane++) {
      const notes = a.notes.filter(n => n.lane === lane)
      for (let i = 1; i < notes.length; i++) expect(notes[i].time - notes[i - 1].end).toBeGreaterThanOrEqual(.199)
    }
    expect(a.total).toBe(a.notes.length + a.notes.filter(n => n.kind === 'hold').length)
  })
  it('keeps old single-tap projects on their original chart', () => {
    const notes = [{ time: 2, lane: 3 }, { time: 2.5, lane: 1 }], game = classic(notes)
    expect(game.notes.map(n => ({ time: n.time, lane: n.lane }))).toEqual(notes)
    expect(game.notes.every(n => n.kind === 'tap')).toBe(true)
  })
  it.each([[-.16, 'good'], [-.045, 'perfect'], [0, 'perfect'], [.045, 'perfect'], [.046, 'good'], [.16, 'good']] as const)('grades timing error %s as %s', (error, grade) => {
    const game = classic(); game.press(0, 2 + error)
    expect(game.drainEvents().find(e => e.type === 'judge')?.grade).toBe(grade)
    expect(game.stats().hits).toBe(1)
  })
  it('misses once beyond the outer boundary and does not let repeated keydown score repeatedly', () => {
    const missed = classic(); missed.press(0, 2.161); missed.update(5); expect(missed.stats().misses).toBe(1)
    const game = classic(); game.press(0, 2); game.press(0, 2); game.press(0, 2.02)
    expect(game.stats().score).toBe(100); expect(game.stats().hits).toBe(1)
  })
  it('penalizes four-key mashing instead of awarding the same result as a correct hit', () => {
    const clean = classic(), mash = classic(); clean.press(0, 2)
    for (let lane = 0; lane < 4; lane++) mash.press(lane, 2)
    expect(mash.stats().ghosts).toBe(3); expect(mash.stats().score).toBeLessThan(clean.stats().score)
    expect(mash.stats().combo).toBe(0)
  })
  it('requires both chord heads and judges each lane independently', () => {
    const game = createRhythmEngine(settings, 10), first = game.notes.find(n => n.chord >= 0)!
    const group = game.notes.filter(n => n.chord === first.chord)
    game.press(group[0].lane, first.time); expect(game.drainEvents().some(e => e.type === 'chord')).toBe(false)
    game.press(group[1].lane, first.time + .03); expect(game.drainEvents().some(e => e.type === 'chord')).toBe(true); expect(game.stats().chordHits).toBe(1)
  })
  it('scores a hold head and tail once, but breaks an early release without later awarding its tail', () => {
    const game = createRhythmEngine(settings, 42), hold = game.notes.find(n => n.kind === 'hold')!
    game.press(hold.lane, hold.time); expect(hold.state).toBe('holding')
    game.update(hold.end); expect(hold.state).toBe('complete'); expect(game.stats().holdsCompleted).toBe(1)
    expect(game.drainEvents().filter(e => e.type === 'judge' && e.lane === hold.lane && e.kind === 'hold' && e.grade !== 'miss')).toHaveLength(2)
    const broken = createRhythmEngine(settings, 42), other = broken.notes.find(n => n.kind === 'hold')!
    broken.press(other.lane, other.time); broken.release(other.lane, other.time + .10); broken.drainEvents(); broken.update(other.end)
    expect(other.state).toBe('broken'); expect(broken.drainEvents().some(e => e.phase === 'tail' && e.grade !== 'miss')).toBe(false)
  })
  it('freezes active holds for pause and permits re-grabbing without scoring the head twice', () => {
    const game = createRhythmEngine(settings, 42), hold = game.notes.find(n => n.kind === 'hold')!
    game.press(hold.lane, hold.time); game.suspend(); game.resume(hold.time + .1)
    game.press(hold.lane, hold.time + .12); game.update(hold.end)
    const head = game.drainEvents().filter(e => e.phase === 'head' && e.lane === hold.lane && e.grade !== 'miss')
    expect(head).toHaveLength(1); expect(hold.state).toBe('complete')
  })
  it('breaks an unrecovered hold after resume grace and resets all feedback statistics for replay', () => {
    const game = createRhythmEngine(settings, 42), hold = game.notes.find(n => n.kind === 'hold')!
    game.press(hold.lane, hold.time); game.suspend(); game.resume(hold.time + .1); game.update(hold.time + .4)
    expect(hold.state).toBe('broken'); game.reset()
    expect(game.stats()).toMatchObject({ score: 0, combo: 0, maxCombo: 0, hits: 0, ghosts: 0, judged: 0 })
    expect(game.notes.every(n => n.state === 'pending')).toBe(true)
  })
  it('bounds hard charts and emits each combo milestone once', () => {
    const hard = createRhythmEngine({ ...settings, bars: 16, difficulty: 'hard' }, 42)
    expect(hard.notes.length).toBeLessThan(240)
    const game = classic(Array.from({ length: 12 }, (_, i) => ({ time: 2 + i * .5, lane: i % 4 })))
    for (const note of game.notes) { game.press(note.lane, note.time); game.release(note.lane, note.time + .01) }
    expect(game.drainEvents().filter(e => e.type === 'milestone').map(e => e.combo)).toEqual([10])
    expect(game.stats()).toMatchObject({ perfect: 12, good: 0, misses: 0, accuracy: 100, maxCombo: 12 })
  })
})
