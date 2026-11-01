import * as yauzl from 'yauzl'
import {createHash} from 'node:crypto'
import builtinSvgRegistry from '@/configs/builtin-svg-registry.json'
import {inspectCommunityRaster} from './community-raster.server'
import { checkedPublicText, checkSpecText, CommunityFileError } from './community-file-rules.server'

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
const builtinSvgHashes=new Set(builtinSvgRegistry.files.map(file=>file.sha256))
function rasterHeaderMatches(name:string,bytes:Buffer){
  if(/\.png$/i.test(name))return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if(/\.jpe?g$/i.test(name))return bytes[0]===255 && bytes[1]===216 && bytes[2]===255
  if(/\.gif$/i.test(name))return ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))
  return bytes.subarray(0,4).toString('ascii')==='RIFF' && bytes.subarray(8,12).toString('ascii')==='WEBP'
}

/** Inspect a Pixel World archive in memory; never extract or execute its scripts. */
export async function inspectCommunityArchive(bytes: Buffer) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(new CommunityFileError('INVALID_ARCHIVE')) : resolve(value)))
  return new Promise<{ entries: number; expandedBytes: number; language: 'zh-CN' | 'en'; levelCount: number }>((resolve, reject) => {
    let settled = false, count = 0, total = 0
    let spec: ReturnType<typeof checkSpecText> | undefined
    const names = new Set<string>()
    let active: NodeJS.ReadableStream | undefined
    const fail = () => { if (settled) return; settled = true; (active as { destroy?: () => void } | undefined)?.destroy?.(); zip.close(); reject(new CommunityFileError('INVALID_ARCHIVE')) }
    const timer = setTimeout(fail, 15000)
    const finishFailure = () => { clearTimeout(timer); fail() }
    zip.on('error', finishFailure)
    zip.on('end', () => {
      if (settled) return
      clearTimeout(timer)
      if (!['index.html','styles.css','game.js','project.json'].every(name => names.has(name)) || !spec) { fail(); return }
      settled = true; resolve({ entries: count, expandedBytes: total, ...spec })
    })
    zip.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        const name = entry.fileName, lower = name.toLowerCase()
        const mode = entry.externalFileAttributes >>> 16 & 0o170000
        if (++count > 512 || names.has(lower) || !/^[a-z\d_./-]+$/i.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..')
          || entry.generalPurposeBitFlag & 1 || mode === 0o120000 || ![0, 0o100000, 0o040000].includes(mode)) throw new CommunityFileError('INVALID_ARCHIVE')
        names.add(lower)
        if (name.endsWith('/')) {
          if (!/^assets\/(?:[a-z\d_-]+\/)*$/i.test(name) || entry.uncompressedSize) throw new CommunityFileError('INVALID_ARCHIVE')
          zip.readEntry(); return
        }
        const rootText = ['index.html','styles.css','game.js','project.json','ATTRIBUTION.txt'].includes(name)
        const svg=/^assets\/(?:[a-z\d_-]+\/)*[a-z\d_-]+\.svg$/i.test(name)
        const raster=/\.(png|jpe?g|gif|webp)$/i.test(name)
        if (!rootText && !/^assets\/(?:[a-z\d_-]+\/)*[a-z\d_-]+\.(png|jpe?g|webp|gif|mp3|wav|ogg|mp4|webm|svg)$/i.test(name)) throw new CommunityFileError('INVALID_ARCHIVE')
        if(svg && entry.uncompressedSize>1_000_000)throw new CommunityFileError('LIMIT_EXCEEDED')
        total += entry.uncompressedSize
        if (total > 150_000_000 || entry.uncompressedSize > 45_000_000) throw new CommunityFileError('LIMIT_EXCEEDED')
        const stream = await new Promise<import('node:stream').Readable>((ok, bad) => zip.openReadStream(entry, (error, value) => error ? bad(error) : ok(value)))
        active = stream
        const chunks: Buffer[] = []
        let header=Buffer.alloc(0)
        let actual = 0, crc = 0xffffffff
        for await (const raw of stream) {
          const chunk = Buffer.from(raw)
          actual += chunk.length
          if (actual > entry.uncompressedSize) throw new CommunityFileError('INVALID_ARCHIVE')
          for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
          if(raster && header.length<12)header=Buffer.concat([header,chunk.subarray(0,12-header.length)])
          if (rootText || svg || raster) chunks.push(chunk)
        }
        active = undefined
        if (actual !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) throw new CommunityFileError('INVALID_ARCHIVE')
        if (rootText) {
          const text = checkedPublicText(Buffer.concat(chunks))
          if (name === 'project.json') spec = checkSpecText(text)
        }
        if(svg && !builtinSvgHashes.has(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')))throw new CommunityFileError('INVALID_ARCHIVE')
        // Also catch SVG disguised as a raster filename. Older exports may have
        // named a bundled SVG .png; allow only the same reviewed builtin bytes.
        if(raster && !rasterHeaderMatches(name,header) && (entry.uncompressedSize>1_000_000 || !builtinSvgHashes.has(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'))))throw new CommunityFileError('INVALID_ARCHIVE')
        if(raster && rasterHeaderMatches(name,header))await inspectCommunityRaster(Buffer.concat(chunks),name.split('.').pop()!.toLowerCase())
        if (!settled) zip.readEntry()
      })().catch(finishFailure)
    })
    zip.readEntry()
  })
}
