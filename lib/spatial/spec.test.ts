import { describe, expect, it } from 'vitest'
import { createSpatialProject, parseSpatialProject, serializeSpatialProject } from './spec'

describe('Spatial V1 projects', () => {
  it('compiles deterministic, bounded templates and preserves the user brief', () => {
    const brief = '雪原里的水晶探险'
    const p = createSpatialProject(brief)
    expect(p).toEqual(createSpatialProject(brief))
    expect(p.environment).toBe('snow')
    expect(p.brief).toBe(brief)
    expect(parseSpatialProject(JSON.parse(serializeSpatialProject(p)))).toEqual(p)
    expect(createSpatialProject(brief, 'rhythm').genre).toBe('rhythm')
  })

  it('rejects incompatible 2D projects rather than corrupting their data', () => {
    expect(() => parseSpatialProject({ version: 3, title: '2D', levels: [] })).toThrow('2D')
  })

  it.each([
    ['arenaSize', 1000000], ['goalCount', 0], ['decorationCount', 5000],
    ['playerSpeed', Infinity], ['seed', 0], ['environment', '__proto__'], ['genre', 'arbitrary-code'],
  ])('rejects an unsupported %s value', (field, value) => {
    expect(() => parseSpatialProject({ ...createSpatialProject('森林'), [field]: value })).toThrow()
  })

  it('limits rhythm timing and drops unsupported script and URL fields', () => {
    const p = createSpatialProject('星夜音游', 'rhythm')
    expect(() => parseSpatialProject({ ...p, rhythm: { ...p.rhythm, bpm: 0 } })).toThrow('BPM')
    expect(() => parseSpatialProject({ ...p, rhythm: null })).toThrow()
    expect(parseSpatialProject({ ...p, script: 'fetch(secret)', apiKey: 'SECRET', modelUrl: 'https://example.com/a.glb' })).toEqual(p)
  })
  it('keeps older three-field rhythm settings unchanged and defaults new works to mixed notes', () => {
    const p = createSpatialProject('星夜', 'rhythm')
    expect(p.rhythm.chartVersion).toBe(2); expect(p.rhythm.feedback?.shake).toBe(false)
    const legacy = { bpm: 100, bars: 4, offsetMs: 0 }
    expect(parseSpatialProject({ ...p, rhythm: legacy }).rhythm).toEqual(legacy)
  })
  it.each(['effects', 'hitVolume', 'musicVolume'])('rejects invalid %s rather than exporting unsafe intensity', key => {
    const p = createSpatialProject('星夜', 'rhythm')
    expect(() => parseSpatialProject({ ...p, rhythm: { ...p.rhythm, feedback: { ...p.rhythm.feedback, [key]: 2 } } })).toThrow()
  })
  it('rejects unsupported chart and difficulty values', () => {
    const p = createSpatialProject('星夜', 'rhythm')
    expect(() => parseSpatialProject({ ...p, rhythm: { ...p.rhythm, chartVersion: 9 } })).toThrow()
    expect(() => parseSpatialProject({ ...p, rhythm: { ...p.rhythm, difficulty: 'anything' } })).toThrow()
  })
})
