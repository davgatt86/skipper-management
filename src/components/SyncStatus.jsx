import { supabase } from '../supabaseClient'
import { discard, flush, retryFailed, queueItems } from '../lib/offline/queue'
import { useAuth } from '../AuthContext'
import { useEffect, useState } from 'react'

/* Says plainly whether what you just typed has reached the office.
 *
 * The failure this exists to prevent is silent: a man fills in the Garbage
 * Record Book at sea, the save appears to work, and nobody finds out until an
 * inspection that it never left the phone. So the strip is always present when
 * there is anything unsent, states the count, and never disappears on its own.
 *
 * A rejected write is shown separately and by name. It cannot be retried into
 * success — the server has already refused it — so the only honest options are
 * to try again once the cause is fixed, or to throw it away deliberately.
 */
export default function SyncStatus({ online, pending, failed, onChange }) {
  const { held } = useAuth()
  const [failedItems, setFailedItems] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    if (!failed) { setFailedItems([]); return }
    queueItems().then((all) => { if (live) setFailedItems(all.filter((i) => i.status === 'failed')) })
    return () => { live = false }
  }, [failed])

  if (online && !held && !pending && !failed) return null

  const wrap = {
    borderColor: failed ? 'var(--rust)' : 'var(--brass)',
    display: 'flex', flexDirection: 'column', gap: '0.5rem',
  }

  return (
    <div className="card no-print" style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.95rem' }}>
          {!online ? 'No signal — working offline'
            : held ? 'Signed in, but not reaching the office'
            : pending ? 'Sending…'
            : 'Some entries were refused'}
        </strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {pending > 0 && `${pending} ${pending === 1 ? 'entry' : 'entries'} saved on this device, not yet sent. `}
          {!online && 'They will go as soon as there is a connection — you can keep working.'}
          {online && held && 'Your sign-in needs renewing and that needs a connection. Keep logging — nothing is lost, and it will catch up by itself.'}
          {online && !held && pending > 0 && 'Leave the app open a moment.'}
        </span>
        {online && pending > 0 && (
          <button
            className="no-print"
            style={{ marginLeft: 'auto', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
            onClick={async () => { await flush(supabase); onChange && onChange() }}
          >
            Send now
          </button>
        )}
      </div>

      {failed > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--rust)', fontWeight: 600, fontSize: '0.9rem' }}>
              {failed} {failed === 1 ? 'entry was' : 'entries were'} refused by the server
            </span>
            <button
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? 'Hide' : 'Show'}
            </button>
            <button
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
              onClick={async () => { await retryFailed(); await flush(supabase); onChange && onChange() }}
            >
              Try again
            </button>
          </div>
          {open && failedItems.map((i) => (
            <div key={i.seq} style={{ fontSize: '0.82rem', padding: '0.4rem 0', borderTop: '1px solid var(--border)' }}>
              <div className="muted">
                {i.op} · {new Date(i.createdAt).toLocaleString('en-GB')}
              </div>
              <div style={{ color: 'var(--rust)' }}>{i.lastError}</div>
              <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', opacity: 0.8 }}>
                {JSON.stringify(i.payload)}
              </div>
              <button
                style={{ marginTop: '0.3rem', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                onClick={async () => {
                  if (!confirm('Throw this entry away? It has not been recorded anywhere else.')) return
                  await discard(i.seq); onChange && onChange()
                }}
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
