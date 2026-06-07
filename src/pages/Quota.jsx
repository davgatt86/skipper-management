import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { parseAfpoXlsx } from '../lib/quota/afpoParse'
import { parseTripPdf } from '../lib/quota/mcatchParse'
import { latestSnapshotByYear, buildPosition } from '../lib/quota/quotaAgg'

const fmtDate = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'
const t3 = n => n == null ? '—' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const kg0 = n => Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })

const th = { textAlign: 'left', padding: '0.45rem 0.6rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--navy)' }
const td = { padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right' }
const thR = { ...th, textAlign: 'right' }

function Scroll({ children }) {
  return <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>
}

function Badge({ tone, children }) {
  const colours = {
    official: { bg: '#eef4ff', fg: '#1d4ed8' },
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

export default function Quota() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'

  const [snapshots, setSnapshots] = useState([])
  const [trips, setTrips] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [section, setSection] = useState('all')
  const [showTrips, setShowTrips] = useState(false)

  const pushLog = m => setLog(l => [...l, m])

  async function loadAll() {
    const [snapRes, lineRes, tripRes, catchRes, adjRes] = await Promise.all([
      supabase.from('quota_snapshots').select('*').order('last_updated', { ascending: false }),
      supabase.from('quota_lines').select('*'),
      supabase.from('quota_trips').select('*').order('arrival_at', { ascending: false }),
      supabase.from('quota_trip_catches').select('*'),
      supabase.from('quota_adjustments').select('*').order('created_at'),
    ])
    const err = snapRes.error || lineRes.error || tripRes.error || catchRes.error || adjRes.error
    if (err) { setError(err.message); return }
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
        const res = await parseTripPdf(f)
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
    const arr = [...ys].sort().reverse()
    return arr.length ? arr : [String(new Date().getFullYear())]
  }, [latestByYear, trips])
  useEffect(() => { if (!years.includes(year)) setYear(years[0]) }, [years]) // eslint-disable-line

  const snapshot = latestByYear[year]
  const pos = useMemo(() => buildPosition({ snapshot, trips, year, adjustments }), [snapshot, trips, year, adjustments])

  const sections = useMemo(() => [...new Set(pos.rows.map(r => r.section))], [pos.rows])
  const visRows = useMemo(() => {
    let rows = pos.rows.filter(r => section === 'all' ? true : r.section === section)
    if (section === 'all') rows = rows.filter(r => (r.allocation || 0) !== 0 || (r.catch_total || 0) !== 0 || r.since_t !== 0 || r.adj_t !== 0)
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

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Quota</h1>
          <p className="muted" style={{ marginBottom: 0 }}>AFPO holdings vs logbook catch</p>
        </div>
        <Link to="/">← Dashboard</Link>
      </header>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <UploadBtn label="Upload AFPO holdings (.xlsx)" accept=".xlsx,.xls" multiple busy={busy} onFiles={uploadAfpo} />
          <UploadBtn label="Upload trip reports (.pdf)" accept="application/pdf" multiple busy={busy} onFiles={uploadTrips} />
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {snapshots.length} statement{snapshots.length === 1 ? '' : 's'} · {trips.length} trip{trips.length === 1 ? '' : 's'} loaded
          </span>
        </div>
        {log.length > 0 && (
          <ul style={{ marginTop: '0.7rem', marginBottom: 0, paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
            {log.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
          <select value={year} onChange={e => setYear(e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={section} onChange={e => setSection(e.target.value)}>
            <option value="all">Active stocks</option>
            {sections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {snapshot
            ? <Badge tone="official">official as of {fmtDate(snapshot.last_landing_date)}</Badge>
            : <Badge tone="warn">no AFPO statement for {year}</Badge>}
          {pos.sinceTrips > 0 && <Badge tone="est">estimated now: {pos.sinceTrips} trip{pos.sinceTrips === 1 ? '' : 's'} since statement</Badge>}
          {pos.sinceTrips === 0 && snapshot && <Badge tone="ok">no landings since statement</Badge>}
        </div>

        <Scroll>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={th}>Stock</th>
                <th style={thR}>Allocation t</th>
                <th style={thR}>Catch UK t</th>
                <th style={thR}>Catch NOR t</th>
                <th style={thR}>Balance t</th>
                <th style={thR}>Since stmt t</th>
                <th style={thR}>Swaps t</th>
                <th style={thR}>Est. balance t</th>
              </tr>
            </thead>
            <tbody>
              {visRows.map(r => {
                const est = r.est_balance
                const warn = est != null && est < 0
                const near = est != null && !warn && r.allocation > 0 && est < r.allocation * 0.1
                return (
                  <tr key={r.section + r.stock}>
                    <td style={td}>
                      {r.stock}
                      {section === 'all' && <span className="muted" style={{ fontSize: '0.75rem' }}> · {r.section}</span>}
                    </td>
                    <td style={tdR}>{t3(r.allocation)}</td>
                    <td style={tdR}>{t3(r.catch_uk)}</td>
                    <td style={tdR}>{t3(r.catch_nor)}</td>
                    <td style={tdR}>{t3(r.balance)}</td>
                    <td style={tdR}>{r.since_t ? t3(r.since_t) : '—'}</td>
                    <td style={{ ...tdR, color: r.adj_t > 0 ? '#15803d' : r.adj_t < 0 ? '#b91c1c' : 'inherit' }}>
                      {r.adj_t ? (r.adj_t > 0 ? '+' : '') + t3(r.adj_t) : '—'}
                    </td>
                    <td style={{ ...tdR, fontWeight: 700, color: warn ? '#b91c1c' : near ? '#c2410c' : 'var(--navy)' }}>
                      {t3(est)}
                    </td>
                  </tr>
                )
              })}
              {!visRows.length && <tr><td style={td} colSpan={8} className="muted">Nothing to show — upload an AFPO statement and trip reports.</td></tr>}
            </tbody>
          </table>
        </Scroll>
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
          Est. balance = AFPO balance, minus logbook catch from trips landed after {snapshot ? fmtDate(snapshot.last_landing_date) : 'the statement date'}.
          Year-straddling trips book each catch to its catch date's year. What-if swaps & rentals below also feed the Est. balance.
        </p>
      </div>

      {isSkipper && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Swaps & rentals — what-if ({year})</h3>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Try a swap or rental before it's official — e.g. 20t NS Cod OUT for 100t NS Saithe IN.
            Either side can be left blank for a one-way rental. Entries adjust the Est. balance column until you remove them.
          </p>
          <form onSubmit={addAdjustment} style={{ display: 'grid', gap: '0.5rem', maxWidth: 560 }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ width: 36, fontWeight: 700, color: '#b91c1c' }}>OUT</span>
              <select value={outStock} onChange={e => setOutStock(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
                <option value="">— stock —</option>
                {(snapshot?.lines || []).map(l => <option key={l.id || l.stock} value={l.stock}>{l.stock}</option>)}
              </select>
              <input type="number" min="0.001" step="0.001" placeholder="tonnes" value={outT} onChange={e => setOutT(e.target.value)} style={{ width: 110 }} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ width: 36, fontWeight: 700, color: '#15803d' }}>IN</span>
              <select value={inStock} onChange={e => setInStock(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
                <option value="">— stock —</option>
                {(snapshot?.lines || []).map(l => <option key={l.id || l.stock} value={l.stock}>{l.stock}</option>)}
              </select>
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
      )}

      {(pos.nonquotaRows.length > 0 || pos.unmappedRows.length > 0) && (
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
