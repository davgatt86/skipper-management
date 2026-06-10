import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { parseAfpoXlsx } from '../lib/quota/afpoParse'
import { parseTripPdf } from '../lib/quota/mcatchParse'
import { parseTripXlsx } from '../lib/quota/mcatchXlsxParse'
import { latestSnapshotByYear, buildPosition, buildForecast } from '../lib/quota/quotaAgg'
import { STOCK_SECTIONS, sectionOfStock } from '../lib/quota/stockMaster'

const fmtDate = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'
const t3 = n => n == null ? '—' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const kg0 = n => Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

const th = { textAlign: 'left', padding: '0.45rem 0.6rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--navy)' }
const td = { padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right' }
const thR = { ...th, textAlign: 'right' }

// Read every row of a table, page by page. Supabase's default "Max rows"
// (1000) silently truncates a plain .select(), which on quota_trip_catches
// (tens of rows per trip) drops catch beyond ~15 trips and makes every stock
// undercount. Paginating with .range() returns the full set regardless.
async function selectAll(table, order) {
  const PAGE = 1000
  let from = 0
  const all = []
  for (;;) {
    let q = supabase.from(table).select('*').range(from, from + PAGE - 1)
    if (order) q = q.order(order.col, { ascending: order.asc })
    const { data, error } = await q
    if (error) return { data: all, error }
    all.push(...(data || []))
    if (!data || data.length < PAGE) return { data: all, error: null }
    from += PAGE
  }
}

function Scroll({ children }) {
  return <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>
}

function Badge({ tone, children }) {
  const colours = {
    official: { bg: '#eef4ff', fg: '#1d4ed8' },
    manual: { bg: '#f5f3ff', fg: '#6d28d9' },
    est: { bg: '#fff7ed', fg: '#c2410c' },
    warn: { bg: '#fef2f2', fg: '#b91c1c' },
    ok: { bg: '#f0fdf4', fg: '#15803d' },
  }[tone] || { bg: 'var(--grey-50)', fg: 'var(--grey-400)' }
  return (
    <span style={{ background: colours.bg, color: colours.fg, borderRadius: 4, padding: '0.1rem 0.45rem', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function UploadBtn({ label, accept, multiple, busy, onFiles }) {
  const ref = useRef()
  return (
    <>
      <input ref={ref} type="file" accept={accept} multiple={multiple} style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.length) onFiles([...e.target.files]); e.target.value = '' }} />
      <button onClick={() => ref.current.click()} disabled={busy}>{busy ? 'Reading…' : label}</button>
    </>
  )
}

function StockSelect({ value, onChange, exclude = new Set(), style }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={style}>
      <option value="">— pick a stock —</option>
      {STOCK_SECTIONS.map(g => (
        <optgroup key={g.section} label={g.section}>
          {g.stocks.map(s => <option key={s} value={s} disabled={exclude.has(s)}>{s}{exclude.has(s) ? ' (tracked)' : ''}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function ForecastView({ year, section, rows, trips }) {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const fc = useMemo(() => buildForecast({ rows, trips, year, asOf }), [rows, trips, year, asOf])
  const visible = fc.rows.filter(r => section === 'all' ? true : r.section === section)
  const tone = { over: 'warn', short: 'warn', tight: 'est', ok: 'ok', nodata: undefined }
  const label = { over: 'over quota', short: 'will run short', tight: 'tight', ok: 'on track', nodata: 'no history' }
  const t2 = n => n == null ? '—' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const win = `${asOf.slice(8, 10)}/${asOf.slice(5, 7)} → 31/12`
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
        <strong>Year-end forecast</strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          rest of {year} ({win}) vs the same window in {fc.years_present.length ? fc.years_present.join(', ') : 'prior years'}
        </span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.85rem' }}>
          from <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
        </span>
      </div>
      {!fc.years_present.length && (
        <p style={{ color: '#c2410c', fontSize: '0.85rem' }}>
          No prior-year trip reports loaded yet, so there's nothing to project against. Upload last year's mcatch trips and this fills in.
        </p>
      )}
      <Scroll>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.88rem' }}>
          <thead>
            <tr>
              <th style={th}>Stock</th>
              <th style={thR}>Est. balance now t</th>
              <th style={thR}>Caught {win} t</th>
              <th style={thR}>Projected year-end t</th>
              <th style={th}>Outlook</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => {
              const projStyle = { ...tdR, fontWeight: 700, color: (r.status === 'over' || r.status === 'short') ? '#b91c1c' : r.status === 'tight' ? '#c2410c' : 'var(--navy)' }
              return (
                <tr key={r.stock}>
                  <td style={td}>{r.stock}{section === 'all' && <span className="muted" style={{ fontSize: '0.75rem' }}> · {r.section}</span>}</td>
                  <td style={tdR}>{t2(r.est_balance)}</td>
                  <td style={tdR}>{r.avg_prior_t == null ? '—' : t2(r.avg_prior_t)}{r.prior_years.length > 1 && <span className="muted" style={{ fontSize: '0.7rem' }}> ({r.prior_years.length}y avg)</span>}</td>
                  <td style={projStyle}>{r.projected_t == null ? '—' : t2(r.projected_t)}</td>
                  <td style={td}><Badge tone={tone[r.status]}>{label[r.status]}</Badge></td>
                </tr>
              )
            })}
            {!visible.length && <tr><td style={td} colSpan={5} className="muted">No active stocks to forecast in this section.</td></tr>}
          </tbody>
        </table>
      </Scroll>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
        Projection = estimated balance now − what you landed in the same calendar window in prior years (averaged across the years on file). “No history” = no prior-year catch for that stock in this window yet.
      </p>
    </div>
  )
}

export default function Quota() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'

  const [snapshots, setSnapshots] = useState([])
  const [trips, setTrips] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [manualStocks, setManualStocks] = useState([])
  const [manualEntries, setManualEntries] = useState([])
  const [manualReady, setManualReady] = useState(true) // false until quota_manual.sql has been run
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [section, setSection] = useState('all')
  const [view, setView] = useState('position')
  const [showTrips, setShowTrips] = useState(false)

  const pushLog = m => setLog(l => [...l, m])

  async function loadAll() {
    const [snapRes, lineRes, tripRes, catchRes, adjRes, msRes, meRes] = await Promise.all([
      selectAll('quota_snapshots', { col: 'last_updated', asc: false }),
      selectAll('quota_lines'),
      selectAll('quota_trips', { col: 'arrival_at', asc: false }),
      selectAll('quota_trip_catches'),
      selectAll('quota_adjustments', { col: 'created_at', asc: true }),
      selectAll('quota_manual_stocks', { col: 'created_at', asc: true }),
      selectAll('quota_manual_entries', { col: 'entry_date', asc: true }),
    ])
    const err = snapRes.error || lineRes.error || tripRes.error || catchRes.error || adjRes.error
    if (err) { setError(err.message); return }
    // manual tables are a later migration — degrade gracefully until it's run
    if (msRes.error || meRes.error) {
      setManualReady(false)
      setManualStocks([]); setManualEntries([])
    } else {
      setManualReady(true)
      setManualStocks(msRes.data || [])
      setManualEntries(meRes.data || [])
    }
    setAdjustments(adjRes.data || [])
    const linesBySnap = {}
    for (const l of lineRes.data || []) (linesBySnap[l.snapshot_id] = linesBySnap[l.snapshot_id] || []).push(l)
    const catchesByTrip = {}
    for (const c of catchRes.data || []) (catchesByTrip[c.trip_id] = catchesByTrip[c.trip_id] || []).push(c)
    setSnapshots((snapRes.data || []).map(s => ({ ...s, lines: linesBySnap[s.id] || [] })))
    setTrips((tripRes.data || []).map(t => ({ ...t, catches: catchesByTrip[t.id] || [] })))
  }
  useEffect(() => { loadAll().then(() => setLoading(false)) }, [])

  // ---------- uploads ----------
  async function uploadAfpo(files) {
    setBusy(true); setLog([]); setError('')
    for (const f of files) {
      try {
        const res = parseAfpoXlsx(await f.arrayBuffer(), f.name)
        res.warnings.forEach(w => pushLog(`⚠ ${f.name}: ${w}`))
        if (!res.lines.length) continue
        const { data: snap, error: e1 } = await supabase.from('quota_snapshots')
          .insert({ ...res.meta, year: res.meta.year }).select().single()
        if (e1) {
          if (e1.code === '23505') { pushLog(`↺ ${f.name}: this statement (${res.meta.year}, updated ${fmtDate((res.meta.last_updated || '').slice(0, 10))}) is already loaded`); continue }
          throw e1
        }
        const rows = res.lines.map(l => ({ ...l, snapshot_id: snap.id }))
        const { error: e2 } = await supabase.from('quota_lines').insert(rows)
        if (e2) { await supabase.from('quota_snapshots').delete().eq('id', snap.id); throw e2 }
        pushLog(`✔ ${f.name}: ${res.meta.year} statement, ${res.lines.length} stocks, last landing ${fmtDate(res.meta.last_landing_date)}${res.meta.reconcile_ok ? '' : ' (FQA subtotal mismatch in source file — noted, not blocking)'}`)
      } catch (e) { pushLog(`✘ ${f.name}: ${e.message}`) }
    }
    await loadAll(); setBusy(false)
  }

  async function uploadTrips(files) {
    setBusy(true); setLog([]); setError('')
    for (const f of files) {
      try {
        const isXlsx = /\.xlsx?$/i.test(f.name) || (f.type || '').includes('sheet')
        const res = isXlsx ? parseTripXlsx(await f.arrayBuffer(), f.name) : await parseTripPdf(f)
        res.warnings.forEach(w => pushLog(`⚠ ${f.name}: ${w}`))
        if (!res.trip.trip_nr || !res.catches.length) continue
        // replace-on-reupload so corrected reports propagate
        const { data: existing } = await supabase.from('quota_trips').select('id').eq('trip_nr', res.trip.trip_nr).maybeSingle()
        if (existing) await supabase.from('quota_trips').delete().eq('id', existing.id)
        const { data: trip, error: e1 } = await supabase.from('quota_trips').insert(res.trip).select().single()
        if (e1) throw e1
        const rows = res.catches.map(c => ({ ...c, trip_id: trip.id }))
        const { error: e2 } = await supabase.from('quota_trip_catches').insert(rows)
        if (e2) { await supabase.from('quota_trips').delete().eq('id', trip.id); throw e2 }
        const yrs = [...new Set(res.catches.map(c => c.catch_date.slice(0, 4)))].sort()
        pushLog(`✔ ${f.name}: ${res.trip.trip_nr}, ${res.catches.length} catch rows, ${kg0(res.trip.total_live_kg)} kg ${res.trip.reconcile_ok ? '(reconciles with printed total)' : ''}${existing ? ' — replaced previous upload' : ''}${yrs.length > 1 ? ` — straddles ${yrs.join('/')}` : ''}`)
      } catch (e) { pushLog(`✘ ${f.name}: ${e.message}`) }
    }
    await loadAll(); setBusy(false)
  }

  // ---------- reset ----------
  // Clears every quota table for THIS fleet via the logged-in session, so
  // RLS scopes the deletes to the user's own fleet automatically (no need to
  // know the fleet UUID). Children cascade, but we delete child→parent
  // explicitly too so it works even if a cascade is ever missing.
  async function resetQuota() {
    const summary = `${snapshots.length} statement${snapshots.length === 1 ? '' : 's'}, `
      + `${trips.length} trip${trips.length === 1 ? '' : 's'}`
      + (manualReady ? `, ${manualStocks.length} manual stock${manualStocks.length === 1 ? '' : 's'}` : '')
      + `, ${adjustments.length} swap${adjustments.length === 1 ? '' : 's'}`
    if (!window.confirm(`Permanently delete ALL quota data for this fleet?\n\nThis clears ${summary} and cannot be undone — you'd need to re-upload to restore it.`)) return
    setBusy(true); setLog([]); setError('')
    const tables = ['quota_trip_catches', 'quota_trips', 'quota_lines', 'quota_snapshots']
    if (manualReady) tables.push('quota_manual_entries', 'quota_manual_stocks')
    tables.push('quota_adjustments')
    let failed = false
    for (const t of tables) {
      // .not('id','is',null) matches every row the session is allowed to see
      const { error } = await supabase.from(t).delete().not('id', 'is', null)
      if (error) { failed = true; pushLog(`✘ ${t}: ${error.message}`) }
      else pushLog(`✔ cleared ${t}`)
    }
    await loadAll(); setBusy(false)
    pushLog(failed ? '⚠ Some tables could not be cleared — see above.' : '✓ Quota page reset. Ready for a fresh upload.')
  }

  // ---------- manual stocks ----------
  const [msStock, setMsStock] = useState('')
  const [msT, setMsT] = useState('')
  const [msDate, setMsDate] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [anchorDraft, setAnchorDraft] = useState({})   // id -> {t, d}
  const [entryDraft, setEntryDraft] = useState({})     // id -> {date, kind, tonnes, note}
  const [openLedger, setOpenLedger] = useState({})     // id -> bool

  const tracked = useMemo(() => new Set(manualStocks.filter(m => Number(m.year) === Number(year)).map(m => m.stock)), [manualStocks, year])

  async function addManualStock(e, stockOverride) {
    if (e) e.preventDefault()
    const stock = stockOverride || msStock
    if (!stock) { setError('Pick a stock first.'); return }
    setError('')
    const row = {
      year: Number(year),
      stock,
      section: sectionOfStock(stock),
      anchor_t: stockOverride ? null : (msT === '' ? null : Number(msT)),
      anchor_date: stockOverride ? null : (msDate || null),
    }
    const { error: err } = await supabase.from('quota_manual_stocks').insert(row)
    if (err) {
      setError(err.code === '23505' ? `${stock} is already tracked for ${year}.` : err.message)
      return
    }
    setMsStock(''); setMsT(''); setMsDate(''); setShowAdd(false)
    loadAll()
  }

  async function saveAnchor(ms) {
    const d = anchorDraft[ms.id] || {}
    const t = d.t !== undefined ? d.t : ms.anchor_t
    const date = d.d !== undefined ? d.d : ms.anchor_date
    const { error: err } = await supabase.from('quota_manual_stocks')
      .update({ anchor_t: t === '' || t == null ? null : Number(t), anchor_date: date || null })
      .eq('id', ms.id)
    if (err) { setError(err.message); return }
    setAnchorDraft(a => { const n = { ...a }; delete n[ms.id]; return n })
    loadAll()
  }

  async function deleteManualStock(ms) {
    if (!window.confirm(`Stop tracking ${ms.stock} (${ms.year})? Its typed entries go too.`)) return
    const { error: err } = await supabase.from('quota_manual_stocks').delete().eq('id', ms.id)
    if (err) setError(err.message); else loadAll()
  }

  async function addEntry(ms) {
    const d = entryDraft[ms.id] || {}
    if (!d.tonnes || Number(d.tonnes) <= 0) { setError('Entry needs a tonnage.'); return }
    setError('')
    const { error: err } = await supabase.from('quota_manual_entries').insert({
      manual_stock_id: ms.id,
      entry_date: d.date || today(),
      kind: d.kind || 'catch',
      tonnes: Number(d.tonnes),
      note: (d.note || '').trim(),
    })
    if (err) { setError(err.message); return }
    setEntryDraft(a => { const n = { ...a }; delete n[ms.id]; return n })
    loadAll()
  }

  async function deleteEntry(id) {
    const { error: err } = await supabase.from('quota_manual_entries').delete().eq('id', id)
    if (err) setError(err.message); else loadAll()
  }

  // ---------- what-if swaps & rentals ----------
  const [outStock, setOutStock] = useState('')
  const [outT, setOutT] = useState('')
  const [inStock, setInStock] = useState('')
  const [inT, setInT] = useState('')
  const [adjNote, setAdjNote] = useState('')

  async function addAdjustment(e) {
    e.preventDefault()
    const rows = []
    if (outStock && Number(outT) > 0) rows.push({ year: Number(year), stock: outStock, direction: 'out', tonnes: Number(outT), note: adjNote.trim() })
    if (inStock && Number(inT) > 0) rows.push({ year: Number(year), stock: inStock, direction: 'in', tonnes: Number(inT), note: adjNote.trim() })
    if (!rows.length) { setError('Pick a stock and tonnage for at least one side.'); return }
    setError('')
    const { error: err } = await supabase.from('quota_adjustments').insert(rows)
    if (err) { setError(err.message); return }
    setOutStock(''); setOutT(''); setInStock(''); setInT(''); setAdjNote('')
    loadAll()
  }

  async function deleteAdjustment(a) {
    const { error: err } = await supabase.from('quota_adjustments').delete().eq('id', a.id)
    if (err) setError(err.message); else loadAll()
  }

  // ---------- derived ----------
  const latestByYear = useMemo(() => latestSnapshotByYear(snapshots), [snapshots])
  const years = useMemo(() => {
    const ys = new Set(Object.keys(latestByYear))
    for (const t of trips) for (const c of t.catches) ys.add(c.catch_date.slice(0, 4))
    for (const m of manualStocks) ys.add(String(m.year))
    const arr = [...ys].sort().reverse()
    return arr.length ? arr : [String(new Date().getFullYear())]
  }, [latestByYear, trips, manualStocks])
  useEffect(() => { if (!years.includes(year)) setYear(years[0]) }, [years]) // eslint-disable-line

  const snapshot = latestByYear[year]
  const pos = useMemo(
    () => buildPosition({ snapshot, trips, year, adjustments, manualStocks, manualEntries }),
    [snapshot, trips, year, adjustments, manualStocks, manualEntries])

  const manualMode = !snapshot // no AFPO statement for the year -> compact table
  const yearManual = useMemo(() => manualStocks.filter(m => Number(m.year) === Number(year)), [manualStocks, year])
  const entriesByMs = useMemo(() => {
    const out = {}
    for (const e of manualEntries) (out[e.manual_stock_id] = out[e.manual_stock_id] || []).push(e)
    return out
  }, [manualEntries])

  const sections = useMemo(() => [...new Set(pos.rows.map(r => r.section))], [pos.rows])
  const visRows = useMemo(() => {
    let rows = pos.rows.filter(r => section === 'all' ? true : r.section === section)
    if (section === 'all') rows = rows.filter(r =>
      r.source !== 'afpo' || (r.allocation || 0) !== 0 || (r.catch_total || 0) !== 0 || r.since_t !== 0 || r.adj_t !== 0)
    return rows
  }, [pos.rows, section])

  if (loading) return <div className="container"><p className="muted">Loading…</p></div>
  if (!isSkipper) {
    return (
      <div className="container">
        <p><Link to="/">← Dashboard</Link></p>
        <p className="muted">Quota is skipper-only.</p>
      </div>
    )
  }

  const nothingYet = !snapshots.length && !trips.length && !manualStocks.length

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Quota</h1>
          <p className="muted" style={{ marginBottom: 0 }}>PO figures vs logbook catch</p>
        </div>
        <Link to="/">← Dashboard</Link>
      </header>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {!manualReady && (
        <p style={{ color: '#c2410c', fontSize: '0.85rem' }}>
          Manual stock tracking isn't set up in the database yet — run <code>supabase/quota_manual.sql</code> in the Supabase SQL editor, then reload.
        </p>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {manualReady && <button onClick={() => setShowAdd(s => !s)} disabled={busy}>{showAdd ? 'Close' : '+ Add stock'}</button>}
          <UploadBtn label="Upload trip reports (.pdf / .xlsx)" accept="application/pdf,.xlsx,.xls" multiple busy={busy} onFiles={uploadTrips} />
          <UploadBtn label="Upload AFPO holdings (.xlsx)" accept=".xlsx,.xls" multiple busy={busy} onFiles={uploadAfpo} />
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {snapshots.length} statement{snapshots.length === 1 ? '' : 's'} · {trips.length} trip{trips.length === 1 ? '' : 's'} · {manualStocks.length} manual stock{manualStocks.length === 1 ? '' : 's'}
          </span>
          {!nothingYet && (
            <button onClick={resetQuota} disabled={busy} title="Delete all quota data for this fleet and start fresh"
              style={{ marginLeft: 'auto', background: '#fee2e2', color: '#b91c1c', borderColor: '#fecaca' }}>
              Reset quota
            </button>
          )}
        </div>
        {nothingYet && !showAdd && (
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.7rem', marginBottom: 0 }}>
            Start by adding the stocks you hold and typing the figure your PO gave you — or, if you're in AFPO, upload your holdings spreadsheet.
            Either way, uploading mcatch trip reports deducts catch automatically.
          </p>
        )}
        {showAdd && (
          <form onSubmit={addManualStock} style={{ display: 'grid', gap: '0.5rem', maxWidth: 560, marginTop: '0.8rem' }}>
            <StockSelect value={msStock} onChange={setMsStock} exclude={tracked} />
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="number" min="0" step="0.001" placeholder="tonnes (PO figure)" value={msT} onChange={e => setMsT(e.target.value)} style={{ width: 160 }} />
              <input type="date" value={msDate} onChange={e => setMsDate(e.target.value)} />
              <button type="submit">Track stock</button>
            </div>
            <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
              The figure is good as of the date: use 1 January {year} for a season-start allocation, or the date the PO gave you a balance.
              Catch dated after it comes off. Leave both blank to just start tracking catch.
            </p>
          </form>
        )}
        {log.length > 0 && (
          <ul style={{ marginTop: '0.7rem', marginBottom: 0, paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
            {log.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {[['position', 'Position'], ['forecast', 'Forecast']].map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setView(k)} className={view === k ? '' : 'secondary'} style={{ padding: '0.4rem 0.9rem' }}>{lbl}</button>
          ))}
        </div>
        <select value={year} onChange={e => setYear(e.target.value)}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={section} onChange={e => setSection(e.target.value)}>
          <option value="all">Active stocks</option>
          {sections.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {view === 'position' && (<>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
          {snapshot
            ? <Badge tone="official">official as of {fmtDate(snapshot.last_landing_date)}</Badge>
            : yearManual.length
              ? <Badge tone="manual">manual figures</Badge>
              : <Badge tone="warn">no figures for {year}</Badge>}
          {pos.sinceTrips > 0 && <Badge tone="est">estimated now: {pos.sinceTrips} trip{pos.sinceTrips === 1 ? '' : 's'} since statement</Badge>}
          {pos.sinceTrips === 0 && snapshot && <Badge tone="ok">no landings since statement</Badge>}
        </div>

        {pos.conflicts.length > 0 && (
          <p style={{ color: '#c2410c', fontSize: '0.82rem' }}>
            The AFPO statement already covers {pos.conflicts.join(', ')} — the manual figure for {pos.conflicts.length === 1 ? 'it' : 'them'} is being ignored. Remove it below to clear this note.
          </p>
        )}

        <Scroll>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.88rem' }}>
            <thead>
              {manualMode ? (
                <tr>
                  <th style={th}>Stock</th>
                  <th style={thR}>PO figure t</th>
                  <th style={th}>As of</th>
                  <th style={thR}>Caught since t</th>
                  <th style={thR}>Typed +/− t</th>
                  <th style={thR}>What-if t</th>
                  <th style={thR}>Est. balance t</th>
                </tr>
              ) : (
                <tr>
                  <th style={th}>Stock</th>
                  <th style={thR}>Allocation t</th>
                  <th style={thR}>Catch UK t</th>
                  <th style={thR}>Catch NOR t</th>
                  <th style={thR}>Balance t</th>
                  <th style={thR}>Since stmt t</th>
                  <th style={thR}>Adj t</th>
                  <th style={thR}>Est. balance t</th>
                </tr>
              )}
            </thead>
            <tbody>
              {visRows.map(r => {
                const est = r.est_balance
                const warn = est != null && est < 0
                const near = est != null && !warn && (r.allocation || r.balance) > 0 && est < (r.allocation || r.balance) * 0.1
                const estStyle = { ...tdR, fontWeight: 700, color: warn ? '#b91c1c' : near ? '#c2410c' : 'var(--navy)' }
                const stockCell = (
                  <td style={td}>
                    {r.stock}
                    {r.source === 'manual' && <> <Badge tone="manual">manual</Badge></>}
                    {section === 'all' && <span className="muted" style={{ fontSize: '0.75rem' }}> · {r.section}</span>}
                    {r.source === 'untracked' && manualReady && (
                      <> <button className="secondary" style={{ padding: '0.05rem 0.45rem', fontSize: '0.75rem', marginLeft: '0.4rem' }}
                        onClick={() => addManualStock(null, r.stock)}>track</button></>
                    )}
                    {r.double_count_risk && <span title="This stock has both typed catches and trip-report catches — make sure a trip isn't counted twice." style={{ marginLeft: '0.3rem' }}>⚠</span>}
                  </td>
                )
                if (manualMode) {
                  return (
                    <tr key={r.section + r.stock}>
                      {stockCell}
                      <td style={tdR}>{t3(r.balance)}</td>
                      <td style={td}>{fmtDate(r.anchor_date)}</td>
                      <td style={tdR}>{r.since_t ? t3(r.since_t) : '—'}</td>
                      <td style={{ ...tdR, color: r.man_t > 0 ? '#15803d' : r.man_t < 0 ? '#b91c1c' : 'inherit' }}>
                        {r.man_t ? (r.man_t > 0 ? '+' : '') + t3(r.man_t) : '—'}
                      </td>
                      <td style={{ ...tdR, color: r.adj_t > 0 ? '#15803d' : r.adj_t < 0 ? '#b91c1c' : 'inherit' }}>
                        {r.adj_t ? (r.adj_t > 0 ? '+' : '') + t3(r.adj_t) : '—'}
                      </td>
                      <td style={estStyle}>{t3(est)}</td>
                    </tr>
                  )
                }
                const adjShown = r.adj_t + (r.man_t || 0)
                return (
                  <tr key={r.section + r.stock}>
                    {stockCell}
                    <td style={tdR}>{t3(r.allocation)}</td>
                    <td style={tdR}>{t3(r.catch_uk)}</td>
                    <td style={tdR}>{t3(r.catch_nor)}</td>
                    <td style={tdR}>{t3(r.balance)}</td>
                    <td style={tdR}>{r.since_t ? t3(r.since_t) : '—'}</td>
                    <td style={{ ...tdR, color: adjShown > 0 ? '#15803d' : adjShown < 0 ? '#b91c1c' : 'inherit' }}>
                      {adjShown ? (adjShown > 0 ? '+' : '') + t3(adjShown) : '—'}
                    </td>
                    <td style={estStyle}>{t3(est)}</td>
                  </tr>
                )
              })}
              {!visRows.length && <tr><td style={td} colSpan={manualMode ? 7 : 8} className="muted">Nothing to show — add a stock, or upload an AFPO statement and trip reports.</td></tr>}
            </tbody>
          </table>
        </Scroll>
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
          {manualMode
            ? <>Est. balance = the PO figure, minus trip-report catch landed after its date, plus/minus typed catches and leases, plus what-if swaps.
              Year-straddling trips book each catch to its catch date's year.</>
            : <>Est. balance = AFPO balance, minus logbook catch from trips landed after {fmtDate(snapshot?.last_landing_date)}.
              Year-straddling trips book each catch to its catch date's year. Adj = what-if swaps & rentals{yearManual.length ? ', plus typed entries on manual stocks' : ''}.</>}
        </p>
      </div>

      {manualReady && yearManual.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Manual stocks ({year})</h3>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Set or correct the PO figure, and type catches or leases against it. If you upload mcatch trip reports, don't also type those
            trips' catch here — it would count twice.
          </p>
          {yearManual.map(ms => {
            const draft = anchorDraft[ms.id] || {}
            const ed = entryDraft[ms.id] || {}
            const list = entriesByMs[ms.id] || []
            const open = !!openLedger[ms.id]
            return (
              <div key={ms.id} style={{ borderTop: '1px solid var(--border)', padding: '0.6rem 0' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ minWidth: 140 }}>{ms.stock}</strong>
                  <input type="number" min="0" step="0.001" placeholder="tonnes"
                    value={draft.t !== undefined ? draft.t : (ms.anchor_t ?? '')}
                    onChange={e => setAnchorDraft(a => ({ ...a, [ms.id]: { ...a[ms.id], t: e.target.value } }))}
                    style={{ width: 120 }} />
                  <input type="date"
                    value={draft.d !== undefined ? draft.d : (ms.anchor_date || '')}
                    onChange={e => setAnchorDraft(a => ({ ...a, [ms.id]: { ...a[ms.id], d: e.target.value } }))} />
                  {anchorDraft[ms.id] !== undefined && <button onClick={() => saveAnchor(ms)}>Save</button>}
                  <button className="secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.8rem' }} onClick={() => setOpenLedger(o => ({ ...o, [ms.id]: !open }))}>
                    {list.length} entr{list.length === 1 ? 'y' : 'ies'} {open ? '▾' : '▸'}
                  </button>
                  <button className="secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.8rem' }} onClick={() => deleteManualStock(ms)}>remove</button>
                </div>
                {ms.anchor_t == null && <p className="muted" style={{ fontSize: '0.78rem', margin: '0.3rem 0 0' }}>No PO figure yet — catch is tracked but no balance can be estimated until you set one.</p>}
                {open && (
                  <div style={{ marginTop: '0.5rem', paddingLeft: '0.5rem' }}>
                    {list.map(e => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.2rem 0', flexWrap: 'wrap' }}>
                        <span>
                          {fmtDate(e.entry_date)}{' '}
                          <strong style={{ color: e.kind === 'lease_in' ? '#15803d' : '#b91c1c' }}>
                            {e.kind === 'catch' ? 'Catch' : e.kind === 'lease_in' ? 'Lease/swap IN' : 'Lease/swap OUT'}
                          </strong>{' '}
                          {Number(e.tonnes).toLocaleString('en-GB', { maximumFractionDigits: 3 })} t
                          {e.note && <span className="muted"> — {e.note}</span>}
                          {ms.anchor_date && !((e.entry_date || '') > ms.anchor_date) && <span className="muted"> (before figure date — not counted)</span>}
                        </span>
                        <button className="secondary" style={{ padding: '0.05rem 0.45rem', fontSize: '0.75rem' }} onClick={() => deleteEntry(e.id)}>x</button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.4rem' }}>
                      <input type="date" value={ed.date || today()} onChange={e => setEntryDraft(a => ({ ...a, [ms.id]: { ...ed, date: e.target.value } }))} />
                      <select value={ed.kind || 'catch'} onChange={e => setEntryDraft(a => ({ ...a, [ms.id]: { ...ed, kind: e.target.value } }))}>
                        <option value="catch">Catch (deduct)</option>
                        <option value="lease_in">Lease/swap IN (add)</option>
                        <option value="lease_out">Lease/swap OUT (deduct)</option>
                      </select>
                      <input type="number" min="0.001" step="0.001" placeholder="tonnes" value={ed.tonnes || ''} onChange={e => setEntryDraft(a => ({ ...a, [ms.id]: { ...ed, tonnes: e.target.value } }))} style={{ width: 110 }} />
                      <input placeholder="note (optional)" value={ed.note || ''} onChange={e => setEntryDraft(a => ({ ...a, [ms.id]: { ...ed, note: e.target.value } }))} style={{ flex: 1, minWidth: 140 }} />
                      <button onClick={() => addEntry(ms)}>Add</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Swaps & rentals — what-if ({year})</h3>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Try a swap or rental before it's official — e.g. 20t NS Cod OUT for 100t NS Saithe IN.
          Either side can be left blank for a one-way rental. Entries adjust the Est. balance column until you remove them.
          Once a lease is real, record it as a Lease/swap entry on the stock instead.
        </p>
        <form onSubmit={addAdjustment} style={{ display: 'grid', gap: '0.5rem', maxWidth: 560 }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ width: 36, fontWeight: 700, color: '#b91c1c' }}>OUT</span>
            <StockSelect value={outStock} onChange={setOutStock} style={{ flex: 1, minWidth: 160 }} />
            <input type="number" min="0.001" step="0.001" placeholder="tonnes" value={outT} onChange={e => setOutT(e.target.value)} style={{ width: 110 }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ width: 36, fontWeight: 700, color: '#15803d' }}>IN</span>
            <StockSelect value={inStock} onChange={setInStock} style={{ flex: 1, minWidth: 160 }} />
            <input type="number" min="0.001" step="0.001" placeholder="tonnes" value={inT} onChange={e => setInT(e.target.value)} style={{ width: 110 }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input placeholder="Note, e.g. swap with WK170 (optional)" value={adjNote} onChange={e => setAdjNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button type="submit">Add</button>
          </div>
        </form>
        {adjustments.filter(a => Number(a.year) === Number(year)).length > 0 && (
          <div style={{ marginTop: '0.8rem' }}>
            {adjustments.filter(a => Number(a.year) === Number(year)).map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderTop: '1px solid var(--border)', fontSize: '0.88rem', flexWrap: 'wrap' }}>
                <span>
                  <strong style={{ color: a.direction === 'in' ? '#15803d' : '#b91c1c' }}>{a.direction.toUpperCase()}</strong>{' '}
                  {Number(a.tonnes).toLocaleString('en-GB', { maximumFractionDigits: 3 })} t {a.stock}
                  {a.note && <span className="muted"> — {a.note}</span>}
                </span>
                <button className="secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.8rem' }} onClick={() => deleteAdjustment(a)}>remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {view === 'forecast' && (
        <ForecastView year={year} section={section} rows={pos.rows} trips={trips} />
      )}

      {view === 'position' && (pos.nonquotaRows.length > 0 || pos.unmappedRows.length > 0) && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          {pos.nonquotaRows.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>Non-quota species ({year})</h3>
              <Scroll>
                <table style={{ borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead><tr><th style={th}>Species</th><th style={thR}>Logbook kg</th><th style={thR}>Since statement kg</th></tr></thead>
                  <tbody>
                    {pos.nonquotaRows.map(r => (
                      <tr key={r.fao}><td style={td}>{r.name} ({r.fao})</td><td style={tdR}>{kg0(r.kg)}</td><td style={tdR}>{r.sinceKg ? kg0(r.sinceKg) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </>
          )}
          {pos.unmappedRows.length > 0 && (
            <>
              <h3>Unmapped species/area combos</h3>
              <p className="muted" style={{ fontSize: '0.82rem' }}>These logbook entries didn't match an AFPO stock — tell me which line they should book to.</p>
              <ul style={{ marginBottom: 0 }}>
                {pos.unmappedRows.map(r => <li key={r.key}>{r.key} — {kg0(r.kg)} kg</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0, cursor: 'pointer' }} onClick={() => setShowTrips(s => !s)}>
          Trips loaded {showTrips ? '▾' : '▸'}
        </h3>
        {showTrips && (
          <Scroll>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th}>Trip nr</th><th style={th}>Departure</th><th style={th}>Arrival</th>
                  <th style={th}>Skipper</th><th style={thR}>Live kg</th><th style={th}>Reconciled</th>
                </tr>
              </thead>
              <tbody>
                {trips.map(t => (
                  <tr key={t.id}>
                    <td style={td}>{t.trip_nr}</td>
                    <td style={td}>{t.departure_port} {fmtDate((t.departure_at || '').slice(0, 10))}</td>
                    <td style={td}>{t.arrival_port} {fmtDate((t.arrival_at || '').slice(0, 10))}</td>
                    <td style={td}>{t.captain}</td>
                    <td style={tdR}>{kg0(t.total_live_kg)}</td>
                    <td style={td}>{t.reconcile_ok === true ? <Badge tone="ok">✓ matches report</Badge> : t.reconcile_ok === false ? <Badge tone="warn">mismatch</Badge> : '—'}</td>
                  </tr>
                ))}
                {!trips.length && <tr><td style={td} colSpan={6} className="muted">No trips yet.</td></tr>}
              </tbody>
            </table>
          </Scroll>
        )}
      </div>
    </div>
  )
}
