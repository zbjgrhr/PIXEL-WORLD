import type { GameSpec } from '@/types'

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
  await Promise.all(spec.assets.filter((asset) => asset.url).map((asset) => cacheAssetUrl(projectId, asset.id, asset.url || '')))
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
    assets: spec.assets.map((asset) => asset.url || !urls[asset.id]
      ? asset
      : { ...asset, url: urls[asset.id], status: 'success', error: undefined }),
  }
}

export function stripLargeAssetUrls(spec: GameSpec): GameSpec {
  return {
    ...spec,
    assets: spec.assets.map((asset) => asset.url?.startsWith('data:') || asset.url?.startsWith('blob:')
      ? { ...asset, url: undefined }
      : asset),
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
