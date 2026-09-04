import React, { useState } from 'react'
import { money0, fmtDate } from './shared'

/* ADDING A BUNDLE — the drop, what has arrived, and the way back to an old one.
 *
 * A FILE OF ITS OWN so it can be rendered without a login. It touches no
 * supabase client of its own — everything arrives as props — which is the only
 * reason `scripts/invoices-page-preview.mjs` can server-render it and read the
 * markup back. Same argument as `KeptSheetView.jsx`: the page is behind a login
 * and a fleet, so a component that drags the client in behind it can only ever
 * be checked by eye on somebody else’s device.
 */
/* THE WAY IN, and it has to be the way in rather than a fallback.
 *
 * CloudMailin refuses anything over 512 KB and these bundles are 0.7-2.3 MB, so
 * the email route bounces every one — "552 Message size exceeds the allowed
 * size for this account". The same cap has been silently bouncing the bigger
 * settling sheets since that path was built: su_inbox has never taken a single
 * one. A sales note is small, which is why nobody found this until now.
 *
 * So the page SAYS why it is asking for the file rather than presenting an
 * upload box with no explanation, which reads as the email route having been
 * forgotten about. */
function Dropzone({ canUpload, fileInput, onUpload, busy }) {
  const [over, setOver] = useState(false)
  if (!canUpload) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        This fleet has no Square Up boat, so there is nowhere to file a bundle against.
      </p>
    )
  }
  return (
    <>
      <input ref={fileInput} type="file" accept="application/pdf,image/*" multiple
             style={{ display: 'none' }}
             onChange={(e) => onUpload(e.target.files)} />
      <div onClick={() => !busy && fileInput.current?.click()}
           onDragOver={(e) => { e.preventDefault(); setOver(true) }}
           onDragLeave={() => setOver(false)}
           onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) onUpload(e.dataTransfer.files) }}
           style={{
             border: '1px dashed ' + (over ? 'var(--hull)' : 'var(--line)'),
             background: over ? 'color-mix(in srgb, var(--hull) 8%, transparent)' : 'transparent',
             borderRadius: 6, padding: '1rem', textAlign: 'center',
             cursor: busy ? 'wait' : 'pointer', marginBottom: '0.8rem',
           }}>
        <b>{busy ? 'Adding…' : 'Drop the Monday bundle here'}</b>
        <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
          Save the PDF out of the email and drop it in, or click to choose. Several at once is fine.
        </div>
      </div>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: 0 }}>
        <b>Why not by email?</b> The forwarding address takes messages up to 512 KB and these
        bundles are 0.7–2.3 MB, so they bounce — <i>552 message size exceeds the allowed size
        for this account</i>. Sales notes are small, which is why they have always worked.
      </p>
    </>
  )
}

/* A TAB, NOT A STEP. It used to be a numbered chip in a left-to-right flow —
 * arrivals, then check, then costs — which was right while the whole page was a
 * conveyor for the initial load and is wrong now: three of the four tabs are
 * places you read, and only one is a thing you do. */

/* ── 1 · ARRIVALS ──────────────────────────────────────────────────────────
 * What the email put here. A bundle is FILED, never read automatically — the
 * same rule as a settling sheet, and for the same reason: reading is a model
 * looking at a photograph, and it has to be checked before it becomes a cost. */
export default function Arrivals({ batches, loading, onRead, onReadAll, reading, onIgnore, onDelete, busy,
                   canUpload, fileInput, onUpload }) {
  /* A TEN-YEAR LIST NEEDS A WAY IN. This was written when the tab held the
     Monday arrivals and a handful of them; it now holds 364 bundles going back
     to February 2017, in one flat run. Re-reading a particular one — to pick up
     its page numbers, or its work dates — meant scrolling past a decade.

     The recent ones and anything unread show without asking. Everything older
     is behind the box, and the page says how many are there rather than just
     stopping: a list that quietly ends looks like a list that is complete. */
  const [find, setFind] = useState('')
  if (loading) return <p className="muted">Loading…</p>
  const unread = batches.filter((b) => b.status === 'new')

  const flat = (v) => String(v ?? '').toLowerCase()
  const terms = find.toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (b) => {
    if (!terms.length) return true
    const hay = [fmtDate(String(b.received_at).slice(0, 10)),
                 String(b.received_at).slice(0, 10),
                 b.filename, b.subject, b.from_email].map(flat).join(' ')
    return terms.every((t) => hay.includes(t))
  }

  const matching = batches.filter(hit)
  const RECENT = 12
  /* Unread always shows, however old it is — it is the one thing on this tab
     that is a job rather than a record. */
  const shown = terms.length ? matching
    : matching.filter((b, i) => i < RECENT || b.status === 'new')
  const hidden = matching.length - shown.length

  return (
    <div className="card">
      <Dropzone canUpload={canUpload} fileInput={fileInput} onUpload={onUpload} busy={busy} />
      {!batches.length && (
        <p className="muted" style={{ marginBottom: 0 }}>
          Nothing here yet. Save the Monday PDF out of your email and drop it above.
        </p>
      )}

      {/* READ THE LOT. Each bundle is a minute or two, so the run carries on in
          the background and the earliest can be checked while the rest are still
          going — which is the difference between waiting an hour and working
          through them. */}
      {unread.length > 1 && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap',
                      padding: '0.6rem 0', borderTop: '1px solid var(--line)' }}>
          <button onClick={onReadAll} disabled={busy}>
            {reading ? 'Reading…' : `Read all ${unread.length}`}
          </button>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            About {Math.max(1, Math.round(unread.length * 1.5))} minutes. Check them as they
            land — nothing saves until you do.
          </span>
        </div>
      )}
      {batches.length > RECENT && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
                      padding: '0.6rem 0', borderTop: '1px solid var(--line)' }}>
          <input value={find} onChange={(e) => setFind(e.target.value)}
                 placeholder="Find a bundle — a date, or part of the file name"
                 style={{ flex: '1 1 16rem' }} />
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {terms.length
              ? `${matching.length} of ${batches.length}`
              : `${batches.length} bundles on record, back to ${fmtDate(String(batches[batches.length - 1]?.received_at || '').slice(0, 10))}`}
          </span>
          {terms.length > 0 && (
            <button className="secondary" onClick={() => setFind('')}>Clear</button>
          )}
        </div>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((b) => (
          <li key={b.id} style={{
            display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
            padding: '0.6rem 0', borderTop: '1px solid var(--line)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', minWidth: '7rem' }}>
              {fmtDate(String(b.received_at).slice(0, 10))}
            </span>
            <span style={{ flex: '1 1 12rem', fontSize: '0.88rem' }}>
              {b.subject || <span className="muted">no subject</span>}
              {/* THE FILE NAME IS THE IDENTITY OF THESE, and it was shown nowhere.
                  The search box offers to match on it, which is no use if you
                  cannot see what you would be typing — and for the 364 bundles
                  loaded by hand the subject is a stub, so the scanner file name
                  is the only thing that tells one from another.

                  The sender is dropped where there isn't one rather than left as
                  a dangling separator: those bundles came off a disk, not an
                  inbox, and "· 8 pages" with nothing before it reads as a field
                  that failed to load. */}
              <span className="muted" style={{ display: 'block', fontSize: '0.76rem' }}>
                {b.from_email ? b.from_email + ' · ' : ''}
                {b.page_count || '?'} page{b.page_count === 1 ? '' : 's'}
                {b.filename ? ' · ' + b.filename : ''}
              </span>
            </span>

            {/* THE MANAGER'S BALANCE, off the sentence in the email. It exists
                nowhere else in this app, and the direction is the part that
                matters — the wrong way is a different world from to the good. */}
            {b.manager_balance != null && (
              <span title={b.manager_balance_text || ''}
                    style={{
                      fontSize: '0.76rem', padding: '0.1rem 0.45rem', borderRadius: 3,
                      whiteSpace: 'nowrap', color: '#fff',
                      background: Number(b.manager_balance) < 0 ? 'var(--rust)' : 'var(--kelp)',
                    }}>
                {money0(b.manager_balance)}{Number(b.manager_balance) < 0 ? ' against' : ' to the good'}
              </span>
            )}

            {b.invoiceCount > 0 && (
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {b.invoiceCount} invoice{b.invoiceCount === 1 ? '' : 's'}
              </span>
            )}
            {b.status === 'ignored' && <span className="muted" style={{ fontSize: '0.76rem' }}>ignored</span>}

            <button className="secondary" onClick={() => onRead(b)} disabled={busy}>
              {b.invoiceCount ? 'Read again' : 'Read'}
            </button>
            <button className="secondary" onClick={async () => {
              const url = await signedUrl(b.file_path).catch(() => null)
              if (url) window.open(url, '_blank', 'noopener')
            }}>Open</button>
            {b.status !== 'ignored' && (
              <button className="secondary" onClick={() => onIgnore(b)}>Ignore</button>
            )}
            <button className="secondary" style={{ color: 'var(--rust)' }}
                    onClick={() => onDelete(b)}>Delete</button>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.6rem 0 0' }}>
          {hidden} older bundle{hidden === 1 ? '' : 's'} not shown. Type a date above to
          reach one — re-reading an old bundle is how it picks up page numbers and
          work dates, and your boat and category decisions carry over.
        </p>
      )}
      {terms.length > 0 && matching.length === 0 && (
        <p className="muted" style={{ fontSize: '0.84rem', margin: '0.6rem 0 0' }}>
          No bundle matches <b>{find}</b>.
        </p>
      )}
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
        <b>Read again</b> replaces what was read out of that bundle before — a bundle
        read twice must not double the costs.
      </p>
    </div>
  )
}
