import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { exportGameZip, offlineGameRuntimeSource } from '@/lib/export-game'
import { buildGameDataFromSpec } from '@/lib/virtual-levels'
import { ANIMATION_CLIP_POSES } from '@/lib/asset-catalog'
import { withUploadedClip, withUploadedStatic } from '@/lib/uploaded-asset'

afterEach(() => vi.unstubAllGlobals())

describe('offline export with uploaded art', () => {
  it('plays three offline story levels through the final Boss without any art', async () => {
    const story = '钟表匠林澈来到倒走的城市。守钟机械带走妹妹阿遥。林澈修好三枚钟芯，在中央钟室让守钟机械认出真正的维修指令。机械放走阿遥，兄妹把中央钟调回正向。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '离线营救', 3)
    spec.assets = spec.assets.map(asset => ({ ...asset, enabled: false, url: '' }))
    spec.levels.forEach(level => { level.enemyCount = 0 })
    spec.narrative!.chapters.forEach(chapter => {
      chapter.objectives = chapter.objectives.filter(task => task.kind !== 'defeat')
      const activeObjectives = new Set(chapter.objectives.map(task => task.id))
      chapter.objectives = chapter.objectives.map(task => ({ ...task, prerequisites: task.prerequisites.filter(id => activeObjectives.has(id)) }))
    })
    spec.hero.maxHealth = 10000
    spec.boss.damage = 1
    spec.boss.health = 1
    spec.weapon.rangedDamage = 500
    let exportedSpec = spec
    let levels = buildGameDataFromSpec(spec).data!.levels
    const buttons: Array<ReturnType<typeof element>> = []
    const sections: Array<ReturnType<typeof element>> = []
    const element = () => ({ style: { display: '' }, classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() }, dataset: {}, setAttribute: vi.fn(), append: vi.fn(), replaceChildren: vi.fn(), click: vi.fn(), textContent: '', onclick: null as null | (() => void) })
    const pauseButton = element()
    const painted: string[] = []
    const context = new Proxy({ imageSmoothingEnabled: false, fillStyle: '', fillRect: () => { painted.push(context.fillStyle) }, clearRect: vi.fn(), fillText: vi.fn() }, { get: (target, key) => Reflect.has(target, key) ? Reflect.get(target, key) : () => undefined })
    const canvas = { getContext: () => context }
    let frame: ((time: number) => void) | undefined
    let persist: (() => void) | undefined
    let hidden = false
    let visibilityChanged: (() => void) | undefined
    const saved = new Map<string, string>()
    const listeners = new Map<string, (event: { key: string; preventDefault: () => void }) => void>()
    vi.stubGlobal('document', {
      get hidden() { return hidden },
      addEventListener: (name: string, listener: () => void) => { if (name === 'visibilitychange') visibilityChanged = listener },
      getElementById: (id: string) => ({ textContent: JSON.stringify(id === 'project-data' ? exportedSpec : { levels }) }),
      querySelector: (selector: string) => selector === 'canvas' ? canvas : selector === '[data-pause]' ? pauseButton : element(),
      querySelectorAll: () => [],
      createElement: (tag: string) => { const node = element(); if (tag === 'button') buttons.push(node); if (tag === 'section') sections.push(node); return node },
      body: { append: vi.fn() },
    })
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) || null, setItem: (key: string, value: string) => { saved.set(key, value) }, removeItem: (key: string) => { saved.delete(key) } })
    vi.stubGlobal('setInterval', (callback: () => void) => { persist = callback; return 1 })
    vi.stubGlobal('addEventListener', (name: string, listener: (event: { key: string; preventDefault: () => void }) => void) => { listeners.set(name, listener) })
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => { frame = callback; return 1 })
    vi.stubGlobal('__pixelWorldReadOnlySnapshot', undefined)
    let downloaded: Blob | undefined
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:offline-story-test' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('window', { setTimeout: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network unavailable') }))
    await exportGameZip(spec)
    const zip = new Uint8Array(await downloaded!.arrayBuffer())
    const entries = new Map<string, string>()
    const decode = new TextDecoder()
    for (let offset = 0; offset + 30 <= zip.length;) {
      const view = new DataView(zip.buffer, zip.byteOffset + offset)
      if (view.getUint32(0, true) !== 0x04034b50) break
      const nameLength = view.getUint16(26, true), extraLength = view.getUint16(28, true)
      const size = view.getUint32(18, true), start = offset + 30 + nameLength + extraLength
      entries.set(decode.decode(zip.slice(offset + 30, offset + 30 + nameLength)), decode.decode(zip.slice(start, start + size)))
      offset = start + size
    }
    expect(entries.has('index.html')).toBe(true)
    expect(entries.has('styles.css')).toBe(true)
    expect(entries.has('game.js')).toBe(true)
    exportedSpec = JSON.parse(entries.get('project.json')!)
    const embedded = entries.get('index.html')!.match(/<script type="application\/json" id="runtime-data">(.*?)<\/script>/)
    expect(embedded).not.toBeNull()
    levels = JSON.parse(embedded![1]).levels
    const exportedRuntime = entries.get('game.js')!
    new Function(exportedRuntime)()
    await Promise.resolve()
    await Promise.resolve()
    const snapshot = (globalThis as typeof globalThis & { __pixelWorldReadOnlySnapshot: () => { enemies: Array<{ mobility: string }> } }).__pixelWorldReadOnlySnapshot()
    expect(snapshot.enemies.some(enemy => enemy.mobility === 'boss')).toBe(false)
    expect(frame).toBeDefined()
    frame!(performance.now())
    expect(painted).toContain('#5ba5df')
    expect(painted).toContain('#ffd84d')
    const read = () => (globalThis as typeof globalThis & { __pixelWorldReadOnlySnapshot: () => { level: number; player: { x: number }; story: { endingSeen: boolean; completedLevels: string[]; counts: Record<string, number> }; won: boolean } }).__pixelWorldReadOnlySnapshot()
    const nextStory = () => buttons.filter(button => button.textContent === '继续冒险').at(-1)!.onclick?.()
    const interact = () => buttons.filter(button => button.textContent === '交互 E').at(-1)!.onclick?.()
    let now = performance.now()
    for (let overlay = 0; sections.at(-2)?.style.display === 'flex' && overlay < 20; overlay++) nextStory()
    const initialX = read().player.x
    hidden = true
    visibilityChanged!()
    now += 1000
    frame!(now)
    expect(read().player.x).toBe(initialX)
    expect(saved.size).toBe(1)
    hidden = false
    listeners.get('keydown')!({ key: 'Escape', preventDefault: () => undefined })
    listeners.get('blur')!({ key: '', preventDefault: () => undefined })
    expect(pauseButton.textContent).toBe('Resume')
    now += 1000
    frame!(now)
    expect(read().player.x).toBe(initialX)
    listeners.get('keydown')!({ key: 'Escape', preventDefault: () => undefined })
    let finalBossSpawned = false
    let midLevelRestored = false
    const clockTask = spec.narrative!.chapters.at(-1)!.objectives.find(task => task.id.endsWith('-adjust-clock'))!
    const recognitionTask = spec.narrative!.chapters.at(-1)!.objectives.find(task => task.id.endsWith('-recognize-instruction'))!
    expect(clockTask).toBeDefined()
    expect(recognitionTask).toBeDefined()
    let clockCompletedAfterBoss = false
    let recognitionCompletedAfterBoss = false
    for (let tick = 0; tick < 3500 && !read().won; tick++) {
      if (read().level === 2 && (globalThis as typeof globalThis & { __pixelWorldReadOnlySnapshot: () => { enemies: Array<{ mobility: string }> } }).__pixelWorldReadOnlySnapshot().enemies.some(enemy => enemy.mobility === 'boss')) finalBossSpawned = true
      for (let overlay = 0; sections.at(-2)?.style.display === 'flex' && overlay < 20; overlay++) nextStory()
      if (!midLevelRestored && read().level === 1 && read().player.x > 180) {
        const before = read()
        persist!()
        new Function(exportedRuntime)()
        await Promise.resolve()
        await Promise.resolve()
        expect(read().level).toBe(1)
        expect(read().player.x).toBe(before.player.x)
        expect(read().story.completedLevels).toEqual([spec.levels[0].id])
        midLevelRestored = true
      }
      const x = read().player.x
      listeners.get('keydown')!({ key: 'd', preventDefault: () => undefined })
      listeners.get('keydown')!({ key: 'w', preventDefault: () => undefined })
      const chapter = spec.narrative!.chapters[read().level]
      if (chapter?.points[0] && x > 120 + (1152 - 288) * chapter.points[0].position - 80) interact()
      if (read().level === 2 && Math.abs(x - (120 + (1152 - 288) * .83)) < 90) {
        const bossDefeated = Boolean(read().story.counts[`${chapter.levelId}-boss`])
        interact()
        if (read().story.counts[recognitionTask.id]) {
          expect(bossDefeated).toBe(true)
          recognitionCompletedAfterBoss = true
        }
        if (read().story.counts[clockTask.id]) {
          expect(bossDefeated).toBe(true)
          expect(read().story.counts[recognitionTask.id]).toBe(1)
          clockCompletedAfterBoss = true
        }
      }
      if (tick % 18 === 0) listeners.get('keydown')!({ key: 'k', preventDefault: () => undefined })
      now += 16.67
      frame!(now)
    }
    if (!read().won) throw new Error(JSON.stringify(read()))
    expect(midLevelRestored).toBe(true)
    expect(finalBossSpawned).toBe(true)
    expect(recognitionCompletedAfterBoss).toBe(true)
    expect(clockCompletedAfterBoss).toBe(true)
    spec.narrative!.chapters.forEach(chapter => {
      const repair = chapter.objectives.find(task => task.id.includes('-story-action-'))!
      expect(read().story.counts[repair.id]).toBe(1)
    })
    expect(painted).toContain('#c94c8f')
    expect(read().story.completedLevels).toEqual(spec.levels.map(level => level.id))
    expect(read().story.endingSeen).toBe(true)
    expect(read().won).toBe(true)
    persist!()
    expect(saved.size).toBe(1)
    new Function(exportedRuntime)()
    await Promise.resolve()
    await Promise.resolve()
    expect(read().story.completedLevels).toEqual(spec.levels.map(level => level.id))
    expect(read().story.endingSeen).toBe(true)
    expect(read().won).toBe(true)
    buttons.filter(button => button.textContent === '重新开始').at(-1)!.onclick?.()
    expect(read().level).toBe(0)
    expect(read().story.completedLevels).toEqual([])
    expect(read().story.endingSeen).toBe(false)
    expect(read().won).toBe(false)
    expect(saved.size).toBe(0)
  })
  it('embeds the current story, chapter tasks and ending in the offline package', async () => {
    const story = '小企鹅在日本世界发现妈妈失踪了。他追踪熊猫Boss，最后救出了妈妈。'
    const spec = createFallbackGameSpec(`世界观与故事：${story}`, '小企鹅找妈妈', 3)
    spec.assets = spec.assets.map(asset => ({ ...asset, enabled: false }))
    let downloaded: Blob | undefined
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:story-test' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click: vi.fn() }) })
    vi.stubGlobal('window', { setTimeout: vi.fn() })

    await exportGameZip(spec)

    const archive = new TextDecoder().decode(await downloaded!.arrayBuffer())
    expect(archive).toContain('project.json')
    expect(archive).toContain(story)
    expect(archive).toContain(spec.narrative!.ending)
    for (const chapter of spec.narrative!.chapters) {
      expect(archive).toContain(chapter.levelId)
      for (const task of chapter.objectives) expect(archive).toContain(task.id)
    }
    expect(archive).toContain('const storyEngine=')
    const embedded = archive.match(/<script type="application\/json" id="runtime-data">(.*?)<\/script>/)
    expect(embedded).not.toBeNull()
    expect(JSON.parse(embedded![1]).levels.at(-1).bossSpawn).toEqual(expect.objectContaining({ kind: 'boss' }))
    expect(archive).toContain('id: boss?.id || layout.bossSpawn.kind')
    expect(archive).not.toContain('if (boss) enemies.push')
  })
  it('packages a browser-uploaded image into the game ZIP', async () => {
    const spec = createFallbackGameSpec('A pixel adventure', 'Upload Test', 1)
    const hero = spec.assets.find((asset) => asset.category === 'hero')!
    spec.assets = [withUploadedStatic(hero, 'data:image/png;base64,VEVTVA==')]
    let downloaded: Blob | undefined
    const click = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:upload-test' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click }) })
    vi.stubGlobal('window', { setTimeout: vi.fn() })

    await exportGameZip(spec)

    expect(click).toHaveBeenCalledOnce()
    expect(downloaded).toBeDefined()
    const archive = new TextDecoder().decode(await downloaded!.arrayBuffer())
    expect(archive).toContain(`assets/${hero.id}.png`)
    expect(archive).toContain('TEST')
    expect(archive).toContain('project.json')
  })

  it('packages each uploaded character action strip', async () => {
    const spec = createFallbackGameSpec('A pixel adventure', 'Action Test', 1)
    const hero = spec.assets.find((asset) => asset.category === 'hero')!
    spec.assets = [ANIMATION_CLIP_POSES.reduce((asset, pose) => withUploadedClip(asset, pose, 'data:image/png;base64,VEVTVA=='), hero)]
    let downloaded: Blob | undefined
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:actions' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click: vi.fn() }) })
    vi.stubGlobal('window', { setTimeout: vi.fn() })

    await exportGameZip(spec)

    const archive = new TextDecoder().decode(await downloaded!.arrayBuffer())
    for (const pose of ANIMATION_CLIP_POSES) expect(archive).toContain(`assets/${hero.id}-${pose.toLowerCase()}.png`)
  })

  it('exports the same enemy, item, and obstacle layout used by the web preview', async () => {
    const spec = createFallbackGameSpec('A pixel adventure', 'Layout Test', 1)
    const levelId = spec.levels[0].id
    spec.assets = spec.assets.filter(asset => ['normalObstacle', 'bounceObstacle', 'deathObstacle'].includes(asset.category))
      .map(asset => ({ ...asset, enabled: true, levelIds: [levelId], url: 'data:image/png;base64,VEVTVA==' }))
    const expected = buildGameDataFromSpec(spec).data!.levels[0]
    let downloaded: Blob | undefined
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:layout-test' }, revokeObjectURL: vi.fn() })
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click: vi.fn() }) })
    vi.stubGlobal('window', { setTimeout: vi.fn() })

    await exportGameZip(spec)

    const archive = new TextDecoder().decode(await downloaded!.arrayBuffer())
    const embedded = archive.match(/<script type="application\/json" id="runtime-data">(.*?)<\/script>/)
    expect(embedded).not.toBeNull()
    const layout = JSON.parse(embedded![1]).levels[0]
    expect(layout.enemySpawns).toEqual(expected.enemySpawns)
    expect(layout.collectibleSpawns).toEqual(expected.collectibleSpawns)
    expect(layout.obstacles).toEqual(expected.obstacles)
  })
})
