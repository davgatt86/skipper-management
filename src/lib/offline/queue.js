// The outbox: writes made with no signal, replayed when there is one.
//
// An engineer logs in the engine room, which is where the signal is worst. A
// form that posts straight to Supabase loses the entry on save and tells him it
// failed — so every write goes through here instead, and reaching the network
// is treated as the exception rather than the rule.
//
// Three rules this has to keep:
//
//  1. INSERTS CARRY A CLIENT-GENERATED id. Postgres would happily default one,
//     but then a row created offline has no id until it syncs, and editing or
//     deleting it before then has nothing to point at. Generating the uuid here
//     means the row keeps the same identity from the moment it is typed.
//
//  2. REPLAY IS STRICTLY IN ORDER, one at a time. An update to a row that was
//     itself created offline must land after the insert. A parallel flush would
//     race them.
//
//  3. A REJECTED WRITE MUST NOT BLOCK THE QUEUE FOREVER. Losing the network is
//     temporary and should retry; a check-constraint violation or an RLS denial
//     never will. The two are told apart by whether PostgREST answered at all:
//     an answer with an error code is a decision, a thrown fetch is a dropped
//     connection. Rejected items are parked as `failed` and surfaced, never
//     silently dropped — a Garbage Record Book entry is a legal record.

// Extension included on purpose: node resolves ESM specifiers literally, so
// './db' would break `node test-offline.mjs`. Vite is happy either way.
import { STORE_QUEUE, STORE_CACHE, idbPut, idbDelete, idbGetAll, idbGet } from './db.js'

const listeners = new Set()
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function announce() {
  for (const fn of listeners) {
    try { fn() } catch { /* a broken listener must not break the flush */ }
  }
}

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback for older WebViews. Only used for the client-side id; the server
  // still enforces uniqueness.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

// ---------------------------------------------------------------- the cache
// Last good read of a table, so the page opens with real rows offline.

export const cacheKey = (table) => `table:${table}`
export async function cacheTable(table, rows) {
  try { await idbPut(STORE_CACHE, { key: cacheKey(table), rows, at: Date.now() }) } catch { /* cache is best-effort */ }
}
export async function readCache(table) {
  try {
    const hit = await idbGet(STORE_CACHE, cacheKey(table))
    return hit ? { rows: hit.rows || [], at: hit.at } : { rows: [], at: null }
  } catch { return { rows: [], at: null } }
}

// ---------------------------------------------------------------- the queue

export async function enqueue({ table, op, id, payload }) {
  const item = { table, op, id, payload, createdAt: Date.now(), tries: 0, status: 'pending', lastError: null }
  await idbPut(STORE_QUEUE, item)
  announce()
  return item
}

export async function queueItems() {
  try { return (await idbGetAll(STORE_QUEUE)) || [] } catch { return [] }
}
export async function queueFor(table) {
  return (await queueItems()).filter((i) => i.table === table)
}
export async function queueCounts() {
  const all = await queueItems()
  return {
    pending: all.filter((i) => i.status === 'pending').length,
    failed: all.filter((i) => i.status === 'failed').length,
  }
}
export async function discard(seq) {
  await idbDelete(STORE_QUEUE, seq)
  announce()
}
export async function retryFailed() {
  for (const i of await queueItems()) {
    if (i.status === 'failed') await idbPut(STORE_QUEUE, { ...i, status: 'pending', tries: 0, lastError: null })
  }
  announce()
}

/* Apply the unsent writes on top of a set of server rows, so what the page
 * shows is what the log will say once it syncs. Without this an entry typed at
 * sea vanishes from the list the moment it is saved, which reads as data loss.
 * `_pending` marks the row so the UI can say so. */
export function applyPending(rows, items) {
  let out = (rows || []).map((r) => ({ ...r }))
  for (const i of items) {
    if (i.status === 'failed') continue
    if (i.op === 'insert') {
      out = out.filter((r) => r.id !== i.id)
      out.unshift({ ...i.payload, id: i.id, _pending: true })
    } else if (i.op === 'update') {
      out = out.map((r) => (r.id === i.id ? { ...r, ...i.payload, _pending: true } : r))
    } else if (i.op === 'delete') {
      out = out.filter((r) => r.id !== i.id)
    }
  }
  return out
}

/* Replay the outbox. Returns { sent, failed, stopped } — `stopped` means the
 * network went away mid-flush and the rest are still queued, which is a normal
 * outcome at sea and not an error. */
/* `navigator.onLine` only means "attached to a network", not "the office is
 * reachable" — a boat on wifi with a dead backhaul, or in cellular signal with
 * no data, looks online and answers nothing. A request in that state can hang
 * for minutes, and because `flushing` refuses to start a second flush while one
 * is running, ONE hung request would wedge the outbox for the rest of the
 * session. So every attempt is bounded; a timeout is treated exactly like a
 * dropped connection, which it is. */
const ATTEMPT_MS = 15000
export function withTimeout(promise, ms = ATTEMPT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

let flushing = null
export function flush(supabase) {
  if (flushing) return flushing            // never two flushes at once (rule 2)
  flushing = runFlush(supabase).finally(() => { flushing = null })
  return flushing
}

// Never rejects. A flush is fired from an `online` event and from every save,
// neither of which is awaited with a catch — a rejection there would surface as
// an unhandled promise rejection and, worse, leave the outbox looking idle.
async function runFlush(supabase) {
  try {
    return await flushOnce(supabase)
  } catch (e) {
    return { sent: 0, failed: 0, stopped: true, error: String(e) }
  }
}

async function flushOnce(supabase) {
  {
    let sent = 0, failed = 0, stopped = false
    const items = (await queueItems()).sort((a, b) => a.seq - b.seq)
    for (const item of items) {
      if (item.status === 'failed') continue
      if (!isOnline()) { stopped = true; break }
      let error = null
      try {
        const t = supabase.from(item.table)
        const call =
          item.op === 'insert' ? t.insert({ ...item.payload, id: item.id })
          : item.op === 'update' ? t.update(item.payload).eq('id', item.id)
          : t.delete().eq('id', item.id)
        const res = await withTimeout(call)
        error = res.error
      } catch {
        // Thrown, not answered: the connection dropped. Keep it and stop —
        // carrying on would just burn through the rest of the queue offline.
        stopped = true
        break
      }
      if (!error) {
        await idbDelete(STORE_QUEUE, item.seq)
        sent++
      } else if (item.op === 'delete' && (error.code === 'PGRST116' || /0 rows/i.test(error.message || ''))) {
        // Already gone on the server. The intent is satisfied either way.
        await idbDelete(STORE_QUEUE, item.seq)
        sent++
      } else {
        // PostgREST answered with a refusal. Retrying will not change its mind.
        await idbPut(STORE_QUEUE, {
          ...item, status: 'failed', tries: (item.tries || 0) + 1,
          lastError: error.message || String(error),
        })
        failed++
      }
    }
    announce()
    return { sent, failed, stopped }
  }
}
