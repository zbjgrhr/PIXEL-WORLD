import type { GameSpec } from '@/types'
import { animationClipPoses, normalizeAnimationSpec } from '@/lib/asset-catalog'

const DB_NAME = 'pixel-world-assets-v3'
const STORE_NAME = 'assets'
const DB_VERSION = 1

interface StoredAsset {
  key: string
  projectId: string
  assetId: string
  url: string
  updatedAt: number
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('projectId', 'projectId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function cacheAssetUrl(projectId: string, assetId: string, url: string): Promise<void> {
  if (!url) return
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({
      key: `${projectId}:${assetId}`,
      projectId,
      assetId,
      url,
      updatedAt: Date.now(),
    } satisfies StoredAsset)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

export async function cacheSpecAssets(projectId: string, spec: GameSpec): Promise<void> {
  await Promise.all(spec.assets.flatMap((asset) => {
    const jobs: Promise<void>[] = []
    if (asset.url) jobs.push(cacheAssetUrl(projectId, asset.id, asset.url))
    const animation = asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : undefined
    for (const pose of animationClipPoses(asset)) {
      const url = animation?.clips?.[pose]?.url
      if (url) jobs.push(cacheAssetUrl(projectId, `${asset.id}:clip:${pose}`, url))
    }
    return jobs
  }))
}

export async function loadProjectAssets(projectId: string): Promise<Record<string, string>> {
  const database = await openDatabase()
  if (!database) return {}
  const records = await new Promise<StoredAsset[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const index = transaction.objectStore(STORE_NAME).index('projectId')
    const request = index.getAll(projectId)
    request.onsuccess = () => resolve(request.result as StoredAsset[])
    request.onerror = () => reject(request.error)
  })
  database.close()
  return Object.fromEntries(records.map((record) => [record.assetId, record.url]))
}

export async function hydrateSpecAssets(projectId: string, spec: GameSpec): Promise<GameSpec> {
  const urls = await loadProjectAssets(projectId)
  return {
    ...spec,
    assets: spec.assets.map((asset) => {
      const animation = asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : undefined
      if (animation?.layoutVersion === 3 && animation.clips) {
        const clips = { ...animation.clips }
        for (const pose of animationClipPoses(asset)) {
          const cachedUrl = urls[`${asset.id}:clip:${pose}`]
          clips[pose] = { ...clips[pose]!, url: clips[pose]?.url || cachedUrl, status: clips[pose]?.url || cachedUrl ? 'success' : clips[pose]?.status || 'pending' }
        }
        const complete = animationClipPoses(asset).every((pose) => Boolean(clips[pose]?.url))
        return { ...asset, animation: { ...animation, clips }, url: clips.idle?.url || asset.url || urls[asset.id], status: complete ? 'success' : asset.status, error: complete ? undefined : asset.error }
      }
      return asset.url || !urls[asset.id] ? asset : { ...asset, url: urls[asset.id], status: 'success', error: undefined }
    }),
  }
}

export function stripLargeAssetUrls(spec: GameSpec): GameSpec {
  return {
    ...spec,
    assets: spec.assets.map((asset) => {
      const strip = (url?: string) => url?.startsWith('data:') || url?.startsWith('blob:') ? undefined : url
      const animation = asset.animation?.clips ? {
        ...asset.animation,
        clips: Object.fromEntries(Object.entries(asset.animation.clips).map(([pose, clip]) => [pose, clip ? { ...clip, url: strip(clip.url) } : clip])),
      } : asset.animation
      return { ...asset, url: strip(asset.url), animation }
    }),
  }
}

export async function removeProjectAssets(projectId: string): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).index('projectId').getAllKeys(projectId)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    keys.forEach((key) => store.delete(key))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}
