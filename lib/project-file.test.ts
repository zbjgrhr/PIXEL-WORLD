import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSpatialZip, readProjectFile, spatialWorldProject } from './project-file'
import { createSpatialProject } from './spatial/spec'
import { duplicateProject, importProject, serializeProject } from './project-library'
import { readStoredGameArchive } from './community-play-archive'

const runtime = readFileSync(new URL('../public/spatial/runtime.js', import.meta.url), 'utf8')
describe('shared project files for multiple genres', () => {
  it.each(['rhythm', 'exploration'] as const)('roundtrips a playable %s ZIP without executing archive scripts', async mode => {
    const spec = { ...createSpatialProject('星夜森林', mode), title: '我的作品', rhythm: { bpm: 130, bars: 4, offsetMs: 25 } }
    const blob = buildSpatialZip(spec, runtime), buffer = await blob.arrayBuffer()
    const files = readStoredGameArchive(buffer, true)
    expect(files.map(f => f.name)).toEqual(['index.html', 'project.json'])
    const project = await readProjectFile({ name: '我的作品.zip', size: blob.size, arrayBuffer: async () => buffer, text: async () => '' })
    expect(project.mode).toBe(mode); expect(project.spatial).toEqual(spec)
    expect(new TextDecoder().decode(files[0].bytes)).toContain('PIXEL_WORLD_SPATIAL_RUNTIME_V1')
    // Community's 2D archive default remains strict; a spatial file is not a verified 2D game.
    expect(() => readStoredGameArchive(buffer)).toThrow()
  })
  it('retains spatial rules through duplicate and portable library import', () => {
    const p = spatialWorldProject(createSpatialProject('雪地', 'rhythm')), copy = duplicateProject(p)
    copy.spatial!.rhythm.bpm = 150
    expect(p.spatial!.rhythm.bpm).toBe(100)
    const imported = importProject(serializeProject(copy))
    expect(imported.spatial?.rhythm.bpm).toBe(150); expect(imported.id).not.toBe(copy.id)
  })
  it('imports the earlier prototype JSON through the same project-library entry', async () => {
    const spec = createSpatialProject('森林', 'exploration'), text = JSON.stringify(spec)
    const p = await readProjectFile({ name: 'old.json', size: text.length, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) })
    expect(p.mode).toBe('exploration'); expect(p.spatial).toEqual(spec)
  })
  it('rejects mismatched genres and corrupt ZIP bytes before editor use', async () => {
    const p = spatialWorldProject(createSpatialProject('星夜', 'rhythm')); p.mode = 'platformer'
    expect(() => importProject(serializeProject(p))).toThrow('不一致')
    const blob = buildSpatialZip(createSpatialProject('森林'), runtime), bytes = new Uint8Array(await blob.arrayBuffer()); bytes[60] ^= 1
    await expect(readProjectFile({ name: 'changed.zip', size: bytes.length, text: async () => '', arrayBuffer: async () => bytes.buffer })).rejects.toThrow()
  })
})
