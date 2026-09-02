import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import {
  listBatches, listInvoices, listSuppliers, createSupplier, addAlias,
  saveBatchInvoices, setBatchStatus, deleteBatch, applySuppliers,
} from '../lib/su/invoices'
import { parseDocuments, DOC_TYPES, mapInvoices, signedUrl } from '../lib/su/parse'
import { totalsByPeriod, supplierHistory, addsWrong, MONTHS } from '../lib/invoices/periods'

/* THE BOAT'S INVOICES — the weekly bundle, split by supplier.
 *
 * David, Sep 2026: "i get them scanned and emailed to me every monday by denise
 * nicolson don company ... splitting is what we want, do whatever it needs to
 * have it split by supplier" and "just reporting periods. annual is most
 * important."
 *
 * THREE THINGS, IN THE ORDER THEY HAPPEN. The bundle arrives; it is read and
 * checked; the costs are then a record you can total. They are tabs rather than
 * three pages because the middle one is a step, not a place — you are only ever
 * in it for as long as it takes to check a read.
 *
 * NOTHING IS SAVED WITHOUT BEING LOOKED AT. The bundle is a photograph read by a
 * model, exactly like a settling sheet, and this page inherits that discipline
 * for the same reason: a misread supplier is a miscategorised cost for ever, and
 * a misread total is money. The email files the document and stops.
 */

const money = (n) => {
  const v = Number(n) || 0
  const a = Math.abs(v)
  return (v < 0 ? '-£' : '£') + a.toLocaleString('en-GB',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const money0 = (n) => {
  const v = Number(n) || 0
  return (v < 0 ? '-£' : '£') + Math.abs(v).toLocaleString('en-GB', { maximumFractionDigits: 0 })
}
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB',
  { day: '2-digit', month: 'short', year: 'numeric' }) : '')

export default function Invoices() {
  const { appUser } = useAuth()
  const fleetId = appUser?.fleet_id

  const [tab, setTab] = useState('arrivals')
  const [batches, setBatches] = useState([])
  const [invoices, setInvoices] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [boatId, setBoatId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  /* The bundles READ but not yet saved. A queue rather than one at a time, so
     the run carries on in the background while the earliest are checked. */
  const [queue, setQueue] = useState([])
  const [progress, setProgress] = useState(null)
  const [stage, setStage] = useState('')

  const refresh = useCallback(async () => {
    if (!fleetId) return
    setLoading(true)
    const [b, i, s] = await Promise.all([
      listBatches(fleetId), listInvoices(fleetId), listSuppliers(fleetId),
    ])
    setBatches(b); setInvoices(i); setSuppliers(s)
    setLoading(false)
  }, [fleetId])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!fleetId) return
    supabase.from('su_boats').select('id').eq('fleet_id', fleetId).eq('active', true)
      .limit(1).maybeSingle().then(({ data }) => setBoatId(data?.id || null))
  }, [fleetId])

  /* ---- PUTTING A BUNDLE IN BY HAND ----------------------------------------
   *
   * THE EMAIL ROUTE CANNOT CARRY THESE. CloudMailin refuses a message over
   * 512 KB — "552 Message size exceeds the allowed size for this account" — and
   * a weekly bundle is 0.7 to 2.3 MB before the base64 encoding an email adds.
   * Every one of them bounces.
   *
   * It is not only the invoices: `su_inbox` has never received a settling sheet
   * either, and Morna's run from 466 KB to 1.26 MB. That path was built in Aug
   * 2026 and has been quietly bouncing the big ones ever since. A sales note is
   * small, which is why the sales ingest has worked all along and nobody found
   * this.
   *
   * So the bundle is dropped in here instead. It is the same storage, the same
   * reader and the same review screen — only the delivery differs, and this one
   * has no size limit worth worrying about. Raising the CloudMailin plan would
   * restore the email route, but that costs money and this costs nothing.
   */
  const fileInput = useRef(null)

  async function uploadBundle(files) {
    const list = Array.from(files || [])
    if (!list.length || !boatId) return
    setErr(''); setMsg(''); setStage('uploading')
    try {
      const { ensurePdfjs } = await import('../lib/pdfjs.js')
      for (const f of list) {
        const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${boatId}/${Date.now()}_${safe}`
        const { error: ue } = await supabase.storage.from('su-documents').upload(path, f)
        if (ue) throw ue

        /* The page count is read here rather than left blank: it is the first
           thing that says whether the whole bundle came over, and the reader
           has not run yet. */
        let pages = null
        try {
          const pdfjs = await ensurePdfjs()
          const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise
          pages = doc.numPages
        } catch { /* a photo rather than a PDF — no page count, and that is fine */ }

        const { error: ie } = await supabase.from('su_invoice_batches').insert({
          fleet_id: fleetId, boat_id: boatId,
          file_path: path, filename: f.name, bytes: f.size, page_count: pages,
          /* NO manager's balance. It lives in the sentence Denise writes in the
             email body, and a file dropped in has no body. Blank is honest;
             carrying the last one forward would be a figure nobody stated. */
          subject: 'Added by hand', from_email: null,
        })
        if (ie) throw ie
      }
      setMsg(`${list.length} bundle${list.length === 1 ? '' : 's'} added. Read ${list.length === 1 ? 'it' : 'them'} below.`)
      await refresh()
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setStage('')
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /* ---- READING, ONE BUNDLE OR ALL OF THEM ---------------------------------
   *
   * David, Sep 2026: "it's a bit tedious doing this batches of a year read 1 per
   * go. can we have a bulk read once a bundle goes in, even if it takes minutes
   * to do so."
   *
   * THE READING IS NOT THE SLOW PART TO A PERSON — THE WAITING IS. Each bundle
   * is a five-page photograph and takes a minute or two, and doing them one at
   * a time means sitting through every one of them doing nothing.
   *
   * So the run carries on in the BACKGROUND while the queue is reviewed. The
   * first bundle lands in a few moments and can be checked while the second and
   * third are still being read, which is why this is worth more than simply
   * making the button say "all".
   *
   * WHAT DOES NOT CHANGE IS THAT NOTHING SAVES UNLOOKED-AT. A misread supplier
   * is a miscategorised cost for ever and a misread total is money. What the
   * queue removes is the waiting and thirty-four separate Save clicks — not the
   * looking. */
  const cancelRead = useRef(false)

  async function readOne(batch) {
    const { data } = await parseDocuments([], DOC_TYPES.invoice, batch.boat_id || boatId, {
      /* THE FILE IS ALREADY IN THE BUCKET. `existingPaths` stops it being
         uploaded a second time, which would leave a duplicate object per read
         against an allowance that also holds every settlement document. */
      existingPaths: [batch.file_path],
    })
    return mapInvoices(data)
  }

  async function readBatches(list) {
    if (!list.length) return
    setErr(''); setMsg('')
    cancelRead.current = false
    setProgress({ done: 0, total: list.length })
    setTab('review')

    for (let i = 0; i < list.length; i++) {
      if (cancelRead.current) break
      const batch = list[i]
      setProgress({ done: i, total: list.length, current: batch })
      try {
        const rows = await readOne(batch)
        /* A BUNDLE THE READER FOUND NOTHING IN IS QUEUED AS A PROBLEM, not
           skipped. Silently passing over it is how a week's costs go missing
           with nobody the wiser. */
        setQueue((q) => [...q, rows.length
          ? { batch, rows }
          : { batch, rows: [], error: 'The reader found no invoices in this one.' }])
        await setBatchStatus(batch.id, 'read').catch(() => {})
      } catch (e) {
        /* ONE FAILURE MUST NOT STOP THE RUN. Thirty-three good bundles should
           not be lost to the thirty-fourth timing out. */
        setQueue((q) => [...q, { batch, rows: [], error: e.message || String(e) }])
      }
    }
    setProgress(null)
  }

  const readBatch = (batch) => readBatches([batch])
  const readAllNew = () => readBatches(batches.filter((b) => b.status === 'new'))

  /* Suppliers are matched at RENDER time over the whole queue, not stored on
     each item — so filing a firm re-matches every bundle already read AND every
     one still being read, without touching what is in flight. */
  const matched = useMemo(() => {
    const all = queue.flatMap((q) => q.rows)
    const m = applySuppliers(all, suppliers)
    let at = 0
    const items = queue.map((q) => {
      const rows = m.rows.slice(at, at + q.rows.length)
      at += q.rows.length
      return { ...q, rows }
    })
    return { items, unknown: m.unknown }
  }, [queue, suppliers])

  async function fileSupplier(unknownName, existing) {
    setErr('')
    try {
      const s = existing
        ? await addAlias(existing, unknownName)
        : await createSupplier(fleetId, unknownName)
      setSuppliers((prev) => existing
        ? prev.map((x) => (x.id === s.id ? s : x))
        : [...prev, s].sort((a, b) => a.name.localeCompare(b.name)))
    } catch (e) { setErr(e.message || String(e)) }
  }

  const editRow = (batchId, i, patch) => setQueue((q) => q.map((item) =>
    item.batch.id !== batchId ? item
      : { ...item, rows: item.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  /* Saved bundle by bundle even from a "save all", so a failure part-way leaves
     the ones before it filed rather than rolling the whole afternoon back. */
  async function saveItems(items) {
    setErr(''); setMsg('')
    let saved = 0, bundles = 0
    for (const item of items) {
      if (!item.rows.length) continue
      try {
        const rows = matched.items.find((x) => x.batch.id === item.batch.id)?.rows || item.rows
        saved += await saveBatchInvoices(item.batch, rows, fleetId)
        bundles++
        setQueue((q) => q.filter((x) => x.batch.id !== item.batch.id))
      } catch (e) {
        setErr(`Stopped at the bundle of ${fmtDate(String(item.batch.received_at).slice(0, 10))} — ${e.message || e}. The ${bundles} before it are filed.`)
        break
      }
    }
    setMsg(`${saved} invoice${saved === 1 ? '' : 's'} filed off ${bundles} bundle${bundles === 1 ? '' : 's'}.`)
    await refresh()
  }

  if (!fleetId) return <AppShell maxWidth={1040}><PageHeader title="Invoices" /></AppShell>

  return (
    <AppShell maxWidth={1040}>
      <PageHeader
        eyebrow="Office → boat"
        title="Invoices"
        sub="The weekly bundle, split by supplier"
      />

      <div className="flowbar" style={{ marginBottom: '1rem' }}>
        <Tab id="arrivals" tab={tab} set={setTab}>
          1 · Arrivals{batches.filter((b) => b.status === 'new').length
            ? ` (${batches.filter((b) => b.status === 'new').length})` : ''}
        </Tab>
        <span className="flow-ar">→</span>
        <Tab id="review" tab={tab} set={setTab} disabled={!queue.length && !progress}>
          2 · Check the read{queue.length ? ` (${queue.length})` : ''}
        </Tab>
        <span className="flow-ar">→</span>
        <Tab id="costs" tab={tab} set={setTab}>3 · What it cost</Tab>
      </div>

      {err && <p className="error" style={{ marginTop: 0 }}>{err}</p>}
      {msg && <p className="muted" style={{ marginTop: 0 }}>{msg}</p>}
      {stage === 'uploading' && <p className="muted" style={{ marginTop: 0 }}>Uploading…</p>}

      {tab === 'arrivals' && (
        <Arrivals batches={batches} loading={loading} onRead={readBatch}
                  onReadAll={readAllNew} reading={!!progress}
                  busy={!!stage || !!progress} canUpload={!!boatId}
                  fileInput={fileInput} onUpload={uploadBundle}
                  onIgnore={async (b) => { await setBatchStatus(b.id, 'ignored'); refresh() }}
                  onDelete={async (b) => {
                    if (!window.confirm(
                      `Delete the bundle of ${fmtDate(String(b.received_at).slice(0, 10))}?\n\n`
                      + 'Any invoices already read out of it are KEPT — the cost stood whether '
                      + 'or not the scan does. Only the document goes.')) return
                    await deleteBatch(b.id); refresh()
                  }} />
      )}

      {tab === 'review' && (
        <Review items={matched.items} unknown={matched.unknown} suppliers={suppliers}
                progress={progress} onStop={() => { cancelRead.current = true }}
                onEdit={editRow} onFile={fileSupplier} onSave={saveItems}
                onDrop={(id) => setQueue((q) => q.filter((x) => x.batch.id !== id))} />
      )}

      {tab === 'costs' && (
        <Costs invoices={invoices} suppliers={suppliers} loading={loading} />
      )}
    </AppShell>
  )
}

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

function Tab({ id, tab, set, children, disabled }) {
  return (
    <button className={'flow' + (tab === id ? ' is-now' : '')}
            onClick={() => !disabled && set(id)} disabled={disabled}
            style={{ border: 'none', cursor: disabled ? 'default' : 'pointer',
                     opacity: disabled ? 0.45 : 1, font: 'inherit' }}>
      {children}
    </button>
  )
}

/* ── 1 · ARRIVALS ──────────────────────────────────────────────────────────
 * What the email put here. A bundle is FILED, never read automatically — the
 * same rule as a settling sheet, and for the same reason: reading is a model
 * looking at a photograph, and it has to be checked before it becomes a cost. */
function Arrivals({ batches, loading, onRead, onReadAll, reading, onIgnore, onDelete, busy,
                   canUpload, fileInput, onUpload }) {
  if (loading) return <p className="muted">Loading…</p>
  const unread = batches.filter((b) => b.status === 'new')
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
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {batches.map((b) => (
          <li key={b.id} style={{
            display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
            padding: '0.6rem 0', borderTop: '1px solid var(--line)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', minWidth: '7rem' }}>
              {fmtDate(String(b.received_at).slice(0, 10))}
            </span>
            <span style={{ flex: '1 1 12rem', fontSize: '0.88rem' }}>
              {b.subject || <span className="muted">no subject</span>}
              <span className="muted" style={{ display: 'block', fontSize: '0.76rem' }}>
                {b.from_email} · {b.page_count || '?'} page{b.page_count === 1 ? '' : 's'}
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
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
        <b>Read again</b> replaces what was read out of that bundle before — a bundle
        read twice must not double the costs.
      </p>
    </div>
  )
}

/* ── 2 · CHECK THE READ ────────────────────────────────────────────────────
 * Every figure editable, and the firms nobody has filed named at the top. */
/* ── 2 · CHECK THE READ ────────────────────────────────────────────────────
 *
 * EVERY BUNDLE IN THE RUN, IN ONE LIST. Reading thirty-four bundles one at a
 * time was the complaint; being asked to Save thirty-four times would only move
 * the tedium rather than remove it.
 *
 * WHAT NEEDS A LOOK IS PULLED TO THE TOP. That is what keeps "nothing saves
 * unlooked-at" honest at this size: a row whose net and VAT do not come to its
 * total, one with no date, one whose firm is not on the list. Scrolling past
 * two hundred correct rows to find the three wrong ones is not checking — it is
 * hoping. So the doubtful ones are counted and marked, and everything is still
 * on screen and still editable.
 */
function Review({ items, unknown, suppliers, progress, onStop, onEdit, onFile, onSave, onDrop }) {
  const rows = items.flatMap((i) => i.rows)
  const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0)

  /* The three things worth stopping for, counted across the whole run. Each is
     a different KIND of doubt and they are not lumped together: an unfiled firm
     is a decision, a sum that does not add up is a misread, a missing date puts
     the cost in no period at all. */
  const flags = {
    firm: rows.filter((r) => !r.supplier_id).length,
    adds: rows.filter((r) => addsWrong(r)).length,
    date: rows.filter((r) => !r.invoice_date).length,
  }
  const failed = items.filter((i) => i.error)

  return (
    <>
      {progress && (
        <div className="card" style={{ borderColor: 'var(--hull)' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <b>Reading {progress.done + 1} of {progress.total}</b>
            <span className="muted" style={{ flex: 1, fontSize: '0.84rem' }}>
              {progress.current
                ? fmtDate(String(progress.current.received_at).slice(0, 10))
                : ''} — a photograph takes a minute or two
            </span>
            <button className="secondary" onClick={onStop}>Stop after this one</button>
          </div>
          {/* THE POINT OF THE QUEUE: check the ones already read while the rest
              are still going. */}
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            Carry on checking below — the rest keep reading while you do.
            Leaving the page stops the run; anything already saved stays saved.
          </p>
        </div>
      )}

      {failed.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--rust)' }}>
          <b>{failed.length} bundle{failed.length === 1 ? '' : 's'} could not be read</b>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
            {failed.map((f) => (
              <li key={f.batch.id}>
                {fmtDate(String(f.batch.received_at).slice(0, 10))} — {f.error}{' '}
                <button className="secondary" style={{ padding: '0 0.4rem', fontSize: '0.74rem' }}
                        onClick={() => onDrop(f.batch.id)}>dismiss</button>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            The files are still on the Arrivals tab and can be read again.
          </p>
        </div>
      )}

      {!items.length && !progress && (
        <div className="card"><p style={{ margin: 0 }}>
          Nothing waiting to be checked. Read a bundle on the Arrivals tab.
        </p></div>
      )}

      {/* FILING A FIRM COMES FIRST, because it changes every row that names it —
          across every bundle in the queue at once, which is most of the value of
          reading them together. */}
      {unknown.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h3 style={{ margin: '0 0 0.3rem', fontSize: '0.95rem' }}>
            {unknown.length} firm{unknown.length === 1 ? '' : 's'} not on your list yet
          </h3>
          <p className="muted" style={{ margin: '0 0 0.7rem', fontSize: '0.82rem' }}>
            File one and every invoice naming it lines up, in this run and the next.
            Leave it and it still saves — under the name as read, which is how one firm
            ends up looking like four.
          </p>
          {unknown.map((u) => (
            <UnknownFirm key={u.key} u={u} suppliers={suppliers} onFile={onFile} />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="card" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        flexWrap: 'wrap', gap: '0.5rem' }}>
            <b>{rows.length} invoice{rows.length === 1 ? '' : 's'} off {items.length} bundle
              {items.length === 1 ? '' : 's'}</b>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }}>{money(total)}</span>
          </div>

          {/* WHAT WANTS A LOOK, named separately rather than as one count. */}
          <p style={{ margin: '0.4rem 0 0.6rem', fontSize: '0.84rem' }}>
            {flags.firm + flags.adds + flags.date === 0
              ? <span className="muted">Nothing flagged — every row has a filed firm, a date, and figures that add up.</span>
              : <>
                  <b>Worth a look:</b>{' '}
                  {[flags.firm && `${flags.firm} with no firm filed`,
                    flags.adds && `${flags.adds} where net + VAT ≠ total`,
                    flags.date && `${flags.date} with no date`]
                    .filter(Boolean).join(' · ')}
                </>}
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button onClick={() => onSave(items)}>
              Save all {rows.length}
            </button>
            <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
              or save a bundle at a time below
            </span>
          </div>
        </div>
      )}

      {items.filter((i) => i.rows.length).map((item) => (
        <div key={item.batch.id} className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap',
                        borderBottom: '1px solid var(--line)', paddingBottom: '0.4rem' }}>
            <b style={{ fontFamily: 'var(--font-mono, monospace)' }}>
              {fmtDate(String(item.batch.received_at).slice(0, 10))}
            </b>
            <span className="muted" style={{ flex: 1, fontSize: '0.82rem' }}>
              {item.rows.length} invoice{item.rows.length === 1 ? '' : 's'} ·{' '}
              {money(item.rows.reduce((s, r) => s + (Number(r.total) || 0), 0))} ·{' '}
              {item.batch.page_count || '?'} page{item.batch.page_count === 1 ? '' : 's'}
            </span>
            <button className="secondary" onClick={async () => {
              const url = await signedUrl(item.batch.file_path).catch(() => null)
              if (url) window.open(url, '_blank', 'noopener')
            }}>Open the scan</button>
            <button className="secondary" onClick={() => onSave([item])}>Save these</button>
            <button className="secondary" onClick={() => onDrop(item.batch.id)}>Discard</button>
          </div>

          {item.rows.map((r, i) => (
            <InvoiceRow key={i} r={r} onChange={(patch) => onEdit(item.batch.id, i, patch)} />
          ))}
        </div>
      ))}
    </>
  )
}

function InvoiceRow({ r, onChange }) {
  const bad = addsWrong(r)
  /* The left edge carries the state at a glance down a long list: green filed,
     brass a firm to file, rust a sum that does not add up. */
  const edge = bad ? 'var(--rust)' : r.supplier_id ? 'var(--kelp)' : 'var(--brass)'
  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 4, padding: '0.6rem',
      marginTop: '0.5rem', borderLeftWidth: 3, borderLeftColor: edge,
    }}>
      <div style={{ display: 'grid', gap: '0.4rem',
                    gridTemplateColumns: 'minmax(9rem, 2fr) minmax(6rem, 1fr) minmax(7rem, 1fr)' }}>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>Supplier</span>
          <input value={r.supplier} onChange={(e) => onChange({ supplier: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>Invoice no.</span>
          <input value={r.invoice_no} onChange={(e) => onChange({ invoice_no: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            Date{!r.invoice_date && <span style={{ color: 'var(--brass)' }}> · missing</span>}
          </span>
          <input type="date" value={r.invoice_date || ''}
                 onChange={(e) => onChange({ invoice_date: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
      </div>

      <label style={{ display: 'block', marginTop: '0.4rem' }}>
        <span className="muted" style={{ fontSize: '0.72rem' }}>What for</span>
        <input value={r.description} onChange={(e) => onChange({ description: e.target.value })}
               style={{ width: '100%' }} />
      </label>

      <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.4rem',
                    gridTemplateColumns: 'repeat(3, minmax(5rem, 1fr))' }}>
        {['net', 'vat', 'total'].map((f) => (
          <label key={f}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              {f === 'total' ? 'Total' : f.toUpperCase()}
            </span>
            <input value={r[f] ?? ''} inputMode="decimal"
                   onChange={(e) => onChange({ [f]: e.target.value })}
                   style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)' }} />
          </label>
        ))}
      </div>

      {bad && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--rust)' }}>
          Net and VAT come to {money(Number(r.net) + Number(r.vat))}, not {money(r.total)} —
          out by {money(Number(r.net) + Number(r.vat) - Number(r.total))}. One of the three is misread.
        </p>
      )}
    </div>
  )
}
function UnknownFirm({ u, suppliers, onFile }) {
  const [pick, setPick] = useState('')
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
                  padding: '0.35rem 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ flex: '1 1 12rem' }}>
        <b>{u.name}</b>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {' '}· {u.count} invoice{u.count === 1 ? '' : 's'} · {money(u.total)}
        </span>
      </span>
      <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: '13rem' }}>
        <option value="">add as a new firm</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>same as {s.name}</option>)}
      </select>
      <button className="secondary"
              onClick={() => onFile(u.name, pick ? suppliers.find((s) => s.id === pick) : null)}>
        File
      </button>
    </div>
  )
}

/* ── 3 · WHAT IT COST ──────────────────────────────────────────────────────
 * Annual first, because that is the one David said matters. */
function Costs({ invoices, suppliers, loading }) {
  const [grain, setGrain] = useState('year')
  const [basis, setBasis] = useState('total')
  const [fyStart, setFyStart] = useState(1)
  const [open, setOpen] = useState(null)

  const report = useMemo(
    () => totalsByPeriod(invoices, suppliers, { grain, basis, fyStartMonth: fyStart }),
    [invoices, suppliers, grain, basis, fyStart])

  if (loading) return <p className="muted">Loading…</p>
  if (!invoices.length) {
    return <div className="card"><p style={{ margin: 0 }}>
      No invoices filed yet. Read a bundle on the Arrivals tab and they will total up here.
    </p></div>
  }

  return (
    <>
      <div className="card" style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap',
                                     alignItems: 'flex-end' }}>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem', display: 'block' }}>Period</span>
          <select value={grain} onChange={(e) => setGrain(e.target.value)}>
            <option value="year">Year</option>
            <option value="quarter">Quarter</option>
            <option value="month">Month</option>
          </select>
        </label>
        <label>
          {/* NET AND GROSS DIFFER BY THE VAT, which is real money. The basis is
              always shown rather than one being quietly assumed. */}
          <span className="muted" style={{ fontSize: '0.72rem', display: 'block' }}>Figure</span>
          <select value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="total">Total (what left the account)</option>
            <option value="net">Net (before VAT)</option>
          </select>
        </label>
        <label>
          {/* The office runs this boat's quarterly accounts to 30 June, so the
              year these totals are read against may not be the calendar one. */}
          <span className="muted" style={{ fontSize: '0.72rem', display: 'block' }}>Year starts</span>
          <select value={fyStart} onChange={(e) => setFyStart(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
      </div>

      {report.undated.count > 0 && (
        <p className="muted" style={{ fontSize: '0.84rem' }}>
          {report.undated.count} invoice{report.undated.count === 1 ? '' : 's'} carrying{' '}
          {money(report.undated.total)} has no date the reader could make out, so{' '}
          {report.undated.count === 1 ? 'it is' : 'they are'} in none of the periods below.
          Give {report.undated.count === 1 ? 'it a date' : 'them dates'} and{' '}
          {report.undated.count === 1 ? 'it' : 'they'} will fall into place.
        </p>
      )}

      {report.periods.map((p) => (
        <div key={p.key} className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        gap: '0.5rem', flexWrap: 'wrap' }}>
            <b style={{ fontSize: '1.05rem' }}>{p.label}</b>
            <span className="muted" style={{ fontSize: '0.8rem', flex: 1 }}>
              {p.count} invoice{p.count === 1 ? '' : 's'} · {p.suppliers.length} supplier
              {p.suppliers.length === 1 ? '' : 's'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700,
                           fontSize: '1.05rem' }}>{money(p.total)}</span>
          </div>

          <ul style={{ listStyle: 'none', margin: '0.5rem 0 0', padding: 0 }}>
            {p.suppliers.map((s) => (
              <li key={s.key} style={{ borderTop: '1px solid var(--line)', padding: '0.25rem 0' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                  <span style={{ flex: 1 }}>
                    {s.name}
                    {/* An unfiled firm is marked, because its figure is only as
                        good as one spelling of its name. */}
                    {!s.filed && (
                      <span className="muted" style={{ fontSize: '0.72rem' }}> · not filed</span>
                    )}
                  </span>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>{s.count}</span>
                  {/* A share of the period, so the big ones stand out without
                      anyone doing arithmetic in their head. */}
                  <span className="muted" style={{ fontSize: '0.78rem', minWidth: '3rem',
                                                   textAlign: 'right' }}>
                    {p.total ? Math.round((s.total / p.total) * 100) + '%' : ''}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', minWidth: '6.5rem',
                                 textAlign: 'right' }}>{money(s.total)}</span>
                  {s.id && (
                    <button className="secondary" style={{ padding: '0 0.4rem', fontSize: '0.75rem' }}
                            onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {open === s.id ? 'hide' : 'history'}
                    </button>
                  )}
                </div>
                {open === s.id && (
                  <SupplierHistory invoices={invoices} id={s.id}
                                   opts={{ grain, basis, fyStartMonth: fyStart }} />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

function SupplierHistory({ invoices, id, opts }) {
  const h = supplierHistory(invoices, id, opts)
  return (
    <div style={{ padding: '0.4rem 0 0.5rem 1rem', fontSize: '0.84rem' }}>
      {/* WHAT IT RESTS ON, FIRST. One period is an observation, not a pattern —
          the same discipline as the gear lives and the stores history. */}
      <div className="muted" style={{ marginBottom: '0.25rem' }}>
        {h.confidence}
        {h.average != null && h.periods.length > 1 && ` · ${money(h.average)} a period on average`}
      </div>
      {h.periods.map((p) => (
        <div key={p.key} style={{ display: 'flex', gap: '0.5rem' }}>
          <span style={{ minWidth: '6rem' }}>{p.label}</span>
          <span className="muted" style={{ minWidth: '2rem' }}>{p.count}</span>
          <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{money(p.total)}</span>
        </div>
      ))}
    </div>
  )
}
