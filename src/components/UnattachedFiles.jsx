import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

/* Files in the bucket that no certificate points at.
 *
 * Both certificate pages upload the file BEFORE the row is saved, deliberately,
 * so a photo survives a reader that fails or a form that is filled in badly.
 * Pressing Cancel tidies up after itself; closing the page does not. One
 * abandoned upload left a 4.8 MB stray in June, and photographing 120
 * certificates is 120 more chances to leave another.
 *
 * Direct deletion from storage.objects is refused by Supabase — protect_delete()
 * exists exactly so nobody strands the underlying object — so this goes through
 * the Storage API with the skipper's own session, which the bucket's delete
 * policy already allows.
 *
 * Shown only when there is something to sweep, and only to someone who can
 * delete. It is never the point of the page.
 */
export default function UnattachedFiles({ bucket, fleetId, referenced, nested = false, canDelete, onChange }) {
  const [orphans, setOrphans] = useState([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)

  const scan = useCallback(async () => {
    if (!fleetId || !canDelete) { setOrphans([]); return }
    setErr('')
    try {
      const found = []
      const top = await supabase.storage.from(bucket).list(fleetId, { limit: 1000 })
      if (top.error) throw top.error

      for (const entry of top.data || []) {
        // A folder has no id in Supabase's listing; a file does. crew-certs is
        // <fleet>/<crew_id>/<file>, vessel-certs is <fleet>/<file>.
        const isFolder = !entry.id
        if (isFolder && nested) {
          const inner = await supabase.storage.from(bucket).list(`${fleetId}/${entry.name}`, { limit: 1000 })
          if (inner.error) throw inner.error
          for (const f of inner.data || []) {
            if (!f.id) continue
            found.push({ path: `${fleetId}/${entry.name}/${f.name}`, name: f.name, size: f.metadata?.size ?? null, at: f.created_at })
          }
        } else if (!isFolder) {
          found.push({ path: `${fleetId}/${entry.name}`, name: entry.name, size: entry.metadata?.size ?? null, at: entry.created_at })
        }
      }

      const used = new Set(referenced)
      setOrphans(found.filter((f) => !used.has(f.path)))
    } catch (e) { setErr(e.message || String(e)) }
  }, [bucket, fleetId, nested, canDelete, referenced])

  useEffect(() => { scan() }, [scan])

  if (!canDelete || (!orphans.length && !err)) return null

  const kb = (n) => (n == null ? '' : Math.round(n / 1024).toLocaleString('en-GB') + ' KB')
  const total = orphans.reduce((s, o) => s + (o.size || 0), 0)

  async function remove(paths) {
    setBusy('deleting'); setErr('')
    const { error } = await supabase.storage.from(bucket).remove(paths)
    setBusy('')
    if (error) { setErr(error.message); return }
    await scan()
    onChange && onChange()
  }

  return (
    <div className="card no-print" style={{ borderColor: 'var(--brass)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.95rem' }}>
          {orphans.length} uploaded {orphans.length === 1 ? 'file is' : 'files are'} not attached to a certificate
        </strong>
        {total > 0 && <span className="muted" style={{ fontSize: '0.85rem' }}>{kb(total)}</span>}
        <button className="secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>
        <button style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', marginLeft: 'auto' }}
                disabled={busy === 'deleting'}
                onClick={() => {
                  if (!confirm(`Delete ${orphans.length} unattached ${orphans.length === 1 ? 'file' : 'files'}? Anything attached to a certificate is untouched.`)) return
                  remove(orphans.map((o) => o.path))
                }}>
          {busy === 'deleting' ? 'Deleting…' : 'Delete them'}
        </button>
      </div>

      <p className="muted" style={{ fontSize: '0.82rem', margin: '0.4rem 0 0' }}>
        A photo is uploaded before the details are saved, so it survives a reader that fails. These are
        ones where the form was closed instead of finished — the picture is here, but nothing points at it.
      </p>

      {err && <p className="error" style={{ marginBottom: 0 }}>{err}</p>}

      {open && orphans.map((o) => (
        <div key={o.path} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.35rem 0', borderTop: '1px solid var(--border)', fontSize: '0.85rem', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{o.name}</span>
          <span className="muted">{kb(o.size)}</span>
          {o.at && <span className="muted">{new Date(o.at).toLocaleDateString('en-GB')}</span>}
          <button className="secondary" style={{ marginLeft: 'auto', padding: '0.2rem 0.55rem', fontSize: '0.78rem' }}
                  disabled={busy === 'deleting'} onClick={() => remove([o.path])}>Delete</button>
        </div>
      ))}
    </div>
  )
}
