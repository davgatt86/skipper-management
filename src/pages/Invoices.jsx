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
import { totalsByPeriod, supplierHistory, MONTHS } from '../lib/invoices/periods'

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

  // The bundle being read, and the rows to check before they are saved.
  const [review, setReview] = useState(null)
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

  // ---- reading a bundle ---------------------------------------------------
  async function readBatch(batch) {
    setErr(''); setMsg(''); setStage('reading')
    try {
      /* THE FILE IS ALREADY IN THE BUCKET — the webhook put it there when the
         email arrived. `existingPaths` stops it being uploaded a second time,
         which would leave a duplicate object behind for every arrival against
         an allowance that also holds every settlement document. */
      const { data } = await parseDocuments([], DOC_TYPES.invoice, batch.boat_id || boatId, {
        existingPaths: [batch.file_path],
        onStage: setStage,
      })
      const rows = mapInvoices(data)
      if (!rows.length) {
        setErr('The reader found no invoices in that bundle. The file is still here — open it and check, or enter them by hand.')
        return
      }
      const m = applySuppliers(rows, suppliers)
      setReview({ batch, rows: m.rows, unknown: m.unknown })
      setTab('review')
      await setBatchStatus(batch.id, 'read').catch(() => {})
    } catch (e) {
      setErr(e.message || String(e))
    } finally { setStage('') }
  }

  // Re-match after a supplier is created or an alias filed, without re-reading.
  const rematch = useCallback((sups) => {
    setReview((r) => {
      if (!r) return r
      const m = applySuppliers(r.rows, sups)
      return { ...r, rows: m.rows, unknown: m.unknown }
    })
  }, [])

  async function fileSupplier(unknownName, existing) {
    setErr('')
    try {
      const s = existing
        ? await addAlias(existing, unknownName)
        : await createSupplier(fleetId, unknownName)
      const next = existing
        ? suppliers.map((x) => (x.id === s.id ? s : x))
        : [...suppliers, s].sort((a, b) => a.name.localeCompare(b.name))
      setSuppliers(next)
      rematch(next)
    } catch (e) { setErr(e.message || String(e)) }
  }

  async function saveReview() {
    if (!review) return
    setErr(''); setMsg('')
    try {
      const n = await saveBatchInvoices(review.batch, review.rows, fleetId)
      setReview(null)
      setTab('costs')
      setMsg(`${n} invoice${n === 1 ? '' : 's'} filed off that bundle.`)
      await refresh()
    } catch (e) { setErr(e.message || String(e)) }
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
        <Tab id="review" tab={tab} set={setTab} disabled={!review}>2 · Check the read</Tab>
        <span className="flow-ar">→</span>
        <Tab id="costs" tab={tab} set={setTab}>3 · What it cost</Tab>
      </div>

      {err && <p className="error" style={{ marginTop: 0 }}>{err}</p>}
      {msg && <p className="muted" style={{ marginTop: 0 }}>{msg}</p>}
      {stage && (
        <p className="muted" style={{ marginTop: 0 }}>
          {stage === 'uploading' ? 'Uploading…'
            : 'Reading the bundle — it is a photograph, so this takes a minute or two.'}
        </p>
      )}

      {tab === 'arrivals' && (
        <Arrivals batches={batches} loading={loading} onRead={readBatch}
                  busy={!!stage}
                  onIgnore={async (b) => { await setBatchStatus(b.id, 'ignored'); refresh() }}
                  onDelete={async (b) => {
                    if (!window.confirm(
                      `Delete the bundle of ${fmtDate(String(b.received_at).slice(0, 10))}?\n\n`
                      + 'Any invoices already read out of it are KEPT — the cost stood whether '
                      + 'or not the scan does. Only the document goes.')) return
                    await deleteBatch(b.id); refresh()
                  }} />
      )}

      {tab === 'review' && review && (
        <Review review={review} suppliers={suppliers}
                onChange={(rows) => setReview((r) => ({ ...r, rows }))}
                onFile={fileSupplier} onSave={saveReview}
                onCancel={() => { setReview(null); setTab('arrivals') }} />
      )}

      {tab === 'costs' && (
        <Costs invoices={invoices} suppliers={suppliers} loading={loading} />
      )}
    </AppShell>
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
function Arrivals({ batches, loading, onRead, onIgnore, onDelete, busy }) {
  if (loading) return <p className="muted">Loading…</p>
  if (!batches.length) {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>No bundles have arrived yet.</p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Forward the Monday email from the office to the same address the sales notes
          go to. A bundle is told from a settling sheet by the word <b>invoice</b> in
          the subject, which every one of them carries and no settling sheet does.
        </p>
      </div>
    )
  }
  return (
    <div className="card">
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
function Review({ review, suppliers, onChange, onFile, onSave, onCancel }) {
  const { rows, unknown, batch } = review
  const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0)

  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <>
      {/* FILING A FIRM COMES FIRST, because it changes every row that names it.
          Grouped by firm and counted: being asked the same question four times
          because one bundle carried four of its invoices is how a filing screen
          stops getting used. */}
      {unknown.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h3 style={{ margin: '0 0 0.3rem', fontSize: '0.95rem' }}>
            {unknown.length} firm{unknown.length === 1 ? '' : 's'} not on your list yet
          </h3>
          <p className="muted" style={{ margin: '0 0 0.7rem', fontSize: '0.82rem' }}>
            File them and every invoice from them lines up under one name, this bundle and
            next. Leave them and they still save — under the name as read, which is how one
            firm ends up looking like four.
          </p>
          {unknown.map((u) => (
            <UnknownFirm key={u.key} u={u} suppliers={suppliers} onFile={onFile} />
          ))}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                      flexWrap: 'wrap', gap: '0.5rem' }}>
          <b>{rows.length} invoice{rows.length === 1 ? '' : 's'} read</b>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }}>{money(total)}</span>
        </div>
        <p className="muted" style={{ margin: '0.3rem 0 0.9rem', fontSize: '0.82rem' }}>
          Read off a photograph by a model, so check it against the document before saving —
          nothing here is a figure anyone typed. Every box is editable.
        </p>

        {rows.map((r, i) => (
          <div key={i} style={{
            border: '1px solid var(--line)', borderRadius: 4, padding: '0.6rem',
            marginBottom: '0.5rem',
            borderLeftWidth: 3,
            borderLeftColor: r.supplier_id ? 'var(--kelp)' : 'var(--brass)',
          }}>
            <div style={{ display: 'grid', gap: '0.4rem',
                          gridTemplateColumns: 'minmax(9rem, 2fr) minmax(6rem, 1fr) minmax(7rem, 1fr)' }}>
              <label>
                <span className="muted" style={{ fontSize: '0.72rem' }}>Supplier</span>
                <input value={r.supplier} onChange={(e) => set(i, { supplier: e.target.value })}
                       style={{ width: '100%' }} />
              </label>
              <label>
                <span className="muted" style={{ fontSize: '0.72rem' }}>Invoice no.</span>
                <input value={r.invoice_no} onChange={(e) => set(i, { invoice_no: e.target.value })}
                       style={{ width: '100%' }} />
              </label>
              <label>
                <span className="muted" style={{ fontSize: '0.72rem' }}>Date</span>
                <input type="date" value={r.invoice_date || ''}
                       onChange={(e) => set(i, { invoice_date: e.target.value })}
                       style={{ width: '100%' }} />
              </label>
            </div>

            <label style={{ display: 'block', marginTop: '0.4rem' }}>
              <span className="muted" style={{ fontSize: '0.72rem' }}>What for</span>
              <input value={r.description} onChange={(e) => set(i, { description: e.target.value })}
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
                         onChange={(e) => set(i, { [f]: e.target.value })}
                         style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)' }} />
                </label>
              ))}
            </div>

            {/* NET + VAT MUST COME TO THE TOTAL, and when they do not the sheet
                says so rather than picking one. Same rule as the settlement
                review showing each total twice: a disagreement is reported. */}
            <Adds r={r} />
          </div>
        ))}

        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
          <button onClick={onSave}>Save these {rows.length}</button>
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
            From the bundle of {fmtDate(String(batch.received_at).slice(0, 10))}
          </span>
        </div>
      </div>
    </>
  )
}

function Adds({ r }) {
  const net = Number(r.net), vat = Number(r.vat), total = Number(r.total)
  if (![net, vat, total].every(Number.isFinite)) return null
  const diff = Math.round((net + vat - total) * 100) / 100
  if (Math.abs(diff) < 0.01) return null
  return (
    <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--rust)' }}>
      Net and VAT come to {money(net + vat)}, not {money(total)} — out by {money(diff)}.
      One of the three is misread.
    </p>
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
