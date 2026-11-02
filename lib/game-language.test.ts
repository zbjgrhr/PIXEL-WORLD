import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGameTranslator } from './game-language'
import { createFallbackGameSpec } from './game-spec'
import { exportGameZip, offlineGameRuntimeSource } from './export-game'
import { narrativeEngine } from './narrative-runtime'

afterEach(() => vi.unstubAllGlobals())

describe('per-work runtime language', () => {
  it('defaults legacy works to Chinese without depending on the editor locale', () => {
    expect(createGameTranslator(undefined)('Menu')).toBe('菜单')
    expect(createGameTranslator('zh-CN')('剧情记录')).toBe('剧情记录')
    expect(createGameTranslator('en')('剧情记录')).toBe('Story Log')
    expect(createGameTranslator('en')('Pip finds his mother.')).toBe('Pip finds his mother.')
  })

  it('localizes story headings and keeps player-written passages unchanged in both runtimes', () => {
    const spec = createFallbackGameSpec('A penguin seeks his mother.', 'Pip’s Journey', 1)
    spec.creationLanguage = 'en'
    const levelId = spec.levels[0].id
    const plan = spec.narrative!.chapters[0]
    plan.objectives = []
    plan.arrival = 'Pip reaches a quiet bamboo grove.'
    plan.departure = 'Pip follows the trail home.'
    spec.narrative!.ending = 'Pip and his mother return home together.'
    spec.narrative!.clues = [{ id: 'ribbon', setup: 'A blue ribbon lies beside the path.', payoff: 'The ribbon belongs to Pip’s mother.', levelId, payoffLevelId: levelId }]
    let state = narrativeEngine.begin(spec, narrativeEngine.fresh(spec), levelId)
    expect(state.history.find(entry => entry.id === 'clue:ribbon:setup')?.title).toBe('Clue Discovered')
    state = narrativeEngine.finish(spec, state)
    expect(state.history.at(-1)).toMatchObject({ title: 'Adventure Ending', text: spec.narrative!.ending })
    expect(state.history.some(entry => entry.title === 'Clue Explained')).toBe(true)
    const chineseSpec = { ...spec, creationLanguage: 'zh-CN' as const }
    expect(narrativeEngine.key(chineseSpec)).not.toBe(narrativeEngine.key(spec))
    expect(narrativeEngine.restore(chineseSpec, state).history).toEqual([])
  })

  it.each(['zh-CN', 'en'] as const)('exports %s HTML and preserves the work language in project.json', async creationLanguage => {
    const spec = createFallbackGameSpec('A penguin seeks his mother.', 'Pip’s Journey', 1)
    spec.creationLanguage = creationLanguage
    spec.assets = []
    let downloaded: Blob | undefined
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:language-test' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click: vi.fn() }) })
    vi.stubGlobal('window', { setTimeout: vi.fn() })
    await exportGameZip(spec)
    const zip = new Uint8Array(await downloaded!.arrayBuffer())
    const entries = new Map<string, string>()
    const decoder = new TextDecoder()
    for (let offset = 0; offset + 30 <= zip.length;) {
      const view = new DataView(zip.buffer, zip.byteOffset + offset)
      if (view.getUint32(0, true) !== 0x04034b50) break
      const size = view.getUint32(18, true), nameLength = view.getUint16(26, true), extraLength = view.getUint16(28, true)
      const start = offset + 30 + nameLength + extraLength
      entries.set(decoder.decode(zip.slice(offset + 30, offset + 30 + nameLength)), decoder.decode(zip.slice(start, start + size)))
      offset = start + size
    }
    const html = entries.get('index.html')!
    expect(html).toContain(`<html lang="${creationLanguage}">`)
    expect(html).toContain(creationLanguage === 'en' ? 'A/D Move · Space Jump' : 'A/D 移动 · 空格跳跃')
    expect(html).toContain(creationLanguage === 'en' ? 'Adventure Complete!' : '冒险完成！')
    expect(JSON.parse(entries.get('project.json')!).creationLanguage).toBe(creationLanguage)
    expect(entries.get('game.js')).toContain('createGameTranslator(spec.creationLanguage)')
  })

  it('boots the offline runtime with English story and control text, without making network calls', async () => {
    const spec = createFallbackGameSpec('A penguin seeks his mother.', 'Pip’s Journey', 1)
    spec.creationLanguage = 'en'
    spec.assets = []
    spec.narrative!.opening = 'Pip sets out to find his mother.'
    const created: Array<{ textContent: string; attrs: Record<string, string>; onclick?: () => void }> = []
    const node = () => {
      const element = { textContent: '', attrs: {} as Record<string, string>, style: {}, dataset: {}, classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() }, append: vi.fn(), replaceChildren: vi.fn(), setAttribute: (name: string, value: string) => { element.attrs[name] = value } }
      created.push(element)
      return element
    }
    const paint = new Proxy({}, { get: () => () => undefined, set: () => true })
    vi.stubGlobal('document', {
      getElementById: (id: string) => ({ textContent: JSON.stringify(id === 'project-data' ? spec : { levels: [{ obstacles: [], enemySpawns: [], collectibleSpawns: [] }] }) }),
      querySelector: (selector: string) => selector === 'canvas' ? { getContext: () => paint } : node(),
      querySelectorAll: () => [], createElement: () => node(), body: { append: vi.fn() }, addEventListener: vi.fn(),
    })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('setInterval', vi.fn())
    vi.stubGlobal('addEventListener', vi.fn())
    vi.stubGlobal('__pixelWorldReadOnlySnapshot', undefined)
    const fetch = vi.fn(() => { throw new Error('Offline') })
    vi.stubGlobal('fetch', fetch)
    new Function(offlineGameRuntimeSource())()
    await Promise.resolve()
    await Promise.resolve()
    expect(created.some(element => element.attrs['aria-label'] === 'Dismiss notice')).toBe(true)
    expect(created.some(element => element.textContent === 'Story Log')).toBe(true)
    created.find(element => element.textContent === 'Story Log')!.onclick!()
    expect(created.some(element => element.textContent === spec.narrative!.opening)).toBe(true)
    expect(created.some(element => element.attrs['aria-label'] === 'Current Objectives')).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
})
