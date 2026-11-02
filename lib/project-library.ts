import type { CreationLanguage, GameSpec } from '@/types'
import { buildGameDataFromSpec } from './virtual-levels'
import { buildGamePreviewDocument } from './community-play-document'
import { parseSpatialProject, type SpatialProject } from './spatial/spec'

export const PLAY_MODES = {
  platformer: { name: '平台动作', dimension: '2D', ready: true, description: '跳跃、战斗、机关与多关卡。支持内置素材、上传素材及 AI 创作。' },
  rhythm: { name: '节奏音游', dimension: '3D', ready: true, description: '四轨击打与程序合成音乐，可调节奏、小节数和判定偏移。基础模板。' },
  exploration: { name: '自由探索', dimension: '3D', ready: true, description: '第一人称方块场景，收集水晶、开启出口。可调环境和场景规则。基础模板。' },
} as const
export type PlayMode = keyof typeof PLAY_MODES
export interface ProjectDraft { name: string; story: string; prompt: string; levelCount: number; creationLanguage: CreationLanguage; spec?: GameSpec }
export interface WorldProject {
  version: 1; id: `custom-${string}`; revision: number; title: string; mode: PlayMode
  createdAt: string; updatedAt: string; archived: boolean; legacyKey?: string
  draft: ProjectDraft; publishedSpec?: GameSpec
  spatial?: SpatialProject
  planning: { music: string; bpm: number; lanes: number; judgementMs: number; camera: string; scene: string; interactions: string; objective: string }
}
export function createProject(mode: PlayMode, title: string, now = new Date().toISOString()): WorldProject {
  return { version: 1, id: `custom-${crypto.randomUUID()}`, revision: 0, title: title.trim().slice(0, 120) || '未命名作品', mode, createdAt: now, updatedAt: now, archived: false,
    draft: { name: title.trim().slice(0, 120) || '未命名作品', story: '', prompt: '', levelCount: 2, creationLanguage: 'zh-CN' },
    planning: { music: '', bpm: 120, lanes: 4, judgementMs: 100, camera: '第三人称', scene: '', interactions: '', objective: '' } }
}
export function duplicateProject(source: WorldProject): WorldProject {
  const copy = structuredClone(source), fresh = createProject(source.mode, `${source.title} 副本`)
  if (copy.spatial) copy.spatial.title = fresh.title.slice(0, 80)
  return { ...copy, id: fresh.id, revision: 0, title: fresh.title, draft: { ...copy.draft, name: fresh.title }, createdAt: fresh.createdAt, updatedAt: fresh.updatedAt, archived: false, legacyKey: undefined }
}
export function projectFileName(title: string): string { return `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || '未命名作品'}.pixel-project.json` }

/** Portable data only: never evaluate scripts or accept provider settings. */
export function importProject(text: string): WorldProject {
  if (new TextEncoder().encode(text).byteLength > 64 * 1024 * 1024) throw Error('项目数据超过 64 MB，请导入原生游戏 ZIP。')
  const value = JSON.parse(text)
  if (value?.format !== 'pixel-world-project' || value.version !== 1) throw Error('不是支持的 PIXEL WORLD 项目数据。')
  const p = value.project
  if (!p || !Object.hasOwn(PLAY_MODES, p.mode) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120) throw Error('玩法或标题无效。')
  const cleanText = (v: unknown, max = 100000) => { if (typeof v !== 'string' || v.length > max) throw Error('项目文字字段无效。'); return v }
  const integer = (v: unknown, min: number, max: number) => { if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw Error('项目数值超出范围。'); return v }
  const d = p.draft, c = p.planning
  if (!d || !c || !['zh-CN', 'en'].includes(d.creationLanguage)) throw Error('项目结构无效。')
  const fresh = createProject(p.mode, p.title)
  fresh.draft = { name: fresh.title, story: cleanText(d.story), prompt: cleanText(d.prompt), levelCount: integer(d.levelCount, 1, 10), creationLanguage: d.creationLanguage }
  fresh.planning = { music: cleanText(c.music), bpm: integer(c.bpm, 30, 300), lanes: integer(c.lanes, 1, 12), judgementMs: integer(c.judgementMs, 10, 1000), camera: cleanText(c.camera, 100), scene: cleanText(c.scene), interactions: cleanText(c.interactions), objective: cleanText(c.objective) }
  const readSpec = (s: unknown): GameSpec | undefined => {
    if (s === undefined) return
    const spec = s as GameSpec
    if (p.mode !== 'platformer' || spec?.version !== 3 || !Array.isArray(spec.assets) || spec.assets.length > 256 || !Array.isArray(spec.levels) || spec.levels.length < 1 || spec.levels.length > 10 || !spec.hero || !spec.weapon || !spec.boss || !Array.isArray(spec.enemies) || !spec.visualStyle) throw Error('游戏规格结构无效。')
    if (new Set(spec.assets.map(a => a?.id)).size !== spec.assets.length || spec.assets.some(a => !a || !/^[a-zA-Z0-9_-]{1,100}$/.test(a.id))) throw Error('素材ID无效或重复。')
    const scan = (v: unknown, depth: number) => {
      if (depth > 35) throw Error('项目数据嵌套过深。')
      if (typeof v === 'number' && !Number.isFinite(v)) throw Error('项目包含无效数字。')
      if (v && typeof v === 'object') for (const [key, item] of Object.entries(v)) {
        if (['__proto__', 'constructor', 'prototype', 'apiKey', 'access_token', 'refresh_token'].includes(key)) throw Error('项目包含不允许的字段。')
        if (key === 'url' && item && (typeof item !== 'string' || !/^(data:image\/(png|jpeg|webp|gif|svg\+xml);base64,|\/builtin\/[\w-]+\.svg$)/.test(item))) throw Error('项目包含外部或未打包的图片。请使用原生游戏 ZIP 导入。')
        scan(item, depth + 1)
      }
    }
    scan(spec, 0)
    // Reuse the runtime's map/physics/roster/behavior limits before it enters an editor.
    const checked = structuredClone(spec), resources: Array<{ name: string; bytes: Uint8Array }> = []
    const rewrite = (v: unknown) => {
      if (!v || typeof v !== 'object') return
      for (const [key, item] of Object.entries(v)) {
        if (key === 'url' && typeof item === 'string' && item) {
          const name = `assets/resource-${resources.length}.png`
          resources.push({ name, bytes: new Uint8Array([0]) }); (v as Record<string, unknown>)[key] = name
        } else rewrite(item)
      }
    }
    rewrite(checked)
    const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v).replace(/</g, '\\u003c'))
    const runtime = buildGameDataFromSpec(checked).data
    buildGamePreviewDocument([...resources, { name: 'styles.css', bytes: new Uint8Array() }, { name: 'game.js', bytes: new Uint8Array() }, { name: 'project.json', bytes: encode(checked) }, { name: 'index.html', bytes: new TextEncoder().encode(`<script type="application/json" id="runtime-data">${new TextDecoder().decode(encode({ levels: runtime?.levels || [] }))}</script>`) }], '12345678-1234-4234-8234-123456789abc')
    if (spec.reference) spec.reference.requirements = spec.reference.requirements.map(r => ({ ...r, confirmed: false, confirmationKey: undefined }))
    return spec
  }
  fresh.draft.spec = readSpec(d.spec)
  fresh.publishedSpec = readSpec(p.publishedSpec)
  if (p.spatial !== undefined) {
    const spatial = parseSpatialProject(p.spatial)
    if (spatial.genre !== fresh.mode) throw Error('项目玩法和3D规格不一致。')
    fresh.spatial = spatial
  }
  return fresh
}
export function serializeProject(project: WorldProject): string {
  return JSON.stringify({ format: 'pixel-world-project', version: 1, project }, null, 2)
}

/** Embed images so a project file survives cache cleanup and another browser. */
export async function portableProject(project: WorldProject): Promise<WorldProject> {
  const copy = structuredClone(project), urls = new Map<string, Promise<string>>()
  const embed = (url: string) => {
    if (!urls.has(url)) urls.set(url, (async () => {
      if (url.startsWith('data:image/')) return url
      if (!/^(https?:\/\/|blob:|\/builtin\/)/.test(url)) throw Error('图片尚未从缓存恢复，无法打包项目。')
      const response = await fetch(url)
      if (!response.ok) throw Error('无法读取项目图片，请检查网络后重试。')
      const blob = await response.blob()
      if (!/^image\/(png|jpeg|webp|gif|svg\+xml)(;|$)/.test(blob.type)) throw Error('项目资源不是支持的图片。')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return `data:${blob.type.split(';')[0]};base64,${btoa(binary)}`
    })())
    return urls.get(url)!
  }
  const walk = async (v: unknown): Promise<void> => {
    if (!v || typeof v !== 'object') return
    for (const [key, item] of Object.entries(v)) {
      if (key === 'url' && typeof item === 'string' && item) (v as Record<string, unknown>)[key] = await embed(item)
      else await walk(item)
    }
  }
  await walk(copy)
  if (new TextEncoder().encode(serializeProject(copy)).byteLength > 64 * 1024 * 1024) throw Error('包含素材的项目超过 64 MB，请精简素材后再导出项目数据。')
  return copy
}
