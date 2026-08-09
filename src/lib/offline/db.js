// A very small IndexedDB wrapper.
//
// Hand-rolled rather than pulling in idb/localforage: this needs six operations
// and a dependency that ships to a boat is a dependency that has to be right.
// localStorage is not an option — it is synchronous and capped around 5 MB, and
// a season of engine logs plus a queue of unsent entries will not fit.
//
// Two stores:
//   queue  — unsent writes, in the order they were made (autoIncrement seq)
//   cache  — the last rows we successfully read for a table, so a page opens
//            with real data when there is no signal

const DB_NAME = 'skipper-offline'
const DB_VERSION = 1
export const STORE_QUEUE = 'queue'
export const STORE_CACHE = 'cache'

let dbPromise = null

export function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'seq', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode)
        const s = t.objectStore(store)
        let out
        try {
          out = fn(s)
        } catch (e) {
          reject(e)
          return
        }
        // Resolve on transaction completion, not on request success, so a write
        // is only reported as done once it is actually durable.
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      })
  )
}

/* Ask the browser not to throw this data away.
 *
 * By default a browser treats web storage as disposable and may clear it to
 * reclaim space, or after a spell of not being used. That is a reasonable
 * default for a website and a bad one for this: the outbox can be holding a
 * Garbage Record Book entry — a legal record — for the length of a trip.
 *
 * `persist()` asks for the durable kind. Browsers decide for themselves, and
 * having the app on the home screen counts in its favour, so this is worth
 * asking for but not worth relying on. It is why the native app is still the
 * better home for this eventually.
 *
 * Silent either way: there is nothing useful to tell a man on a boat about a
 * storage quota he cannot change.
 */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch { return null }
}

export const idbPut = (store, value) => tx(store, 'readwrite', (s) => s.put(value))
export const idbDelete = (store, key) => tx(store, 'readwrite', (s) => s.delete(key))
export const idbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key))
export const idbGetAll = (store) => tx(store, 'readonly', (s) => s.getAll())
export const idbClear = (store) => tx(store, 'readwrite', (s) => s.clear())
