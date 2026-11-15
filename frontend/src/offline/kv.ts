/** A string map. IndexedDB in the browser, a plain object in tests. */

export interface Kv {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  keys(): Promise<string[]>
}

export function memoryKv(): Kv {
  const data = new Map<string, string>()
  return {
    async get(key) {
      return data.has(key) ? data.get(key)! : null
    },
    async set(key, value) {
      data.set(key, value)
    },
    async keys() {
      return [...data.keys()]
    },
  }
}

const DB = 'mantel'
const STORE = 'kv'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const idbKv: Kv = {
  async get(key) {
    const db = await openDb()
    try {
      const value = await request(db.transaction(STORE).objectStore(STORE).get(key))
      return typeof value === 'string' ? value : null
    } finally {
      db.close()
    }
  },
  async set(key, value) {
    const db = await openDb()
    try {
      await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key))
    } finally {
      db.close()
    }
  },
  async keys() {
    const db = await openDb()
    try {
      const all = await request(db.transaction(STORE).objectStore(STORE).getAllKeys())
      return all.map(String)
    } finally {
      db.close()
    }
  },
}

const LAST_SYNCED = 'last-synced'

export function noteSynced(iso = new Date().toISOString()) {
  window.dispatchEvent(new CustomEvent('famcal:synced', { detail: iso }))
  void idbKv.set(LAST_SYNCED, iso).catch(() => undefined)
}

export function noteCachedAt(iso: string) {
  window.dispatchEvent(new CustomEvent('famcal:cached-at', { detail: iso }))
}
