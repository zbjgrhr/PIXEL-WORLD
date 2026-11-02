import { createProject, type WorldProject } from './project-library'
import { hydrateSpecAssets } from './asset-db'
import type { GameSpec, Theme } from '@/types'

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pixel-world-project-library-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(Error('项目库无法打开，请检查浏览器存储权限。'))
  })
}
async function transact<T>(write: boolean, action: (store: IDBObjectStore, result: (v: T) => void, fail: (e: Error) => void) => void): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', write ? 'readwrite' : 'readonly')
    let value: T
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || Error('保存失败，可能是存储空间不足。')) }
    try { action(tx.objectStore('projects'), v => { value = v }, reject) } catch (e) { tx.abort(); reject(e) }
  })
}
export const listProjects = () => transact<WorldProject[]>(false, (s, done) => { s.getAll().onsuccess = e => done((e.target as IDBRequest).result) })
export const getProject = (id: string) => transact<WorldProject | undefined>(false, (s, done) => { s.get(id).onsuccess = e => done((e.target as IDBRequest).result) })
/** Revision compare + write share one transaction; an old tab cannot overwrite newer work. */
export function saveProject(project: WorldProject): Promise<WorldProject> {
  return transact<WorldProject>(true, (s, done, fail) => {
    s.get(project.id).onsuccess = e => {
      const current = (e.target as IDBRequest).result as WorldProject | undefined
      if (current && current.revision !== project.revision) { fail(Error('另一页面已修改此项目，请重新打开后再编辑。')); s.transaction.abort(); return }
      const next = { ...project, revision: project.revision + 1, updatedAt: new Date().toISOString() }
      s.put(next); done(next)
    }
  }).catch(error => { if (error?.name === 'AbortError') throw Error('另一页面已修改此项目，请重新打开后再编辑。'); throw error })
}

/** Read legacy storage without writing it. Idempotent migration keeps its source intact. */
export async function migrateLegacyProjects(): Promise<void> {
  const existing = await listProjects()
  const known = new Set(existing.flatMap(p => [p.id, p.legacyKey]).filter(Boolean))
  const themes: Theme[] = JSON.parse(localStorage.getItem('pixel-seed-themes') || '[]')
  const games = JSON.parse(localStorage.getItem('pixel-seed-game-data') || '{}').gameDataByTheme || {}
  const candidates = new Map<string, { spec: GameSpec; name: string; prompt: string }>()
  for (const theme of Array.isArray(themes) ? themes : []) if (theme.id?.startsWith('custom-') && theme.spec) candidates.set(theme.id, { spec: theme.spec, name: theme.name, prompt: theme.description || '' })
  for (const [id, game] of Object.entries(games) as [string, { data?: { spec?: GameSpec } }][]) if (id.startsWith('custom-') && game?.data?.spec && !candidates.has(id)) candidates.set(id, { spec: game.data.spec, name: game.data.spec.title, prompt: '' })
  const raw = localStorage.getItem('pixel-world-v3-generation-draft')
  if (raw) { const draft = JSON.parse(raw); if (draft.spec?.version === 3) candidates.set('active-draft', { spec: draft.spec, name: draft.name || draft.spec.title, prompt: draft.prompt || '' }) }
  for (const [key, source] of candidates) {
    if (known.has(key)) continue
    const spec = await hydrateSpecAssets(key, source.spec)
    const project = createProject('platformer', source.name)
    // A deterministic migration id also makes simultaneous first opens idempotent.
    project.id = `custom-imported-${key}`
    if (await getProject(project.id)) continue
    project.legacyKey = key
    project.draft = { name: source.name, story: spec.backgroundStory || '', prompt: source.prompt, levelCount: spec.levels.length, creationLanguage: spec.creationLanguage === 'en' ? 'en' : 'zh-CN', spec }
    if (key !== 'active-draft') project.publishedSpec = spec
    await saveProject(project)
  }
}
