import { describe, expect, it, vi, afterEach } from 'vitest'
import { createProject, duplicateProject, importProject, portableProject, projectFileName, serializeProject } from './project-library'
import { createFallbackGameSpec } from './game-spec'
import { buildBuiltinGameSpec } from './builtin-game'

afterEach(() => vi.unstubAllGlobals())
describe('portable project library', () => {
  it('starts a two-level platformer independently from non-playable genre planning', () => {
    const a = createProject('platformer', '两个世界'), b = createProject('rhythm', '节拍')
    expect(a.id).not.toBe(b.id); expect(a.draft.levelCount).toBe(2)
    expect(b.publishedSpec).toBeUndefined(); expect(b.planning.bpm).toBe(120)
  })
  it('duplicates full maps and images without sharing editable references or legacy migration identity', () => {
    const p = createProject('platformer', '原作'); p.draft.spec = createFallbackGameSpec('冒险', p.title, 2); p.legacyKey = 'old'; p.archived = true
    const copy = duplicateProject(p); copy.draft.spec!.hero.name = '另一个主角'
    expect(p.draft.spec.hero.name).not.toBe('另一个主角'); expect(copy.archived).toBe(false); expect(copy.legacyKey).toBeUndefined(); expect(copy.id).not.toBe(p.id)
  })
  it('roundtrips planning and always imports as a new independent project', () => {
    const p = createProject('rhythm', '节奏宇宙'); p.planning.bpm = 145; p.planning.objective = '完成两首歌曲'
    const imported = importProject(serializeProject(p))
    expect(imported.id).not.toBe(p.id); expect(imported.planning).toEqual(p.planning); expect(imported.title).toBe(p.title)
  })
  it('preserves two-level specs separately from the published playable version', () => {
    const p = createProject('platformer', '小世界'); p.draft.spec = buildBuiltinGameSpec(createFallbackGameSpec('两关', p.title, 2), '森林'); p.publishedSpec = structuredClone(p.draft.spec); p.draft.spec.hero.name = '草稿主角'
    const copy = importProject(serializeProject(p)); expect(copy.draft.spec?.hero.name).toBe('草稿主角'); expect(copy.publishedSpec?.hero.name).not.toBe('草稿主角'); expect(copy.draft.spec?.levels).toHaveLength(2)
  })
  it.each([['mode', 'unsupported'], ['title', '']])('rejects invalid %s', (key, value) => {
    const p = { ...createProject('exploration', '探索'), [key]: value }
    expect(() => importProject(JSON.stringify({ format: 'pixel-world-project', version: 1, project: p }))).toThrow()
  })
  it('rejects credentials, external URLs and invalid runtime physics on import', () => {
    const p = createProject('platformer', '安全导入'); p.draft.spec = createFallbackGameSpec('测试', p.title, 2)
    p.draft.spec.assets[0].url = 'https://untrusted.test/image.png'; expect(() => importProject(serializeProject(p))).toThrow('外部')
    p.draft.spec.assets[0].url = undefined; p.draft.spec.hero.moveSpeed = -999; expect(() => importProject(serializeProject(p))).toThrow()
    p.draft.spec.hero.moveSpeed = 5; Object.assign(p.draft.spec, { apiKey: 'not-exportable' }); expect(() => importProject(serializeProject(p))).toThrow('不允许')
  })
  it('embeds fetched artwork, deduplicates downloads, and leaves source URLs intact', async () => {
    const p = createProject('platformer', '素材'); p.draft.spec = createFallbackGameSpec('测试', p.title, 2); p.draft.spec.assets = p.draft.spec.assets.slice(0, 2).map(a => ({ ...a, url: '/builtin/hero.svg' }))
    const fetcher = vi.fn(async () => new Response(new Blob(['<svg/>'], { type: 'image/svg+xml' }))); vi.stubGlobal('fetch', fetcher)
    const copy = await portableProject(p)
    expect(fetcher).toHaveBeenCalledTimes(1); expect(copy.draft.spec!.assets[0].url).toMatch(/^data:image\/svg\+xml;base64,/); expect(p.draft.spec.assets[0].url).toBe('/builtin/hero.svg')
  })
  it('reports unavailable resources instead of claiming a complete portable export', async () => {
    const p = createProject('platformer', '缓存'); p.draft.spec = createFallbackGameSpec('测试', p.title, 2); p.draft.spec.assets[0].url = 'cached-image:hero'
    await expect(portableProject(p)).rejects.toThrow('缓存')
  })
  it('retains the Chinese player title in exported filenames', () => expect(projectFileName('两关：森林/海底')).toBe('两关：森林_海底.pixel-project.json'))
})
