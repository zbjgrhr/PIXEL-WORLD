import type { GameSpec } from '@/types'
import { ANIMATION_CLIP_POSES, animationClipPoses, normalizeAnimationSpec } from '@/lib/asset-catalog'

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
  if (!url || url.startsWith('cached-image:')) return
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

export async function removeCachedAssetClips(projectId: string, assetId: string): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    for (const pose of ANIMATION_CLIP_POSES) {
      transaction.objectStore(STORE_NAME).delete(`${projectId}:${assetId}:clip:${pose}`)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

function originalCacheKey(asset: GameSpec['assets'][number], pose?: string) { const metadata = pose ? asset.animation?.clips?.[pose as keyof typeof asset.animation.clips]?.original : asset.original; return asset.id + (pose ? ':clip:' + pose : '') + (metadata ? ':original:' + metadata.sha256 : '') }

export async function cacheSpecAssets(projectId: string, spec: GameSpec, originalsOnly=false): Promise<void> {
  await Promise.all(spec.assets.flatMap((asset) => {
    const jobs: Promise<void>[] = []
    if (asset.url && (!originalsOnly||asset.original)) jobs.push(cacheAssetUrl(projectId, originalCacheKey(asset), asset.url))
    const animation = asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : undefined
    for (const pose of animationClipPoses(asset)) {
      const url = animation?.clips?.[pose]?.url
      for(const [pageIndex,page] of (animation?.clips?.[pose]?.originalPages||[]).entries())if(pageIndex&&page.url)jobs.push(cacheAssetUrl(projectId,`${asset.id}:clip:${pose}:page:${pageIndex}:original:${page.original.sha256}`,page.url))
      if (url && (!originalsOnly||animation?.clips?.[pose]?.original)) jobs.push(cacheAssetUrl(projectId, originalCacheKey(asset,pose), url))
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
  return hydrateSpecAssetsWithUrls(spec, urls)
}

export function hydrateSpecAssetsWithUrls(spec: GameSpec, urls: Record<string, string>): GameSpec {
  const resolve = (url: string | undefined, key: string) => url === `cached-image:${key}` ? urls[key] : url
  return {
    ...spec,
    assets: spec.assets.map((asset) => {
      const animation = asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : undefined
      if (animation?.layoutVersion === 3 && animation.clips) {
        const clips = { ...animation.clips }
        for (const pose of animationClipPoses(asset)) {
          const previous = clips[pose]!
          const url = resolve(previous.url, originalCacheKey(asset,pose))
          const invalid = ['failed', 'cancelled', 'generating'].includes(previous.status)
          const originalPages=previous.originalPages?.map((p,i)=>({...p,url:i?resolve(p.url,`${asset.id}:clip:${pose}:page:${i}:original:${p.original.sha256}`):undefined}))
          clips[pose] = { ...previous, originalPages, url, status: invalid ? previous.status : url&&(!originalPages||originalPages.every((p,i)=>!i||p.url)) ? 'success' : 'pending' }
        }
        const complete = animationClipPoses(asset).every((pose) => Boolean(clips[pose]?.url) && clips[pose]?.status === 'success')
        return { ...asset, animation: { ...animation, clips }, url: clips.idle?.url || resolve(asset.url, originalCacheKey(asset)), status: complete ? 'success' : 'pending', error: complete ? undefined : asset.error }
      }
      const url = resolve(asset.url, originalCacheKey(asset))
      return url ? { ...asset, url, status: 'success', error: undefined } : { ...asset, url: undefined, status: asset.kind === 'image' ? 'pending' : asset.status }
    }),
  }
}

export function stripLargeAssetUrls(spec: GameSpec): GameSpec {
  return {
    ...spec,
    assets: spec.assets.map((asset) => {
      const strip = (url: string | undefined, key: string) => url?.startsWith('data:') || url?.startsWith('blob:') ? `cached-image:${key}` : url
      const animation = asset.animation?.clips ? {
        ...asset.animation,
        clips: Object.fromEntries(Object.entries(asset.animation.clips).map(([pose, clip]) => [pose, clip ? { ...clip, originalPages:clip.originalPages?.map((p,i)=>({...p,url:i?strip(p.url,`${asset.id}:clip:${pose}:page:${i}:original:${p.original.sha256}`):undefined})),url: strip(clip.url, originalCacheKey(asset,pose)) } : clip])),
      } : asset.animation
      return { ...asset, url: strip(asset.url, originalCacheKey(asset)), animation }
    }),
  }
}

/** Review readiness without sending cached binary images as text or exceeding request limits. */
export function assetMetadataForReview(spec: GameSpec): GameSpec {
  return {
    ...spec,
    assets: spec.assets.map((asset) => ({
      ...asset,
      url: asset.url ? `cached-image:${asset.id}` : undefined,
      animation: asset.animation?.clips ? {
        ...asset.animation,
        clips: Object.fromEntries(Object.entries(asset.animation.clips).map(([pose, clip]) => [pose, clip ? { ...clip, originalPages:clip.originalPages?.map((p,i)=>({...p,url:i&&p.url?`cached-image:${asset.id}:${pose}:page:${i}`:undefined})),url: clip.url ? `cached-image:${asset.id}:${pose}` : undefined } : clip])),
      } : asset.animation,
    })),
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
