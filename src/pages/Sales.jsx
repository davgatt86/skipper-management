import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { parseSalesPdf, dedupKey, applyFxRate } from '../lib/parseCore'
// Shared with netlify/functions/ingest.js — the two upload paths must merge
// buyer names identically, and they were two inline copies of the same code.
import { canonBuyerFrom } from '../lib/buyerAliases'
import { kpis, bySpecies, gradesFor, byBuyer, buyerSpecies, buyerSpeciesGrades, monthlySeries, landingSeries, shortMarket, autoSplitA4Haddock, splitA4ByTotals, r2,
  withShares, SALES_SCOPES, scopeRows, scopeLandingIds, byVessel, pairedDays,
  samedayPriceGap, speciesMixDivergence, vesselMarketSplit } from '../lib/salesAgg'
import { exportSalesExcel } from '../lib/salesExcel'
import AppShell from '../AppShell'
import ReconcileBanner from '../ReconcileBanner'
import PageHeader from '../PageHeader'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from 'recharts'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const gbp = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const gbp0 = n => '£' + Math.round(Number(n || 0)).toLocaleString('en-GB')
const num = n => Number(n || 0).toLocaleString('en-GB')
const fmtDate = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'

// What a failed parse actually got wrong. Landings ingested before Aug 2026
// carry no reconcile_diff, and there is no way to recover it without the
// original note — so say that rather than showing a bare warning triangle.
// P&J prints a physical box count that never ties to the fractional column, so
// its box gap is information, not a failure (see reconcilePJJ in parse-core).
function reconcileNote(l) {
  if (l?.reconcile_ok !== false) return ''
  const d = l.reconcile_diff?.diffs
  if (!d) return 'This note did not match its own printed total. Detail was not recorded at the time, so it cannot be narrowed down without the original.'
  const parts = []
  if (d.value) parts.push(`value out by ${gbp(d.value)}`)
  if (d.weight) parts.push(`weight out by ${num(d.weight)} kg`)
  if (d.boxes && l.reconcile_diff.basis !== 'physical') parts.push(`boxes out by ${num(d.boxes)}`)
  return parts.length
    ? `Parsed rows against the note's printed total: ${parts.join(', ')}.`
    : 'Flagged, but the parsed rows agree with the printed total.'
}

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
  // Danish sales come through Hanstholm with no buyer names and in DKK, so
  // whether they are in or out has to be a choice, not an assumption.
  const [scope, setScope] = useState('all')         // 'all' | 'uk' | 'dk'
  // What the percentages are a share OF. £ answers "what drove the gross".
  const [basis, setBasis] = useState('value')       // 'value' | 'kg' | 'boxes'
  // '' = the pair combined. Otherwise one boat, and the WHOLE page follows it.
  const [vessel, setVessel] = useState('')

  // drill-downs
  const [openSpecies, setOpenSpecies] = useState('')
  const [openBuyer, setOpenBuyer] = useState('')

  // upload
  const [busy, setBusy] = useState(false)
  const [uploadLog, setUploadLog] = useState([])

  async function loadLandings() {
    const all = []
    let from = 0
    for (;;) {
      const { data, error } = await supabase.from('sales_landings').select('*')
        .order('landing_date', { ascending: false }).order('created_at', { ascending: false })
        .range(from, from + 999)
      if (error) { setError(error.message); return [] }
      all.push(...(data || []))
      if (!data || data.length < 1000) break
      from += 1000
    }
    setLandings(all)
    return all
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

  // Everything downstream works off the SCOPED rows, so a percentage is always
  // a share of what is on screen. Change UK/Denmark and every denominator —
  // and every KPI — moves with it.
  const scopedRows = useMemo(() => scopeRows(rows, landingById, scope), [rows, landingById, scope])
  const scopedLandings = useMemo(() => scopeLandingIds(scopeLandings, scope), [scopeLandings, scope])

  // Every vessel in scope, so the picker only appears for a real pair.
  const vesselNames = useMemo(
    () => [...new Set(scopedLandings.map(l => l.vessel).filter(Boolean))].sort(),
    [scopedLandings]
  )
  const isPair = vesselNames.length > 1

  // The pair comparison always works off BOTH boats — narrowing to one and
  // then comparing it with itself would be meaningless.
  const pairRows = scopedRows
  const pairLandings = scopedLandings

  // Everything else follows the vessel picker.
  const inScope = useMemo(
    () => (vessel ? scopedRows.filter(r => landingById[r.landing_id]?.vessel === vessel) : scopedRows),
    [scopedRows, vessel, landingById]
  )
  const landingsInScope = useMemo(
    () => (vessel ? scopedLandings.filter(l => l.vessel === vessel) : scopedLandings),
    [scopedLandings, vessel]
  )

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
    const byKey = new Map(landings.map(l => [l.dedup_key, l.id]))

    // This fleet's buyer merges, loaded once for the whole upload. RLS scopes
    // the read to the fleet, so no filter is needed here. The matching itself
    // is shared with the CloudMailin webhook — see src/lib/buyerAliases.js.
    const { data: buyerFlags } = await supabase
      .from('sales_buyer_flags').select('canonical_name, aliases').not('canonical_name', 'is', null)
    const canonBuyer = canonBuyerFrom(buyerFlags)
    for (const f of files) {
      try {
        let res = await parseSalesPdf(f)
        if (!res.rows.length) { log.push(`✗ ${f.name}: no rows parsed (${res.market})`); continue }
        // Danish (Hanstholm Afregning) notes are priced in DKK — ask for the
        // day's rate for this note, then convert to £ (rate stays editable later).
        let fxRate = null
        if (res.meta.currency === 'DKK') {
          const ans = window.prompt(`${f.name}\nDanish (DKK) note — gross ${Math.round(res.meta.grossDkk || 0).toLocaleString()} DKK.\nEnter the day's exchange rate for this note (DKK per £1), e.g. 8.75:`, '')
          const rate = Number(ans)
          if (!rate || rate <= 0) { log.push(`– ${f.name}: skipped (no DKK rate entered)`); continue }
          res = await applyFxRate(res, rate); fxRate = rate
        }
        const key = dedupKey(res)
        const rec = res.reconcile || {}
        const tot = rec.actual || { boxes: 0, weight: 0, value: 0 }
        const landingFields = {
          dedup_key: key, vessel: res.meta.vessel || '', market: res.market || '', port: res.meta.port || '',
          sale_no: res.meta.saleNo || '', landing_date: res.meta.isoDate || null, filename: f.name,
          boxes: tot.boxes, weight_kg: tot.weight, value: tot.value,
          consigned: !!res.meta.consigned, reconcile_ok: rec.found ? rec.ok : null,
          // See supabase/sales_reconcile_diff.sql — the landing totals are the
          // row sum, so the note's printed TOTAL is the only real check.
          reconcile_diff: rec.found
            ? { expected: rec.expected, actual: rec.actual, diffs: rec.diffs, basis: rec.boxBasis || null }
            : null,
          currency: res.meta.currency || null, fx_rate: fxRate
        }
        // Re-uploading a note that's already imported RE-PARSES and replaces its
        // rows in place (keeps the landing id, so days-at-sea and crew links
        // survive), so a parser fix propagates by just re-uploading — no delete.
        const dupId = byKey.get(key)
        let landingId
        if (dupId) {
          landingId = dupId
          const { error: eu } = await supabase.from('sales_landings').update(landingFields).eq('id', landingId)
          if (eu) throw eu
          const { error: ed } = await supabase.from('sales_rows').delete().eq('landing_id', landingId)
          if (ed) throw ed
        } else {
          const { data: ins, error: e1 } = await supabase.from('sales_landings').insert(landingFields).select('id').single()
          if (e1) throw e1
          landingId = ins.id; byKey.set(key, landingId)
        }
        // Same buyer merge as the email ingest — see netlify/functions/ingest.js.
        // Both paths write sales_rows, so a merge applied on only one of them
        // gets undone the first time a note is uploaded the other way.
        const payload = res.rows.map(r => ({
          landing_id: landingId, buyer: canonBuyer(r.buyer), species: r.species || '', species_canon: r.species_canon || r.species || '',
          presentation: r.presentation || '', grade: r.grade || '', boxes: r.boxes || 0, box_weight: r.box_weight || 0,
          weight_kg: r.total_weight || 0, price_per_kg: r.price_per_kg || 0, price_per_box: r.price_per_box || 0,
          value: r.total_value || 0, msc: !!r.msc,
          value_dkk: r.value_dkk != null ? r.value_dkk : null, ppk_dkk: r.ppk_dkk != null ? r.ppk_dkk : null
        }))
        for (let i = 0; i < payload.length; i += 500) {
          const { error: e2 } = await supabase.from('sales_rows').insert(payload.slice(i, i + 500))
          if (e2) throw e2
        }
        const warn = rec.found && !rec.ok ? `  ⚠ totals differ from the note's printed TOTAL (£ ${rec.diffs.value >= 0 ? '+' : ''}${rec.diffs.value})` : ''
        const fed = await feedCrewLanding(res.meta.isoDate, tot.boxes, key)
        log.push(`✓ ${f.name}: ${res.meta.vessel} ${fmtDate(res.meta.isoDate)} — ${num(tot.boxes)} bx, ${gbp(tot.value)}${dupId ? ' ↻ re-parsed' : ''}${warn}${fed}`)
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
    const rows = existing || []
    // If ANY landing on this date already has the note's key, never add the
    // boxes again (re-uploads used to land them on a second, manual row —
    // that's where doubled boxes came from). Target the row that already
    // carries sales keys; a manual row on the same date is left alone.
    const keyedAnywhere = rows.some(r => (r.sales_keys || []).includes(key))
    const l = rows.find(r => (r.sales_keys || []).length > 0) || rows[0]
    const dupNote = rows.length > 1 ? ` ⚠ ${rows.length} landings exist on ${date} — check Crew Landings for duplicates` : ''
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
      if (keyedAnywhere) return healed + dupNote
      if (l.locked) return ' — crew landing locked (month closed), not updated'
      const { error: e } = await supabase.from('landings')
        .update({ boxes: Math.round((Number(l.boxes || 0) + Number(boxes)) * 100) / 100, sales_keys: [...(l.sales_keys || []), key] })
        .eq('id', l.id)
      return e ? ` (crew landing: ${e.message})` : ` → crew landing +${num(boxes)} bx${healed}${dupNote}`
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
  const [a4Tot, setA4Tot] = useState({ mini: '', metro: '', chipper: '' })
  async function applyTotals() {
    const res = splitA4ByTotals(a4Rows, a4Tot)
    if (res.error) { setNotice(res.error); return }
    await saveSubGrades(res.updates)
    const warn = res.flag
      ? ` ⚠ your totals (${res.entered}) differ from the ${res.actual} A4 boxes landed by ${res.diff > 0 ? '+' : ''}${res.diff} — check the entry.`
      : ''
    setNotice(`Split by totals done — Mini ${a4Tot.mini || 0} / Metro ${a4Tot.metro || 0} / Chipper ${a4Tot.chipper || 0} boxes allocated by price.${warn}`)
  }

  /* ---------------- derived ---------------- */
  const k = useMemo(() => kpis(inScope, landingsInScope.length), [inScope, landingsInScope])
  const daysTotal = useMemo(() => landingsInScope.reduce((s, l) => s + (Number(l.days_at_sea) || 0), 0), [landingsInScope])
  const perDay = daysTotal > 0 ? k.value / daysTotal : null
  async function saveDays(id, val) {
    const v = val === '' ? null : Math.round(Number(val) * 4) / 4   // nearest 0.25 day
    const { error } = await supabase.from('sales_landings').update({ days_at_sea: v }).eq('id', id)
    if (error) { setError(error.message); return }
    setLandings(landings.map(l => l.id === id ? { ...l, days_at_sea: v } : l))
  }
  const speciesTbl = useMemo(() => withShares(bySpecies(inScope), basis), [inScope, basis])
  const buyersTbl = useMemo(() => withShares(byBuyer(inScope), basis), [inScope, basis])

  // Pair teams: two boats in one fleet, told apart by the landing's vessel
  // label. These always use both boats, whatever the picker says.
  const vesselTbl = useMemo(() => withShares(byVessel(pairRows, landingById), basis), [pairRows, landingById, basis])
  const pairInfo = useMemo(() => pairedDays(pairLandings), [pairLandings])
  const priceGaps = useMemo(() => (isPair ? samedayPriceGap(pairRows, landingById) : []), [isPair, pairRows, landingById])
  const mixSpread = useMemo(() => (isPair ? speciesMixDivergence(pairRows, landingById, basis) : []), [isPair, pairRows, landingById, basis])
  const marketSplit = useMemo(() => (isPair ? vesselMarketSplit(pairRows, landingById) : []), [isPair, pairRows, landingById])
  const avgGap = priceGaps.length ? r2(priceGaps.reduce((s, g) => s + g.gap, 0) / priceGaps.length) : 0
  const monthly = useMemo(() => mode === 'year' ? monthlySeries(rows, landingById, year) : [], [rows, mode, year, landingById])
  const perLanding = useMemo(() => mode === 'month' ? landingSeries(scopeLandings) : [], [mode, scopeLandings])
  const speciesChart = useMemo(() => speciesTbl.slice(0, 10).map(s => ({ label: s.species, value: s.value, kg: r2(s.kg / 1000) })), [speciesTbl])

  if (!canView) {
    return <AppShell><div className="card"><p className="muted">Skipper access only.</p></div></AppShell>
  }

  async function updateDkkRate(landing, newRate) {
    const rate = Number(newRate)
    if (!rate || rate <= 0) { setError('Enter a valid DKK rate (DKK per £1).'); return }
    setBusy(true); setError('')
    try {
      const { data: rws, error: er } = await supabase.from('sales_rows').select('id, value_dkk, ppk_dkk').eq('landing_id', landing.id)
      if (er) throw er
      let gross = 0
      for (const r of (rws || [])) {
        if (r.value_dkk == null) continue
        const v = r2(r.value_dkk / rate), ppk = r2((r.ppk_dkk || 0) / rate)
        gross = r2(gross + v)
        const { error: eu } = await supabase.from('sales_rows').update({ value: v, price_per_kg: ppk }).eq('id', r.id)
        if (eu) throw eu
      }
      const { error: el } = await supabase.from('sales_landings').update({ value: gross, fx_rate: rate }).eq('id', landing.id)
      if (el) throw el
      setNotice(`Updated DKK rate to ${rate} — landing now ${gbp0(gross)}.`)
      await loadLandings()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  return (
    <AppShell>
      <PageHeader title="Fish Sales" sub={scopeLabel}>
        <button className="secondary" onClick={() => exportSalesExcel({ scopeLabel, rows, landings: scopeLandings, landingById })} disabled={!rows.length}>Excel</button>
        <button className="secondary" onClick={() => window.print()} disabled={!rows.length}>PDF / Print</button>
      </PageHeader>

      {/* Full version here: the upload button is on this page, and so is the
          way out for a note that genuinely cannot be got again. */}
      <ReconcileBanner />

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
        {/* Only a real pair gets a picker — a single-vessel fleet never sees one. */}
        {isPair && (
          <select value={vessel} onChange={e => setVessel(e.target.value)} style={{ width: 'auto' }} title="Whole page follows this">
            <option value="">Both boats</option>
            {vesselNames.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <select value={scope} onChange={e => setScope(e.target.value)} style={{ width: 'auto' }} title="Danish sales come through Hanstholm with no buyer names">
          {SALES_SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={basis} onChange={e => setBasis(e.target.value)} style={{ width: 'auto' }} title="What the percentages are a share of">
          <option value="value">% of £</option>
          <option value="kg">% of kg</option>
          <option value="boxes">% of boxes</option>
        </select>
        {rowsLoading && <span className="muted">loading…</span>}
      </div>

      {error && <p className="error">Error: {error}</p>}
      {notice && <p className="success" onClick={() => setNotice('')}>{notice}</p>}

      <div id="sales-report">
        <h2 className="print-only" style={{ display: 'none' }}>Fish Sales — {scopeLabel}</h2>

        {/* KPIs */}
        <div className="card">
          <h2>{scopeLabel}</h2>
          {mode === 'landing' && landingById[landingId]?.currency === 'DKK' && (
            <DkkRate landing={landingById[landingId]} onSave={updateDkkRate} />
          )}
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <Kpi label="Total sales" value={gbp0(k.value)} />
            <Kpi label="Tonnage" value={num(r2(k.kg / 1000)) + ' t'} sub={num(k.kg) + ' kg'} />
            <Kpi label="Boxes" value={num(k.boxes)} />
            <Kpi label="Average £/kg" value={gbp(k.pkg)} />
            <Kpi label="Landings" value={num(k.landings)} />
            <Kpi label="£/day at sea" value={perDay != null ? gbp0(perDay) : '—'} sub={daysTotal > 0 ? num(r2(daysTotal)) + ' days' : (mode === 'landing' ? 'set days below' : 'add days below')} />
          </div>
          {/* The list views let you type days against each landing, but the
              single-landing view never did — so the one place you are actually
              looking at a trip was the one place you could not record how long
              it took. Days at sea otherwise only arrive via logbook/quota
              uploads. */}
          {mode === 'landing' && landingId && landingById[landingId] && (
            <DaysAtSea landing={landingById[landingId]} canEdit={isSkipper} onSave={saveDays} />
          )}
        </div>

        {/* ---- pair side by side ---- */}
        {isPair && (
          <div className="card">
            <h2>Boat against boat</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
              {pairInfo.together} day{pairInfo.together === 1 ? '' : 's'} both boats landed together
              {pairInfo.alone > 0 && `, ${pairInfo.alone} where only one did`}. Gross and boxes are
              each boat&rsquo;s own; days at sea are <strong>not</strong> summed — the pair fished the
              same days, so the pair rate is pair gross ÷ the trip&rsquo;s days.
              {vessel && <> This comparison always shows both boats, whatever the picker is set to.</>}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: '0.5rem 0.4rem' }}>Vessel</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>Landings</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>Gross</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>Share</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>Boxes</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>Tonnes</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>£/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {vesselTbl.map(v => (
                    <tr key={v.vessel} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.5rem 0.4rem', fontWeight: 600 }}>{v.vessel}</td>
                      <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{num(v.landings)}</td>
                      <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{gbp0(v.value)}</td>
                      <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right', fontWeight: 700 }}>{v.share}%</td>
                      <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{num(v.boxes)}</td>
                      <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{num(r2(v.kg / 1000))}</td>
                      <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{gbp(v.pkg)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                    <td style={{ padding: '0.5rem 0.4rem' }}>Pair</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{num(landingsInScope.length)}</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{gbp0(k.value)}</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>100%</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{num(k.boxes)}</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{num(r2(k.kg / 1000))}</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{gbp(k.pkg)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---- 1. same-day price gap ---- */}
        {isPair && priceGaps.length > 0 && (
          <div className="card">
            <h2>Same-day price gap</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
              Both boats landed on these days. Average gap <strong>{gbp(avgGap)}/kg</strong> across{' '}
              {priceGaps.length} day{priceGaps.length === 1 ? '' : 's'}. A gap that keeps falling the
              same way is grading or a market split, not luck.
            </p>
            <Scroll>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={th}>Date</th><th style={th}>Better</th><th style={thR}>£/kg</th>
                  <th style={th}>Other</th><th style={thR}>£/kg</th><th style={thR}>Gap</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {priceGaps.slice(0, 20).map(g => {
                    const best = g.sides[0], worst = g.sides[g.sides.length - 1]
                    return (
                      <tr key={g.date}>
                        <td style={td}>{fmtDate(g.date)}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{best.vessel}</td>
                        <td style={tdR}>{gbp(best.pkg)}</td>
                        <td style={td} className="muted">{worst.vessel}</td>
                        <td style={tdR}>{gbp(worst.pkg)}</td>
                        <td style={{ ...tdR, fontWeight: 700, color: g.gapPct > 10 ? 'var(--rust)' : 'inherit' }}>
                          {gbp(g.gap)}{g.gapPct ? ` (${g.gapPct}%)` : ''}
                        </td>
                        <td style={td} className="muted">{g.splitMarket ? 'split market' : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Scroll>
          </div>
        )}

        {/* ---- 2. species mix divergence ---- */}
        {isPair && mixSpread.length > 0 && (
          <div className="card">
            <h2>Species mix — where the boats differ</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
              Each boat&rsquo;s share of its own {BASIS_WORD[basis]}, biggest difference first. Towing
              one net they should land much the same mix, so a wide spread is a gear or stowage
              question.
            </p>
            <Scroll>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={th}>Species</th>
                  {mixSpread[0].shares.map(s => <th key={s.vessel} style={thR}>{s.vessel}</th>)}
                  <th style={thR}>Spread</th>
                </tr></thead>
                <tbody>
                  {mixSpread.slice(0, 12).map(m => (
                    <tr key={m.species}>
                      <td style={{ ...td, fontWeight: 600 }}>{m.species}</td>
                      {m.shares.map(s => <td key={s.vessel} style={tdR}>{s.share}%</td>)}
                      <td style={{ ...tdR, fontWeight: 700, color: m.spread >= 5 ? 'var(--brass)' : 'inherit' }}>{m.spread} pts</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          </div>
        )}

        {/* ---- 3. which boat sold where ---- */}
        {isPair && marketSplit.length > 0 && (
          <div className="card">
            <h2>Which boat sold where</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
              Splitting a pair&rsquo;s catch across two markets is a decision. This is what it came to.
            </p>
            <Scroll>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={th}>Vessel</th><th style={th}>Market</th><th style={thR}>Landings</th>
                  <th style={thR}>£</th><th style={thR}>Tonnes</th><th style={thR}>£/kg</th>
                </tr></thead>
                <tbody>
                  {marketSplit.map(s => (
                    <tr key={s.vessel + s.market}>
                      <td style={{ ...td, fontWeight: 600 }}>{s.vessel}</td>
                      <td style={td}>{shortMarket(s.market)}</td>
                      <td style={tdR}>{num(s.landings)}</td>
                      <td style={tdR}>{gbp0(s.value)}</td>
                      <td style={tdR}>{num(r2(s.kg / 1000))}</td>
                      <td style={tdR}>{gbp(s.pkg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          </div>
        )}

        {/* charts */}
        {mode === 'year' && rows.length > 0 && (
          <div className="card">
            <h2>£ and tonnage by month</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" /><YAxis tickFormatter={v => '£' + (v / 1000) + 'k'} />
                <Tooltip formatter={v => gbp0(v)} />
                <Bar dataKey="value" name="£" fill="var(--hull)" />
              </BarChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" /><YAxis />
                <Tooltip formatter={v => v + ' t'} />
                <Line dataKey="kg" name="tonnes" stroke="var(--hull-bright)" strokeWidth={2} dot />
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
                <Bar dataKey="value" name="£" fill="var(--hull)" />
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
                <Bar dataKey="value" name="£" fill="var(--kelp)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* species table with grade drill-down */}
        <div className="card">
          <h2>Species <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>(tap a species for grade breakdown)</span></h2>
          <Scroll>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={th}>Species</th><th style={thR}>Boxes</th><th style={thR}>Kg</th><th style={thR}>£</th><th style={thR}>{BASIS_LABEL[basis]}</th><th style={thR}>£/kg</th></tr></thead>
              <tbody>
                {speciesTbl.map(s => (
                  <SpeciesRow key={s.species} s={s} open={openSpecies === s.species}
                    onToggle={() => setOpenSpecies(openSpecies === s.species ? '' : s.species)} rows={inScope} basis={basis} />
                ))}
              </tbody>
            </table>
          </Scroll>
        </div>

        {/* buyers */}
        <div className="card">
          <h2>Buyers <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>(tap a buyer for what they bought)</span></h2>
          {/* The Denmark rule stated rather than implied: Hanstholm print no
              buyer names, so their sales can only ever appear as the auction
              itself. Which scope you are in decides whether they count. */}
          <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
            {scope === 'dk'
              ? 'Denmark only — Hanstholm print no buyer names, so there is one auction row and no real buyers to rank.'
              : scope === 'uk'
                ? 'UK only — Danish sales are out, so every row here is a named buyer.'
                : 'All landings — Danish sales count towards these totals, but they can only show as the auction, not a buyer.'}
          </p>
          <Scroll>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={th}>Buyer</th><th style={thR}>Boxes</th><th style={thR}>Kg</th><th style={thR}>£</th><th style={thR}>{BASIS_LABEL[basis]}</th><th style={thR}>£/kg</th><th style={th}>Top species</th></tr></thead>
              <tbody>
                {buyersTbl.map(b => (
                  <BuyerRow key={b.buyer} b={b} open={openBuyer === b.buyer}
                    onToggle={() => setOpenBuyer(openBuyer === b.buyer ? '' : b.buyer)} rows={inScope} />
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
                <thead><tr><th style={th}>Date</th><th style={th}>Vessel</th><th style={th}>Market</th><th style={thR}>Boxes</th><th style={thR}>Kg</th><th style={thR}>£</th><th style={thR}>Days</th><th style={th}></th></tr></thead>
                <tbody>
                  {scopeLandings.map(l => (
                    <tr key={l.id}>
                      <td style={td}>{fmtDate(l.landing_date)}{l.consigned ? ' (consigned)' : ''}</td>
                      <td style={td}>{l.vessel}</td>
                      <td style={td}>
                        {l.market}
                        {l.reconcile_ok === false && (
                          <span title={reconcileNote(l)} style={{ color: 'var(--brass)', cursor: 'help' }}> ⚠</span>
                        )}
                      </td>
                      <td style={tdR}>{num(l.boxes)}</td>
                      <td style={tdR}>{num(l.weight_kg)}</td>
                      <td style={tdR}>{gbp0(l.value)}</td>
                      <td style={tdR}>
                        {isSkipper
                          ? <input type="number" min="0" step="0.25" defaultValue={l.days_at_sea ?? ''} onBlur={e => saveDays(l.id, e.target.value)} className="no-print" style={{ width: 64, padding: '0.2rem 0.4rem', textAlign: 'right' }} />
                          : (l.days_at_sea ?? '—')}
                        <span className="print-only" style={{ display: 'none' }}>{l.days_at_sea ?? '—'}</span>
                      </td>
                      <td style={{ ...td }} className="no-print">
                        <a href="#view" onClick={e => { e.preventDefault(); setMode('landing'); setLandingId(l.id) }}>view</a>
                      </td>
                    </tr>
                  ))}
                  {!scopeLandings.length && <tr><td style={td} colSpan={8} className="muted">No landings in this period yet.</td></tr>}
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
            {isSkipper && <div className="no-print" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <div>
                <div className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.2rem' }}>Or enter this trip's totals (boxes), allocated by price:</div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {['mini', 'metro', 'chipper'].map(k => (
                    <label key={k} style={{ fontSize: '0.8rem' }}>
                      <div style={{ textTransform: 'capitalize', color: 'var(--grey-400)' }}>{k === 'mini' ? 'Mini Metro' : k}</div>
                      <input type="number" min="0" step="1" value={a4Tot[k]} onChange={e => setA4Tot({ ...a4Tot, [k]: e.target.value })} style={{ width: 90, padding: '0.25rem 0.5rem' }} />
                    </label>
                  ))}
                  <button className="secondary" style={{ alignSelf: 'flex-end' }} onClick={applyTotals}>Apply totals</button>
                </div>
              </div>
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
    </AppShell>
  )
}

const BASIS_LABEL = { value: '% £', kg: '% kg', boxes: '% box' }
const BASIS_WORD = { value: 'gross', kg: 'kilos', boxes: 'boxes' }

function SpeciesRow({ s, open, onToggle, rows, basis }) {
  // Grade shares are of the SPECIES, not of the whole trip — "what drove the
  // haddock" is a different question from "what drove the gross", and rolling
  // them into one number answers neither.
  const grades = open ? withShares(gradesFor(rows, s.species), basis || 'value') : []
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={{ ...td, fontWeight: 600, color: 'var(--navy)' }}>{open ? '▾ ' : '▸ '}{s.species}</td>
        <td style={tdR}>{num(s.boxes)}</td>
        <td style={tdR}>{num(s.kg)}</td>
        <td style={tdR}>{gbp0(s.value)}</td>
        <td style={{ ...tdR, fontWeight: 700 }}>{s.share}%</td>
        <td style={tdR}>{gbp(s.pkg)}</td>
      </tr>
      {open && grades.map(g => (
        <tr key={g.grade} style={{ background: 'var(--grey-50)' }}>
          <td style={{ ...td, paddingLeft: '1.8rem' }}>{g.grade}</td>
          <td style={tdR}>{num(g.boxes)}</td>
          <td style={tdR}>{num(g.kg)}</td>
          <td style={tdR}>{gbp0(g.value)}</td>
          <td style={{ ...tdR, color: 'var(--mute)' }}>{g.share}%</td>
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
        <td style={{ ...td, fontWeight: 600, color: 'var(--navy)' }}>
          {open ? '▾ ' : '▸ '}{b.buyer}
          {/* Hanstholm print no buyer names, so the parser files every Danish
              row against the auction itself. Saying so beats letting it sit at
              the top of the table looking like the biggest customer. */}
          {/auction/i.test(b.buyer) && <span className="muted" style={{ fontWeight: 400, fontSize: '0.7rem' }}> · auction, not a buyer</span>}
        </td>
        <td style={tdR}>{num(b.boxes)}</td>
        <td style={tdR}>{num(b.kg)}</td>
        <td style={tdR}>{gbp0(b.value)}</td>
        <td style={{ ...tdR, fontWeight: 700 }}>{b.share}%</td>
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
        <td style={tdR}></td>
        <td style={tdR}>{gbp(sp.pkg)}</td>
        <td style={td}></td>
      </tr>
      {open && buyerSpeciesGrades(rows, buyer, sp.species).map(g => (
        <tr key={g.grade} style={{ background: 'var(--grey-50)' }}>
          <td style={{ ...td, paddingLeft: '3.4rem' }} className="muted">{g.grade}</td>
          <td style={tdR}>{num(g.boxes)}</td>
          <td style={tdR}>{num(g.kg)}</td>
          <td style={tdR}>{gbp0(g.value)}</td>
          <td style={tdR}></td>
          <td style={tdR}>{gbp(g.pkg)}</td>
          <td style={td}></td>
        </tr>
      ))}
    </>
  )
}

// Days at sea for a single landing. Stored to the nearest quarter day by
// saveDays, which is what the list views already do — so a trip typed here
// and a trip typed there land on the same figure.
function DaysAtSea({ landing, canEdit, onSave }) {
  const [v, setV] = useState(landing.days_at_sea ?? '')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setV(landing.days_at_sea ?? ''); setSaved(false) }, [landing.id, landing.days_at_sea])

  async function save() {
    await onSave(landing.id, v)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!canEdit) {
    return (
      <div className="muted" style={{ marginTop: '0.7rem', fontSize: '0.85rem' }}>
        Days at sea: {landing.days_at_sea ?? '—'}
      </div>
    )
  }

  return (
    <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.7rem', fontSize: '0.85rem' }}>
      <span className="muted">Days at sea for this trip:</span>
      <input
        type="number" min="0" step="0.25" value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }}
        style={{ width: 80, textAlign: 'right' }}
      />
      <button className="secondary" onClick={save} style={{ padding: '2px 10px' }}>Save</button>
      {saved && <span style={{ color: 'var(--kelp)', fontWeight: 700 }}>Saved ✓</span>}
      <span className="muted">quarter days · sets £/day above</span>
    </div>
  )
}

function DkkRate({ landing, onSave }) {
  const [v, setV] = useState(landing.fx_rate ?? '')
  useEffect(() => { setV(landing.fx_rate ?? '') }, [landing.id, landing.fx_rate])
  return (
    <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '0 0 0.7rem', fontSize: '0.85rem' }}>
      <span className="muted">Danish note · DKK→£ day rate:</span>
      <input type="number" step="0.0001" min="0" value={v} onChange={e => setV(e.target.value)} style={{ width: 96 }} />
      <span className="muted">DKK per £1</span>
      <button className="secondary" onClick={() => onSave(landing, v)} style={{ padding: '2px 10px' }}>Update</button>
    </div>
  )
}
