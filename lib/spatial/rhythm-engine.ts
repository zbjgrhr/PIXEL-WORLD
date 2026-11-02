/** Self-contained: the same factory is embedded in standalone exports. No renderer or wall-clock dependencies. */
export function createRhythmEngine(config: { bpm: number; bars: number; chartVersion?: 1 | 2; difficulty?: 'relaxed' | 'normal' | 'hard' }, seed: number, legacyNotes?: Array<{ time: number; lane: number }>) {
  if (!Number.isFinite(config.bpm) || config.bpm < 60 || config.bpm > 160 || !Number.isInteger(config.bars) || config.bars < 4 || config.bars > 16) throw Error('Invalid rhythm settings')
  type Grade = 'perfect' | 'good' | 'miss'
  type Note = { id: number; lane: number; time: number; end: number; kind: 'tap' | 'hold'; chord: number; state: 'pending' | 'holding' | 'complete' | 'miss' | 'broken'; headJudged: boolean; regrab: boolean; grace: number }
  type Event = { type: 'judge' | 'ghost' | 'chord' | 'milestone' | 'resume'; lane: number; time: number; grade?: Grade; phase?: 'head' | 'tail'; errorMs?: number; kind?: 'tap' | 'hold'; combo: number }
  let randomState = seed | 0
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296 }
  const beat = 60 / config.bpm, notes: Note[] = [], occupied = [0, 0, 0, 0]
  const add = (lane: number, at: number, length = 0, chord = -1) => {
    const time = 2 + at * beat
    if (time < occupied[lane] - 1e-8) return
    occupied[lane] = time + length * beat + .20
    notes.push({ id: notes.length, lane, time, end: time + length * beat, kind: length ? 'hold' : 'tap', chord, state: 'pending', headJudged: false, regrab: false, grace: 0 })
  }
  if (config.chartVersion !== 2) {
    const legacy = legacyNotes || Array.from({ length: config.bars * 4 }, (_, i) => ({ time: 2 + i * beat, lane: Math.floor(random() * 4) }))
    for (const n of legacy) notes.push({ id: notes.length, lane: n.lane, time: n.time, end: n.time, kind: 'tap', chord: -1, state: 'pending', headJudged: false, regrab: false, grace: 0 })
  } else {
    const difficulty = config.difficulty || 'normal', pattern = [0, 2, 1, 3, 0, 3, 1, 2]
    const shift = Math.floor(random() * 4)
    for (let bar = 0; bar < config.bars; bar++) for (let count = 0; count < 4; count++) {
      const at = bar * 4 + count, lane = (pattern[(at + shift) % 8] + (bar % 4 === 3 ? 1 : 0)) % 4
      const hold = count === 2 && (difficulty !== 'relaxed' || bar % 2 === 0)
      const chord = bar > 0 && count === 0 && (difficulty !== 'relaxed' || bar % 2 === 0)
      add(lane, at, hold ? 1.25 : 0, chord ? bar : -1)
      if (chord) add((lane + 2) % 4, at, 0, bar)
      if (bar > 0 && (difficulty === 'hard' || difficulty === 'normal' && bar % 2 === 1) && (count === 1 || count === 3)) add((lane + 1) % 4, at + .5)
    }
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane)
  const total = notes.reduce((n, note) => n + (note.kind === 'hold' ? 2 : 1), 0)
  const endTime = Math.max(...notes.map(n => n.end)) + 1
  const down = new Set<number>(), events: Event[] = [], ghostAt = [-99, -99, -99, -99], completedChords = new Set<number>()
  let score = 0, combo = 0, maxCombo = 0, hits = 0, perfect = 0, good = 0, misses = 0, ghosts = 0, energy = 0, weighted = 0, judged = 0, lastTime = -99
  let holdsCompleted = 0, holdsBroken = 0, chordHits = 0
  const emit = (e: Event) => { if (events.length < 256) events.push(e) }
  const judge = (note: Note, time: number, grade: Grade, phase: 'head' | 'tail', errorMs = 0, units = 1) => {
    judged += units
    if (note.kind === 'hold' && (phase === 'tail' || grade === 'miss')) { if (grade === 'miss') holdsBroken++; else holdsCompleted++ }
    if (grade === 'miss') { misses += units; combo = 0; energy = Math.max(0, energy - 14) }
    else {
      hits++; combo++; maxCombo = Math.max(maxCombo, combo); weighted += grade === 'perfect' ? 1 : .65
      if (grade === 'perfect') perfect++; else good++
      score += Math.round((grade === 'perfect' ? 100 : 65) * (1 + Math.min(5, Math.floor(combo / 10)) * .05))
      energy = Math.min(100, energy + (grade === 'perfect' ? 8 : 4))
    }
    emit({ type: 'judge', lane: note.lane, time, grade, phase, kind: note.kind, errorMs, combo })
    if (grade !== 'miss' && combo % 10 === 0) emit({ type: 'milestone', lane: note.lane, time, combo })
    if (phase === 'head' && grade !== 'miss' && note.chord >= 0 && !completedChords.has(note.chord)) {
      const group = notes.filter(n => n.chord === note.chord)
      if (group.length > 1 && group.every(n => n.headJudged && n.state !== 'miss')) { completedChords.add(note.chord); chordHits++; emit({ type: 'chord', lane: note.lane, time, combo }) }
    }
  }
  const gradeAt = (error: number): Grade => Math.abs(error) <= .045 + 1e-8 ? 'perfect' : 'good'
  function update(time: number) {
    if (!Number.isFinite(time)) return
    lastTime = Math.max(lastTime, time)
    for (const note of notes) {
      if (note.state === 'pending' && time - note.time > .16 + 1e-8) { note.state = 'miss'; note.headJudged = true; judge(note, time, 'miss', 'head', (time - note.time) * 1000, note.kind === 'hold' ? 2 : 1) }
      if (note.state !== 'holding') continue
      if (down.has(note.lane) && time >= note.end - 1e-8) { note.state = 'complete'; note.regrab = false; judge(note, time, 'perfect', 'tail') }
      else if (note.regrab && time > note.grace + 1e-8) { note.state = 'broken'; note.regrab = false; judge(note, time, 'miss', 'tail') }
    }
  }
  function press(lane: number, time: number) {
    if (!Number.isInteger(lane) || lane < 0 || lane > 3 || !Number.isFinite(time) || down.has(lane)) return
    update(time); down.add(lane)
    const sustain = notes.find(n => n.lane === lane && n.state === 'holding' && n.regrab)
    if (sustain) { sustain.regrab = false; emit({ type: 'resume', lane, time, combo }); update(time); return }
    const candidates = notes.filter(n => n.lane === lane && n.state === 'pending' && Math.abs(n.time - time) <= .16 + 1e-8).sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))
    const note = candidates[0]
    if (!note) {
      if (notes.some(n => n.lane === lane && n.state === 'miss' && time - n.time >= 0 && time - n.time <= .28)) return
      if (time > 1.5 && time < endTime && time - ghostAt[lane] >= .09) { ghostAt[lane] = time; ghosts++; combo = 0; energy = Math.max(0, energy - 3); score = Math.max(0, score - 15); emit({ type: 'ghost', lane, time, combo }) }
      return
    }
    note.headJudged = true; note.state = note.kind === 'hold' ? 'holding' : 'complete'
    judge(note, time, gradeAt(time - note.time), 'head', (time - note.time) * 1000)
  }
  function release(lane: number, time: number) {
    if (!Number.isFinite(time)) return
    update(time); down.delete(lane)
    for (const note of notes) if (note.lane === lane && note.state === 'holding' && !note.regrab) {
      if (time >= note.end - .09 - 1e-8) { note.state = 'complete'; judge(note, time, gradeAt(time - note.end), 'tail', (time - note.end) * 1000) }
      else { note.state = 'broken'; judge(note, time, 'miss', 'tail', (time - note.end) * 1000) }
    }
  }
  const stats = () => ({ score, combo, maxCombo, hits, perfect, good, misses, ghosts, energy, total, judged, holdsCompleted, holdsBroken, chordHits,
    accuracy: judged ? Math.max(0, (weighted / judged - ghosts * .002) * 100) : 100,
    endTime, time: lastTime })
  const snapshot = () => ({ ...stats(), down: [...down], notes: notes.map(n => ({ ...n })) })
  return { notes, total, endTime, update, press, release, snapshot, stats, isDown: (lane: number) => down.has(lane),
    drainEvents: () => events.splice(0),
    suspend: () => { down.clear(); for (const n of notes) if (n.state === 'holding') { n.regrab = true; n.grace = Infinity } },
    resume: (time: number) => { for (const n of notes) if (n.state === 'holding' && n.regrab) n.grace = time + .22 },
    reset: () => { score = combo = maxCombo = hits = perfect = good = misses = ghosts = energy = weighted = judged = holdsCompleted = holdsBroken = chordHits = 0; lastTime = -99; down.clear(); events.length = 0; completedChords.clear(); ghostAt.fill(-99); for (const n of notes) { n.state = 'pending'; n.headJudged = n.regrab = false; n.grace = 0 } },
  }
}
