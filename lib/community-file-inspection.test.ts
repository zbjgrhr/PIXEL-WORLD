import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectCommunityFile } from './community-file-inspection.server'
import { exportGameZip } from './export-game'
import { createFallbackGameSpec } from './game-spec'
import {buildBuiltinGameSpec} from './builtin-game'
import {readFile} from 'node:fs/promises'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('rejects private paths hidden by JSON escaping inside an otherwise valid GameSpec', async () => {
  const spec = createFallbackGameSpec('A penguin seeks its mother.', 'Privacy fixture', 1, 'en')
  spec.world = 'Evidence at C:\\Users\\private\\report.txt'
  await expect(inspectCommunityFile({ name: 'spec.json', mime: 'application/json', contents: Buffer.from(JSON.stringify(spec)) }, 'workshop')).rejects.toMatchObject({ code: 'PRIVATE_CONTENT' })
})
const image = async () => sharp({ create: { width: 32, height: 24, channels: 4, background: '#408a70' } }).png().toBuffer()
const file = (contents: Buffer, name = 'test.png', mime = 'image/png') => ({ name, mime, contents })
function wave() {
  const bytes = Buffer.alloc(44 + 1600)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(1600, 40)
  return bytes
}
async function gameZip(withAttribution=false,withBuiltin=false,svgOverride?:string,imageAsset?:Buffer,imageMime='image/png') {
  let spec = createFallbackGameSpec('A penguin seeks his mother.', 'Archive fixture', 3, 'en')
  if(withBuiltin){
    spec=buildBuiltinGameSpec(spec)
    vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
      if(!/^\/builtin\/[a-z-]+\.svg$/.test(input))throw new Error('Unexpected asset')
      return new Response(new Uint8Array(svgOverride?Buffer.from(svgOverride):await readFile(new URL(`../public${input}`,import.meta.url))),{headers:{'Content-Type':'image/svg+xml'}})
    }))
  }else spec.assets = spec.assets.map(asset => ({ ...asset, enabled: false, url: '' }))
  if(imageAsset)spec.assets[0]={...spec.assets[0],kind:'image',animation:undefined,enabled:true,status:'success',url:`data:${imageMime};base64,${imageAsset.toString('base64')}`}
  if(withAttribution)spec.templateSources=[{postId:'11111111-1111-4111-8111-111111111111',revision:'2026-10-31T00:00:00Z',authorId:'22222222-2222-4222-8222-222222222222',authorName:'Template fixture author',license:'remix-with-credit'}]
  let captured: Blob | undefined
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob as Blob; return 'blob:test-only' })
  vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) })
  vi.stubGlobal('window', { setTimeout: vi.fn() })
  await exportGameZip(spec)
  return Buffer.from(await captured!.arrayBuffer())
}
function replaceEntry(bytes: Buffer, oldName: string, name: string) {
  const copy = Buffer.from(bytes)
  let offset = copy.readUInt32LE(copy.length - 22 + 16)
  while (copy.readUInt32LE(offset) === 0x02014b50) {
    const length = copy.readUInt16LE(offset + 28)
    if (copy.toString('utf8', offset + 46, offset + 46 + length) === oldName) {
      if (Buffer.byteLength(name) !== length) throw new Error('Fixture names must have equal byte length')
      const local = copy.readUInt32LE(offset + 42)
      copy.write(name, offset + 46); copy.write(name, local + 30)
      return copy
    }
    offset += 46 + length + copy.readUInt16LE(offset + 30) + copy.readUInt16LE(offset + 32)
  }
  throw new Error('Fixture entry not found')
}

describe('actual community file content inspection', () => {
  it('accepts a real current export containing the optional attribution file',async()=>{
    const bytes=await gameZip(true)
    const result=await inspectCommunityFile(file(bytes,'attributed-game.zip','application/zip'),'workshop')
    expect(result).toMatchObject({kind:'game-zip',archiveEntries:5,levelCount:3,workLanguage:'en'})
    await expect(inspectCommunityFile(file(replaceEntry(bytes,'ATTRIBUTION.txt','UNEXPECTEDX.txt'),'unknown-root.zip','application/zip'),'workshop')).rejects.toThrow()
  })
  it('accepts a real built-in-art export with attribution without allowing arbitrary SVG uploads',async()=>{
    const bytes=await gameZip(true,true)
    const result=await inspectCommunityFile(file(bytes,'builtin-game.zip','application/zip'),'workshop')
    expect(result).toMatchObject({kind:'game-zip',levelCount:3,workLanguage:'en'})
    expect(result.archiveEntries).toBeGreaterThan(5)
    await expect(inspectCommunityFile(file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'image.svg','image/svg+xml'),'art')).rejects.toThrow()
  })
  it('rejects unregistered SVGs and SVG content disguised as PNG, while accepting actual PNG and legacy builtin bytes',async()=>{
    const foreign='<svg xmlns="http://www.w3.org/2000/svg"><script>throw new Error("never run")</script></svg>'
    const svgZip=await gameZip(false,true,foreign)
    await expect(inspectCommunityFile(file(svgZip,'unregistered-svg.zip','application/zip'),'workshop')).rejects.toThrow()
    const disguised=await gameZip(false,false,undefined,Buffer.from(foreign))
    await expect(inspectCommunityFile(file(disguised,'disguised-svg.zip','application/zip'),'workshop')).rejects.toThrow()
    for(const bytes of [await image(),await readFile(new URL('../public/builtin/hero.svg',import.meta.url))]){
      const zip=await gameZip(false,false,undefined,bytes)
      expect(await inspectCommunityFile(file(zip,'supported-image.zip','application/zip'),'workshop')).toMatchObject({kind:'game-zip',archiveEntries:5})
    }
    const vector=await readFile(new URL('../public/builtin/hero.svg',import.meta.url))
    const namedSvg=await gameZip(false,false,undefined,vector,'image/svg+xml')
    expect(namedSvg.includes(Buffer.from('assets/hero-1.svg'))).toBe(true)
    expect(await inspectCommunityFile(file(namedSvg,'proper-svg-name.zip','application/zip'),'workshop')).toMatchObject({kind:'game-zip'})
  })
  it('decodes an image and hashes its actual bytes', async () => {
    const png = await image(), result = await inspectCommunityFile(file(png), 'art')
    expect(result).toMatchObject({ kind: 'image', width: 32, height: 24, frames: 1, bytes: png.length, durationSeconds: null })
    expect(result.sha256).toBe(createHash('sha256').update(png).digest('hex'))
  })
  it('rejects renamed image formats, corrupt content and unsafe local names', async () => {
    await expect(inspectCommunityFile(file(await image(), 'renamed.jpg', 'image/jpeg'), 'art')).rejects.toMatchObject({ code: 'TYPE_MISMATCH' })
    await expect(inspectCommunityFile(file(Buffer.from('<script>not an image</script>')), 'art')).rejects.toThrow()
    await expect(inspectCommunityFile(file(await image(), 'C:\\Users\\private.png'), 'art')).rejects.toThrow()
    await expect(inspectCommunityFile(file((await image()).subarray(0, 40)), 'art')).rejects.toThrow()
  })
  it('parses real PCM audio duration and rejects a truncated RIFF container', async () => {
    const audio = wave()
    expect(await inspectCommunityFile(file(audio, 'effect.wav', 'audio/wav'), 'art')).toMatchObject({ kind: 'audio', durationSeconds: 0.1 })
    await expect(inspectCommunityFile(file(audio.subarray(0, 50), 'bad.wav', 'audio/wav'), 'art')).rejects.toThrow()
  })
  it('does not accept text masquerading as supported audio/video', async () => {
    for (const [name, mime] of [['video.mp4','video/mp4'],['video.webm','video/webm'],['sound.mp3','audio/mpeg'],['sound.ogg','audio/ogg']]) await expect(inspectCommunityFile(file(Buffer.from('not media'), name, mime), 'art')).rejects.toThrow()
  })
  it('checks GameSpec structure and language without rewriting player text', async () => {
    const spec = createFallbackGameSpec('A penguin seeks his mother.', 'Pip', 3, 'en')
    const raw = Buffer.from(JSON.stringify(spec))
    expect(await inspectCommunityFile(file(raw, 'GameSpec.json', 'application/json'), 'workshop')).toMatchObject({ kind: 'game-spec', workLanguage: 'en', levelCount: 3 })
    await expect(inspectCommunityFile(file(Buffer.from('{}'), 'GameSpec.json', 'application/json'), 'workshop')).rejects.toThrow()
  })
  it('blocks credentials and local paths in public reports without echoing them', async () => {
    for (const content of ['"api_key":"' + 'example'.repeat(8) + '"', 'Evidence at C:/Users/private/game.png', 'file:///private/data']) {
      const result = inspectCommunityFile(file(Buffer.from(content), 'report.md', 'text/markdown'), 'workshop')
      await expect(result).rejects.toMatchObject({ code: 'PRIVATE_CONTENT' })
      await expect(result).rejects.not.toThrow(/example|C:\/Users/)
    }
    expect(await inspectCommunityFile(file(Buffer.from('The run stopped before export. No success is claimed.'), 'report.md', 'text/markdown'), 'workshop')).toMatchObject({ kind: 'report' })
    expect(await inspectCommunityFile(file(Buffer.from('The run stopped before export.'), 'record.txt', 'text/plain'), 'workshop')).toMatchObject({ kind: 'report' })
    await expect(inspectCommunityFile(file(Buffer.from([0xff,0xfe,0xff]), 'record.log', 'text/plain'), 'workshop')).rejects.toThrow()
  })
  it('reads a real exported game archive without running its JavaScript', async () => {
    const zip = await gameZip()
    const result = await inspectCommunityFile(file(zip, 'game.zip', 'application/zip'), 'workshop')
    expect(result).toMatchObject({ kind: 'game-zip', workLanguage: 'en', levelCount: 3, archiveEntries: 4 })
    await expect(inspectCommunityFile(file(zip, 'game.zip', 'application/zip'), 'art')).rejects.toThrow()
  })
  it('rejects zip traversal, executables, duplicate paths and corrupt entry bytes', async () => {
    const zip = await gameZip()
    for (const altered of [replaceEntry(zip, 'game.js', '../x.js'), replaceEntry(zip, 'styles.css', 'plugin.exe'), replaceEntry(zip, 'styles.css', 'index.html')]) await expect(inspectCommunityFile(file(altered, 'bad.zip', 'application/zip'), 'workshop')).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    const corrupt = Buffer.from(zip)
    const dataOffset = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28)
    corrupt[dataOffset + 1] ^= 1
    await expect(inspectCommunityFile(file(corrupt, 'bad.zip', 'application/zip'), 'workshop')).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
  })
})
