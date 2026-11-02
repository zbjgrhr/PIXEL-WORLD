import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { collectReference } = createRequire(import.meta.url)('../scripts/import-gamemaker-reference.cjs')
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root)
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('pixel-ref-')) throw Error('Unsafe test cleanup')
    rmSync(resolved, { recursive: true, force: true })
  }
})

describe('GameMaker reference metadata import', () => {
  it('preserves room coordinates, tile compression and frame order without running code or copying private files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pixel-ref-')); roots.push(root)
    const put = (name: string, content: string) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), content) }
    put('objects/obj_charReg/obj_charReg.yy', '{"spriteId":{"name":"spr_hero"},}')
    put('objects/obj_charReg/Create_0.gml', 'walkspeed = 5;\ngravity_from_call = malicious_call();\ngr v = 1;\ngrv = 0.4;\napi_key = "DO_NOT_COPY_CREDENTIAL";\nthrow new Error("must not execute");')
    put('sprites/spr_hero/spr_hero.yy', JSON.stringify({ width: 32, height: 64, bbox_left: 3, bbox_right: 28, frames: [{ name: 'frame-b' }, { name: 'frame-a' }], sequence: { playbackSpeed: 12, xorigin: 16, yorigin: 64 } }))
    put('rooms/tutorial/tutorial.yy', JSON.stringify({ roomSettings: { Width: 1080, Height: 720 }, layers: [{ name: 'group', layers: [{ name: 'actors', instances: [{ name: 'spawn', objectId: { name: 'obj_charReg' }, x: 127, y: 240, scaleX: 2, scaleY: 1, hasCreationCode: true }] }, { name: 'collision', tiles: { SerialiseWidth: 2, SerialiseHeight: 1, TileCompressedData: [-2, 0] } }] }] }))
    put('.env.local', 'DO_NOT_COPY_CREDENTIAL')
    const result = collectReference(root)
    expect(result.objects[0].parameters.walkspeed).toEqual({ value: 5, line: 1 })
    expect(result.objects[0].parameters.grv.value).toBe(0.4)
    expect(result.rooms[0].instances[0]).toMatchObject({ x: 127, y: 240, scaleX: 2, creationCode: true })
    expect(result.rooms[0].tileLayers[0].data.TileCompressedData).toEqual([-2, 0])
    expect(result.sprites[0].frameIds).toEqual(['frame-b', 'frame-a'])
    expect(result.engineImportReady).toBe(false)
    expect(JSON.stringify(result)).not.toContain('DO_NOT_COPY_CREDENTIAL')
    expect(result.evidence).toHaveLength(4)
    expect(result.evidence.every((file: { sha256: string }) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
  })
  it('fails explicitly on invalid room metadata instead of producing an empty successful map', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pixel-ref-')); roots.push(root)
    mkdirSync(path.join(root, 'rooms/broken'), { recursive: true })
    writeFileSync(path.join(root, 'rooms/broken/broken.yy'), '{ "roomSettings": ')
    expect(() => collectReference(root)).toThrow('Invalid resource metadata')
  })
})
