import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/optimize-prompt/route'
import { buildBuiltinGameSpec } from './builtin-game'
import { exportGameZip } from './export-game'
import { narrativeEngine } from './narrative-runtime'
import type { GameSpec } from '@/types'

afterEach(() => vi.unstubAllGlobals())

function unzipStored(bytes: Uint8Array) {
  const files = new Map<string, Uint8Array>()
  for (let offset = 0; offset + 30 <= bytes.length;) {
    const header = new DataView(bytes.buffer, bytes.byteOffset + offset)
    if (header.getUint32(0, true) !== 0x04034b50) break
    const size = header.getUint32(18, true), nameSize = header.getUint16(26, true), extra = header.getUint16(28, true)
    const start = offset + 30 + nameSize + extra
    files.set(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameSize)), bytes.slice(start, start + size))
    offset = start + size
  }
  return files
}

describe('creation language from completion API through playable export', () => {
  it.each(['zh-CN', 'en'] as const)('creates and exports a complete %s rule-based work with bundled assets', async creationLanguage => {
    const english = creationLanguage === 'en'
    const request = new Request('http://localhost/api/optimize-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creationLanguage, theme: english ? 'Penguin Homeward' : '小企鹅找妈妈', story: english ? 'A little penguin travels through Japan to defeat monsters and a panda boss and find its mother.' : '小企鹅在日本世界打败怪物和熊猫boss，最后找到自己的妈妈。', levelCount: 3 }) })
    const network = vi.fn()
    vi.stubGlobal('fetch', network)
    const result = await (await POST(request as never)).json()
    expect(network).not.toHaveBeenCalled()
    expect(result.data.source).toBe('local')
    const spec = buildBuiltinGameSpec(result.data.spec as GameSpec)
    expect(spec.creationLanguage).toBe(creationLanguage)
    expect(spec.narrative!.ending).toContain(english ? 'mother' : '妈妈')
    expect(spec.levels).toHaveLength(3)
    expect(spec.assets.filter(asset => asset.enabled && asset.kind === 'image').every(asset => asset.url?.startsWith('/builtin/'))).toBe(true)

    const state = narrativeEngine.begin(spec, narrativeEngine.fresh(spec), spec.levels[0].id)
    expect(state.history.some(entry => entry.text === spec.narrative!.opening)).toBe(true)
    let download: Blob | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toMatch(/^\/builtin\/[a-z-]+\.svg$/)
      const bytes = await readFile(path.join(process.cwd(), 'public', url))
      return new Response(bytes.toString('utf8'), { status: 200, headers: { 'content-type': 'image/svg+xml' } })
    }))
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { download = blob; return 'blob:language-flow' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click: vi.fn() }) })
    vi.stubGlobal('window', { setTimeout: vi.fn() })
    await exportGameZip(spec)
    const bytes = new Uint8Array(await download!.arrayBuffer())
    const files = unzipStored(bytes)
    const exported: GameSpec = JSON.parse(new TextDecoder().decode(files.get('project.json')))
    expect(exported.creationLanguage).toBe(creationLanguage)
    expect(exported.narrative!.ending).toBe(spec.narrative!.ending)
    expect(exported.assets.filter(asset => asset.url).every(asset => files.has(asset.url!))).toBe(true)
    expect(new TextDecoder().decode(files.get('index.html'))).toContain(`<html lang="${creationLanguage}">`)
    if (process.env.PIXEL_WORLD_LANGUAGE_EVIDENCE_DIR) {
      const directory = path.join(process.env.PIXEL_WORLD_LANGUAGE_EVIDENCE_DIR, creationLanguage)
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'game.zip'), bytes)
      await writeFile(path.join(directory, 'GameSpec.json'), JSON.stringify(spec, null, 2))
      for (const [name, content] of files) {
        const filename = path.join(directory, 'offline', name)
        await mkdir(path.dirname(filename), { recursive: true })
        await writeFile(filename, content)
      }
    }
  })
})
