import type { AgentRun } from '@/types'

const DB_NAME = 'pixel-world-agent-runs-v1'
const STORE_NAME = 'runs'
const DB_VERSION = 1

interface StoredRun extends AgentRun {
  sanitized: true
}

function withoutSecrets(run: AgentRun): StoredRun {
  const serialized = JSON.stringify(run)
  if (/apiKey|authorization|bearer\s/i.test(serialized)) {
    throw new Error('Agent run contains a forbidden credential field.')
  }
  return { ...JSON.parse(serialized) as AgentRun, sanitized: true }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('projectId', 'projectId', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveAgentRun(run: AgentRun): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  const stored = withoutSecrets(run)
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(stored)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

export async function loadAgentRun(id: string): Promise<AgentRun | null> {
  const database = await openDatabase()
  if (!database) return null
  const result = await new Promise<StoredRun | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result as StoredRun | undefined)
    request.onerror = () => reject(request.error)
  })
  database.close()
  if (!result) return null
  const { sanitized: _sanitized, ...run } = result
  return run
}

export async function loadLatestAgentRun(projectId: string): Promise<AgentRun | null> {
  const database = await openDatabase()
  if (!database) return null
  const results = await new Promise<StoredRun[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).index('projectId').getAll(projectId)
    request.onsuccess = () => resolve(request.result as StoredRun[])
    request.onerror = () => reject(request.error)
  })
  database.close()
  const latest = results.sort((left, right) => right.updatedAt - left.updatedAt)[0]
  if (!latest) return null
  const { sanitized: _sanitized, ...run } = latest
  return run
}

export async function deleteAgentRun(id: string): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}
