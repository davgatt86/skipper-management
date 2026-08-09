import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import {
  applyPending, cacheTable, enqueue, flush, isOnline, newId,
  queueFor, readCache, subscribe, queueCounts,
} from './queue'

/* One hook for a table that has to work with no signal.
 *
 * EVERY WRITE GOES THROUGH THE OUTBOX, even when there is a good connection.
 * Two code paths — post directly when online, queue when not — would mean the
 * offline path is the one that never gets exercised, and it is the one that has
 * to work on a bad day. So writes are always queued and then flushed
 * immediately; online, that is quick enough to feel direct.
 *
 * Reads are cache-first: the last good read is shown at once, then replaced by
 * the server's answer if one arrives. Unsent writes are laid on top of whichever
 * it is, so an entry typed at sea stays visible in the list instead of appearing
 * to vanish on save.
 */
export function useOfflineTable(table, opts = {}) {
  const { orderBy = null, ascending = false, select = '*' } = opts

  const [serverRows, setServerRows] = useState([])
  const [pendingItems, setPendingItems] = useState([])
  const [counts, setCounts] = useState({ pending: 0, failed: 0 })
  const [cachedAt, setCachedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(isOnline())

  const refreshQueue = useCallback(async () => {
    setPendingItems(await queueFor(table))
    setCounts(await queueCounts())
  }, [table])

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    const cached = await readCache(table)
    if (cached.rows.length) { setServerRows(cached.rows); setCachedAt(cached.at); setLoading(false) }

    if (isOnline()) {
      let q = supabase.from(table).select(select)
      if (orderBy) q = q.order(orderBy, { ascending })
      const { data, error: e } = await q
      if (e) {
        // A failed read with a cache behind it is not worth an error banner —
        // the page still has rows. Only shout if there is nothing to show.
        if (!cached.rows.length) setError(e.message)
      } else {
        setServerRows(data || [])
        setCachedAt(Date.now())
        setError('')
        await cacheTable(table, data || [])
      }
    }
    await refreshQueue()
    setLoading(false)
  }, [table, select, orderBy, ascending, refreshQueue])

  // Flush, then reload so server-side defaults (created_at, triggers) show.
  const sync = useCallback(async () => {
    if (!isOnline()) { await refreshQueue(); return }
    const res = await flush(supabase)
    if (res.sent > 0) await load({ quiet: true })
    else await refreshQueue()
  }, [load, refreshQueue])

  useEffect(() => { load().then(sync) }, [load, sync])

  useEffect(() => subscribe(refreshQueue), [refreshQueue])

  useEffect(() => {
    const up = () => { setOnline(true); sync() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [sync])

  const rows = useMemo(() => applyPending(serverRows, pendingItems), [serverRows, pendingItems])

  const insert = useCallback(async (payload) => {
    const id = newId()
    await enqueue({ table, op: 'insert', id, payload })
    await refreshQueue()
    sync()
    return id
  }, [table, refreshQueue, sync])

  const update = useCallback(async (id, payload) => {
    await enqueue({ table, op: 'update', id, payload })
    await refreshQueue()
    sync()
  }, [table, refreshQueue, sync])

  const remove = useCallback(async (id) => {
    await enqueue({ table, op: 'delete', id, payload: null })
    await refreshQueue()
    sync()
  }, [table, refreshQueue, sync])

  return {
    rows, loading, error, setError, online, cachedAt,
    pending: counts.pending, failed: counts.failed,
    insert, update, remove, reload: load, sync,
  }
}
