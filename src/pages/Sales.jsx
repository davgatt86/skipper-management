import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { parseSalesPdf, dedupKey } from '../lib/parseCore'
import { kpis, bySpecies, gradesFor, byBuyer, buyerSpecies, buyerSpeciesGrades, monthlySeries, landingSeries, shortMarket, autoSplitA4Haddock, r2 } from '../lib/salesAgg'
import { exportSalesExcel } from '../lib/salesExcel'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from 'recharts'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const gbp = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const gbp0 = n => '£' + Math.round(Number(n || 0)).toLocaleString('en-GB')
const num = n => Number(n || 0).toLocaleString('en-GB')
const fmtDate = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'

const th = { textAlign: 'left', padding: '0.45rem 0.6rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--navy)' }
const td = { padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right' }
const thR = { ...th, textAlign: 'right' }

function Scroll({ children }) {
  return <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>
}

function Kpi({ label, value, sub }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.8rem 1rem', minWidth: 0 }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--navy)' }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: '0.8rem' }}>{sub}</div>}
    </div>
  )
}

export default function Sales() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const canView = isSkipper || appUser?.role === 'viewer'

  const [landings, setLandings] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // scope
  const [mode, setMode] = useState('year')          // 'year' | 'month' | 'landing'
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [landingId, setLandingId] = useState('')

  // drill-downs
  const [openSpecies, setOpenSpecies] = useState('')
  const [openBuyer, setOpenBuyer] = useState('')

  // upload
  const [busy, setBusy] = useState(false)
  const [uploadLog, setUploadLog] = useState([])

  async function loadLandings() {
    const { data, error } = await supabase.from('sales_landings').select('*')
      .order('landing_date', { ascending: false }).order('created_at', { ascending: false })
    if (error) { setError(error.message); return [] }
    setLandings(data || [])
    return data || []
  }
  useEffect(() => { loadLandings().then(() => setLoading(false)) }, [])

  const years = useMemo(() => {
    const ys = [...new Set(landings.map(l => (l.landing_date || '').slice(0, 4)).filter(Boolean))].sort().reverse()
    return ys.length ? ys : [String(new Date().getFullYear())]
  }, [landings])

  const scopeLandings = useMemo(() => {
    if (mode === 'landing') return landings.filter(l => l.id === landingId)
    if (mode === 'month') return landings.filter(l => (l.landing_date || '').startsWith(`${year}-${month}`))
    return landings.filter(l => (l.landing_date || '').startsWith(year))
  }, [landings, mode, year, month, landingId])

  const landingById = useMemo(() => Object.fromEntries(landings.map(l => [l.id, l])), [landings])

  const scopeLabel = useMemo(() => {
    if (mode === 'landing') {
      const l = landingById[landingId]
      return l ? `${l.vessel} ${fmtDate(l.landing_date)} ${shortMarket(l.market)}${l.sale_no ? ' #' + l.sale_no : ''}` : 'Landing'
    }
    if (mode === 'month') return `${MONTHS[Number(month) - 1]} ${year}`
    return year
  }, [mode, year, month, landingId, landingById])

  // fetch rows for the current scope (chunked .in + paginated)
  useEffect(() => {
    let cancel = false
    async function go() {
      const ids = scopeLandings.map(l => l.id)
      if (!ids.length) { setRows([]); return }
      setRowsLoading(true)
      const out = []
      try {
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50)
          let from = 0
          for (;;) {
            const { data, error } = await supabase.from('sales_rows').select('*').in('landing_id', chunk).range(from, from + 999)
            if (error) throw error
            out.push(...(data || []))
            if (!data || data.length < 1000) break
            from += 1000
          }
        }
        if (!cancel) setRows(out)
      } catch (e) { if (!cancel) setError(e.message) }
      if (!cancel) setRowsLoading(false)
    }
    go()
    return () => { cancel = true }
  }, [scopeLandings])

  /* ---------------- upload ---------------- */
  async function onUpload(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setBusy(true); setUploadLog([]); setError('')
    const log = []
    const existing = new Set(landings.map(l => l.dedup_key))
    for (const f of files) {
      try {
        const res = await parseSalesPdf(f)
        if (!res.rows.length) { log.push(`✗ ${f.name}: no rows parsed (${res.market})`); continue }
        const key = dedupKey(res)
        if (existing.has(key)) { log.push(`– ${f.name}: already imported, skipped`); continue }
        const rec = res.reconcile || {}
        const tot = rec.actual || { boxes: 0, weight: 0, value: 0 }
        const { data: ins, error: e1 } = await supabase.from('sales_landings').insert({
          dedup_key: key, vessel: res.meta.vessel || '', market: res.market || '', port: res.meta.port || '',
          sale_no: res.meta.saleNo || '', landing_date: res.meta.isoDate || null, filename: f.name,
          boxes: tot.boxes, weight_kg: tot.weight, value: tot.value,
          consigned: !!res.meta.consigned, reconcile_ok: rec.found ? rec.ok : null
        }).select('id').single()
        if (e1) throw e1
        const payload = res.rows.map(r => ({
          landing_id: ins.id, buyer: r.buyer || '', species: r.species || '', species_canon: r.species_canon || r.species || '',
          presentation: r.presentation || '', grade: r.grade || '', boxes: r.boxes || 0, box_weight: r.box_weight || 0,
          weight_kg: r.total_weight || 0, price_per_kg: r.price_per_kg || 0, price_per_box: r.price_per_box || 0,
          value: r.total_value || 0, msc: !!r.msc
        }))
        for (let i = 0; i < payload.length; i += 500) {
          const { error: e2 } = await supabase.from('sales_rows').insert(payload.slice(i, i + 500))
          if (e2) throw e2
        }
        existing.add(key)
        const warn = rec.found && !rec.ok ? `  ⚠ totals differ from the note's printed TOTAL (£ ${rec.diffs.value >= 0 ? '+' : ''}${rec.diffs.value})` : ''
        const fed = await feedCrewLanding(res.meta.isoDate, tot.boxes, key)
        log.push(`✓ ${f.name}: ${res.meta.vessel} ${fmtDate(res.meta.isoDate)} — ${num(tot.boxes)} bx, ${gbp(tot.value)}${warn}${fed}`)
      } catch (err) {
        log.push(`✗ ${f.name}: ${err.message}`)
      }
      setUploadLog([...log])
    }
    await loadLandings()
    setBusy(false)
  }

  /* After a sales note imports, feed its box total into the crew-bonus
   * landing for that date (sum across joint-trip notes; never twice for
   * the same note thanks to sales_keys; locked months left alone). */
  async function feedCrewLanding(date, boxes, key) {
    if (!isSkipper || !date || !boxes) return ''
    const { data: existing, error } = await supabase.from('landings')
      .select('id, boxes, locked, sales_keys, landing_crew(crew_id)').eq('landing_date', date)
    if (error) return ` (crew landing: ${error.message})`
    const l = (existing || [])[0]
    if (l) {
      let healed = ''
      // self-heal landings that lost their crew (duplicate-key bug)
      if (!l.locked && (l.landing_crew || []).length === 0) {
        const aboard = await aboardOnDate(date)
        if (aboard.length) {
          const { error: he } = await supabase.from('landing_crew')
            .upsert(aboard.map(crew_id => ({ landing_id: l.id, crew_id })),
                    { onConflict: 'landing_id,crew_id', ignoreDuplicates: true })
          if (!he) healed = ` — re-added ${aboard.length} crew aboard`
          else healed = ` (crew re-add failed: ${he.message})`
        }
      }
      if ((l.sales_keys || []).includes(key)) return healed
      if (l.locked) return ' — crew landing locked (month closed), not updated'
      const { error: e } = await supabase.from('landings')
        .update({ boxes: Math.round((Number(l.boxes || 0) + Number(boxes)) * 100) / 100, sales_keys: [...(l.sales_keys || []), key] })
        .eq('id', l.id)
      return e ? ` (crew landing: ${e.message})` : ` → crew landing +${num(boxes)} bx${healed}`
    }
    const aboard = await aboardOnDate(date)
    if (!aboard.length) return ' — no crew marked on boat, crew landing not created'
    const { data: ins, error: ie } = await supabase.from('landings')
      .insert({ fleet_id: appUser.fleet_id, landing_date: date, boxes: Number(boxes), notes: 'Auto from sales notes', locked: false, created_by: appUser.id, sales_keys: [key] })
      .select('id').single()
    if (ie) return ` (crew landing: ${ie.message})`
    const { error: lce } = await supabase.from('landing_crew')
      .upsert(aboard.map(crew_id => ({ landing_id: ins.id, crew_id })),
              { onConflict: 'landing_id,crew_id', ignoreDuplicates: true })
    if (lce) return ` (crew aboard failed: ${lce.message} — edit the landing)`
    return ` → crew landing created (${num(boxes)} bx, ${aboard.length} crew aboard)`
  }

  // Crew aboard for a landing date = crew with an agency contract covering
  // it; falls back to contracted on-boat crew. Self-employed rotation crew
  // never earn box bonus so they're excluded from both paths.
  async function aboardOnDate(date) {
    const [ctRes, cRes] = await Promise.all([
      supabase.from('contracts').select('crew_id, start_date, end_date'),
      supabase.from('crew').select('id, status, archived_at, crew_type'),
    ])
    const crewRows = (cRes.data || []).filter(c => !c.archived_at)
    const live = new Set(crewRows.map(c => c.id))
    const ids = [...new Set((ctRes.data || [])
      .filter(ct => ct.start_date <= date && (!ct.end_date || date <= ct.end_date))
      .map(ct => ct.crew_id))].filter(id => live.has(id))
    if (ids.length) return ids
    return crewRows.filter(c => c.status === 'on_boat' && c.crew_type !== 'self_employed').map(c => c.id)
  }

  async function deleteLanding(l) {
    if (!window.confirm(`Delete landing ${l.vessel} ${fmtDate(l.landing_date)} (${num(l.boxes)} boxes, ${gbp(l.value)})? Rows are removed too.`)) return
    const { error } = await supabase.from('sales_landings').delete().eq('id', l.id)
    if (error) { setError(error.message); return }
    setMode('year'); setLandingId('')
    await loadLandings()
  }

  /* ---------------- A4 haddock split ---------------- */
  const a4Rows = useMemo(() => mode === 'landing'
    ? rows.filter(r => (r.species_canon || r.species) === 'Haddock' && r.grade === 'A4')
    : [], [rows, mode])

  async function saveSubGrades(updates) {
    for (const u of updates) {
      const { error } = await supabase.from('sales_rows').update({ sub_grade: u.sub_grade }).eq('id', u.id)
      if (error) { setError(error.message); return }
    }
    setRows(rows.map(r => {
      const u = updates.find(x => x.id === r.id)
      return u ? { ...r, sub_grade: u.sub_grade } : r
    }))
  }
  async function autoSplit() {
    const res = autoSplitA4Haddock(rows)
    if (res.error) { setNotice(res.error); return }
    await saveSubGrades(res.updates)
    setNotice(`Auto-split done — Mini Metro ≤ £${res.bands.miniMax}/kg, Metro ≤ £${res.bands.metroMax}/kg, Chipper above.`)
  }

  /* ---------------- derived ---------------- */
  const k = useMemo(() => kpis(rows, scopeLandings.length), [rows, scopeLandings])
  const speciesTbl = useMemo(() => bySpecies(rows), [rows])
  const buyersTbl = useMemo(() => byBuyer(rows), [rows])
  const monthly = useMemo(() => mode === 'year' ? monthlySeries(rows, landingById, year) : [], [rows, mode, year, landingById])
  const perLanding = useMemo(() => mode === 'month' ? landingSeries(scopeLandings) : [], [mode, scopeLandings])
  const speciesChart = useMemo(() => speciesTbl.slice(0, 10).map(s => ({ label: s.species, value: s.value, kg: r2(s.kg / 1000) })), [speciesTbl])

  if (!canView) {
    return <div className="container"><p className="muted">Skipper access only. <Link to="/">← Back</Link></p></div>
  }

  return (
    <div className="container">
      <header className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Fish Sales</h1>
          <p className="muted"><Link to="/">← Dashboard</Link></p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="secondary" onClick={() => exportSalesExcel({ scopeLabel, rows, landings: scopeLandings, landingById })} disabled={!rows.length}>Excel</button>
          <button className="secondary" onClick={() => window.print()} disabled={!rows.length}>PDF / Print</button>
        </div>
      </header>

      {/* scope selector */}
      <div className="card no-print" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={mode} onChange={e => { setMode(e.target.value); setOpenSpecies(''); setOpenBuyer('') }} style={{ width: 'auto' }}>
          <option value="year">Annual</option>
          <option value="month">Monthly</option>
          <option value="landing">Single landing</option>
        </select>
        {(mode === 'year' || mode === 'month') && (
          <select value={year} onChange={e => setYear(e.target.value)} style={{ width: 'auto' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {mode === 'month' && (
          <select value={month} onChange={e => setMonth(e.target.value)} style={{ width: 'auto' }}>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
        )}
        {mode === 'landing' && (
          <select value={landingId} onChange={e => setLandingId(e.target.value)} style={{ width: 'auto', maxWidth: '100%' }}>
            <option value="">— pick a landing —</option>
            {landings.map(l => (
              <option key={l.id} value={l.id}>
                {fmtDate(l.landing_date)} · {l.vessel} · {shortMarket(l.market)} · {gbp0(l.value)}
              </option>
            ))}
          </select>
        )}
        {rowsLoading && <span className="muted">loading…</span>}
      </div>

      {error && <p className="error">Error: {error}</p>}
      {notice && <p className="success" onClick={() => setNotice('')}>{notice}</p>}

      <div id="sales-report">
        <h2 className="print-only" style={{ display: 'none' }}>Fish Sales — {scopeLabel}</h2>

        {/* KPIs */}
        <div className="card">
          <h2>{scopeLabel}</h2>
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <Kpi label="Total sales" value={gbp0(k.value)} />
            <Kpi label="Tonnage" value={num(r2(k.kg / 1000)) + ' t'} sub={num(k.kg) + ' kg'} />
            <Kpi label="Boxes" value={num(k.boxes)} />
            <Kpi label="Average £/kg" value={gbp(k.pkg)} />
            <Kpi label="Landings" value={num(k.landings)} />
          </div>
        </div>

        {/* charts */}
        {mode === 'year' && rows.length > 0 && (
          <div className="card">
            <h2>£ and tonnage by month</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" /><YAxis tickFormatter={v => '£' + (v / 1000) + 'k'} />
                <Tooltip formatter={v => gbp0(v)} />
                <Bar dataKey="value" name="£" fill="#1F3864" />
              </BarChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" /><YAxis />
                <Tooltip formatter={v => v + ' t'} />
                <Line dataKey="kg" name="tonnes" stroke="#2E75B6" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {mode === 'month' && perLanding.length > 0 && (
          <div className="card">
            <h2>£ by landing</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={perLanding}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" /><YAxis tickFormatter={v => '£' + (v / 1000) + 'k'} />
                <Tooltip formatter={v => gbp0(v)} />
                <Bar dataKey="value" name="£" fill="#1F3864" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {rows.length > 0 && (
          <div className="card">
            <h2>Species mix (£, top 10)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={speciesChart} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={v => '£' + (v / 1000) + 'k'} />
                <YAxis type="category" dataKey="label" width={90} />
                <Tooltip formatter={v => gbp0(v)} />
                <Bar dataKey="value" name="£" fill="#70AD47" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* species table with grade drill-down */}
        <div className="card">
          <h2>Species <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>(tap a species for grade breakdown)</span></h2>
          <Scroll>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={th}>Species</th><th style={thR}>Boxes</th><th style={thR}>Kg</th><th style={thR}>£</th><th style={thR}>£/kg</th></tr></thead>
              <tbody>
                {speciesTbl.map(s => (
                  <SpeciesRow key={s.species} s={s} open={openSpecies === s.species}
                    onToggle={() => setOpenSpecies(openSpecies === s.species ? '' : s.species)} rows={rows} />
                ))}
              </tbody>
            </table>
          </Scroll>
        </div>

        {/* buyers */}
        <div className="card">
          <h2>Buyers <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>(tap a buyer for what they bought)</span></h2>
          <Scroll>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={th}>Buyer</th><th style={thR}>Boxes</th><th style={thR}>Kg</th><th style={thR}>£</th><th style={thR}>£/kg</th><th style={th}>Top species</th></tr></thead>
              <tbody>
                {buyersTbl.map(b => (
                  <BuyerRow key={b.buyer} b={b} open={openBuyer === b.buyer}
                    onToggle={() => setOpenBuyer(openBuyer === b.buyer ? '' : b.buyer)} rows={rows} />
                ))}
              </tbody>
            </table>
          </Scroll>
        </div>

        {/* landings in scope */}
        {mode !== 'landing' && (
          <div className="card">
            <h2>Landings</h2>
            <Scroll>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>Date</th><th style={th}>Vessel</th><th style={th}>Market</th><th style={thR}>Boxes</th><th style={thR}>Kg</th><th style={thR}>£</th><th style={th}></th></tr></thead>
                <tbody>
                  {scopeLandings.map(l => (
                    <tr key={l.id}>
                      <td style={td}>{fmtDate(l.landing_date)}{l.consigned ? ' (consigned)' : ''}</td>
                      <td style={td}>{l.vessel}</td>
                      <td style={td}>{l.market}{l.reconcile_ok === false ? ' ⚠' : ''}</td>
                      <td style={tdR}>{num(l.boxes)}</td>
                      <td style={tdR}>{num(l.weight_kg)}</td>
                      <td style={tdR}>{gbp0(l.value)}</td>
                      <td style={{ ...td }} className="no-print">
                        <a href="#view" onClick={e => { e.preventDefault(); setMode('landing'); setLandingId(l.id) }}>view</a>
                      </td>
                    </tr>
                  ))}
                  {!scopeLandings.length && <tr><td style={td} colSpan={7} className="muted">No landings in this period yet.</td></tr>}
                </tbody>
              </table>
            </Scroll>
          </div>
        )}

        {/* A4 haddock split — single landing scope */}
        {mode === 'landing' && a4Rows.length > 0 && (
          <div className="card">
            <h2>A4 haddock split <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>Mini Metro / Metro / Chipper</span></h2>
            {isSkipper && <div className="no-print" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <button className="secondary" onClick={autoSplit}>Auto-split by price bands</button>
              <button className="secondary" onClick={() => saveSubGrades(a4Rows.map(r => ({ id: r.id, sub_grade: null })))}>Clear split</button>
            </div>}
            <Scroll>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>Buyer</th><th style={thR}>Boxes</th><th style={thR}>£/kg</th><th style={th}>Sub-grade</th></tr></thead>
                <tbody>
                  {[...a4Rows].sort((a, b) => b.price_per_kg - a.price_per_kg).map(r => (
                    <tr key={r.id}>
                      <td style={td}>{r.buyer}</td>
                      <td style={tdR}>{num(r.boxes)}</td>
                      <td style={tdR}>{gbp(r.price_per_kg)}</td>
                      <td style={td}>
                        <select className="no-print" disabled={!isSkipper} value={r.sub_grade || ''} onChange={e => saveSubGrades([{ id: r.id, sub_grade: e.target.value || null }])} style={{ width: 'auto', padding: '0.25rem 0.5rem' }}>
                          <option value="">—</option>
                          <option>Chipper</option>
                          <option>Metro</option>
                          <option>Mini Metro</option>
                        </select>
                        <span className="print-only" style={{ display: 'none' }}>{r.sub_grade || '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          </div>
        )}

        {isSkipper && mode === 'landing' && landingId && landingById[landingId] && (
          <div className="card no-print">
            <button className="secondary" style={{ color: 'var(--red)' }} onClick={() => deleteLanding(landingById[landingId])}>Delete this landing</button>
          </div>
        )}
      </div>

      {/* upload */}
      {isSkipper && <div className="card no-print">
        <h2>Import sales notes</h2>
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          Upload Don Fishing / Scrabster / Hanstholm / Shetland PDFs — duplicates are skipped automatically and totals are checked against each note's printed TOTAL.
        </p>
        <input type="file" accept="application/pdf" multiple onChange={onUpload} disabled={busy} />
        {busy && <p className="muted" style={{ marginTop: '0.5rem' }}>Parsing…</p>}
        {uploadLog.length > 0 && (
          <ul style={{ listStyle: 'none', marginTop: '0.75rem', fontSize: '0.9rem' }}>
            {uploadLog.map((l, i) => <li key={i} style={{ padding: '0.15rem 0' }}>{l}</li>)}
          </ul>
        )}
      </div>}

      {loading && <p className="muted">Loading…</p>}
    </div>
  )
}

function SpeciesRow({ s, open, onToggle, rows }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={{ ...td, fontWeight: 600, color: 'var(--navy)' }}>{open ? '▾ ' : '▸ '}{s.species}</td>
        <td style={tdR}>{num(s.boxes)}</td>
        <td style={tdR}>{num(s.kg)}</td>
        <td style={tdR}>{gbp0(s.value)}</td>
        <td style={tdR}>{gbp(s.pkg)}</td>
      </tr>
      {open && gradesFor(rows, s.species).map(g => (
        <tr key={g.grade} style={{ background: 'var(--grey-50)' }}>
          <td style={{ ...td, paddingLeft: '1.8rem' }}>{g.grade}</td>
          <td style={tdR}>{num(g.boxes)}</td>
          <td style={tdR}>{num(g.kg)}</td>
          <td style={tdR}>{gbp0(g.value)}</td>
          <td style={tdR}>{gbp(g.pkg)}</td>
        </tr>
      ))}
    </>
  )
}

function BuyerRow({ b, open, onToggle, rows }) {
  const [openSp, setOpenSp] = useState('')
  return (
    <>
      <tr onClick={() => { onToggle(); setOpenSp('') }} style={{ cursor: 'pointer' }}>
        <td style={{ ...td, fontWeight: 600, color: 'var(--navy)' }}>{open ? '▾ ' : '▸ '}{b.buyer}</td>
        <td style={tdR}>{num(b.boxes)}</td>
        <td style={tdR}>{num(b.kg)}</td>
        <td style={tdR}>{gbp0(b.value)}</td>
        <td style={tdR}>{gbp(b.pkg)}</td>
        <td style={td} className="muted">{b.top}</td>
      </tr>
      {open && buyerSpecies(rows, b.buyer).map(sp => (
        <SpRows key={sp.species} buyer={b.buyer} sp={sp} rows={rows}
          open={openSp === sp.species}
          onToggle={() => setOpenSp(openSp === sp.species ? '' : sp.species)} />
      ))}
    </>
  )
}

function SpRows({ buyer, sp, rows, open, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} style={{ background: 'var(--grey-50)', cursor: 'pointer' }}>
        <td style={{ ...td, paddingLeft: '1.8rem', fontWeight: 600 }}>{open ? '▾ ' : '▸ '}{sp.species}</td>
        <td style={tdR}>{num(sp.boxes)}</td>
        <td style={tdR}>{num(sp.kg)}</td>
        <td style={tdR}>{gbp0(sp.value)}</td>
        <td style={tdR}>{gbp(sp.pkg)}</td>
        <td style={td}></td>
      </tr>
      {open && buyerSpeciesGrades(rows, buyer, sp.species).map(g => (
        <tr key={g.grade} style={{ background: 'var(--grey-50)' }}>
          <td style={{ ...td, paddingLeft: '3.4rem' }} className="muted">{g.grade}</td>
          <td style={tdR}>{num(g.boxes)}</td>
          <td style={tdR}>{num(g.kg)}</td>
          <td style={tdR}>{gbp0(g.value)}</td>
          <td style={tdR}>{gbp(g.pkg)}</td>
          <td style={td}></td>
        </tr>
      ))}
    </>
  )
}
