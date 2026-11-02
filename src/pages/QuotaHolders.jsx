import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import {
  ALL, league, ratesFor, projectRates, applyRowFilters, poShares, search, breakdown,
  fmtUnits, fmtT, fmtPct, NO_PO, poLabel,
} from '../lib/quota/ukHolders.js'

/* UK QUOTA HOLDERS — who holds the UK's fixed quota allocation (FQA) units.
 *
 * Shared, read-only, cross-fleet: an export of the public FQA register, loaded
 * into `quota_holders_data` (see supabase/uk_quota_holders.sql). Tonnes are an
 * ESTIMATE worked out here from units and each year's PO TAC shares in the
 * swaps page's `balances` (src/lib/quota/ukHolders.js says how). A year with no
 * uptake report yet is a projection off the latest year and the user's % per
 * stock, kept in this browser only.
 *
 * Its own page beside UK Quota Swaps rather than four more tabs on that one:
 * the swaps page already has eight. */

const TABS = [
  ['league', 'League tables'],
  ['po', 'PO make-up'],
  ['lease', 'Lease prospects'],
  ['lookup', 'Holder look-up'],
]
const TOPS = [10, 20, 50, 100, 0]
const PCT_KEY = 'qh_next_year_pct_v1'
const PRESETS = [
  ['NS whitefish', ['NS cod', 'NS haddock', 'NS whiting', 'NS saithe', 'NS hake', 'NS anglers', 'NS megrim', 'Ling IV', 'Tusk IV', 'NS plaice', 'NS lemons & witches']],
  ['WS whitefish', ['WS cod (VIa)', 'Haddock VIa', 'WS whiting', 'WS saithe', 'WS anglers', 'WS megrim', 'Ling VI-X,XII,XIV', 'Tusk V,VI,VII', 'Blue ling VI,VII']],
  ['Nephrops', ['NS nephrops', 'WS nephrops', 'Nephrops VII', 'Norway nephrops']],
  ['Pelagic', ['WS mackerel', 'NS mackerel', 'NS herring', 'Atlanto-Scandian herring', 'Northern blue whiting', 'WS horse mackerel', 'NS horse mackerel']],
]

const th = { textAlign: 'left', padding: '0.5rem 0.6rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--navy)',
  position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', fontSize: '0.8rem', userSelect: 'none' }
const td = { padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--line-2)', whiteSpace: 'nowrap', verticalAlign: 'top' }
const num = { fontFamily: 'var(--font-mono)', textAlign: 'right' }
const scroller = { maxHeight: '68vh', overflow: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid var(--line)', borderRadius: 4 }
const lbl = { display: 'grid', gap: 2, fontSize: '0.75rem' }
/* Every control in a filter row is the same height and type size, so the row
 * lines up: the global input/select rule is width 100% at body size, and a
 * select inside a 0.75rem label inherits the small size while a button does not. */
const ctl = { fontSize: '0.85rem', height: '2.3rem', padding: '0 0.6rem', width: 'auto', boxSizing: 'border-box' }
const DASH = <span className="muted">–</span>
const signed = (v) => ({ color: v > 0.05 ? 'var(--kelp)' : v < -0.05 ? 'var(--rust)' : 'var(--mute)' })

function loadPct() { try { return JSON.parse(localStorage.getItem(PCT_KEY)) || {} } catch { return {} } }
function savePct(v) { try { localStorage.setItem(PCT_KEY, JSON.stringify(v)) } catch { /* private mode */ } }

export default function QuotaHolders() {
  const { appUser } = useAuth()
  const allowed = ['skipper', 'viewer'].includes(appUser?.role)

  const [data, setData] = useState({})           // dataset -> payload
  const [bal, setBal] = useState({})             // year -> balances rows
  const [periods, setPeriods] = useState([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const [tab, setTab] = useState('league')
  const [year, setYear] = useState(null)        // a number, or 'next'
  const [po, setPo] = useState(ALL)
  const [htype, setHtype] = useState(ALL)
  const [admin, setAdmin] = useState(ALL)
  const [pct, setPctState] = useState(loadPct)
  const setPct = (v) => { setPctState(v); savePct(v) }

  useEffect(() => {
    if (!allowed) { setBusy(false); return }
    (async () => {
      setBusy(true)
      const [h, p] = await Promise.all([
        supabase.from('quota_holders_data').select('dataset,payload,updated_at'),
        supabase.from('quota_swaps_data').select('payload').eq('dataset', 'periods').eq('year', 0),
      ])
      if (h.error || p.error) { setError((h.error || p.error).message); setBusy(false); return }
      setData(Object.fromEntries((h.data || []).map((r) => [r.dataset, r.payload])))
      setPeriods(p.data?.[0]?.payload || [])
      setBusy(false)
    })()
  }, [allowed])

  const years = useMemo(() => [...new Set(periods.map((p) => p.year))].sort((a, b) => b - a), [periods])
  const latest = years[0]
  useEffect(() => { if (year == null && latest) setYear(latest) }, [latest, year])
  const rateYear = year === 'next' ? latest : year
  useEffect(() => {
    if (rateYear == null || bal[rateYear]) return
    supabase.from('quota_swaps_data').select('payload').eq('dataset', 'balances').eq('year', rateYear)
      .then(({ data: d, error: e }) => {
        if (e) setError(e.message)
        else setBal((b) => ({ ...b, [rateYear]: d?.[0]?.payload || [] }))
      })
  }, [rateYear])

  const holdings = data.fqa_holdings || []
  const speciesList = data.fqa_species || []
  const meta = (data.fqa_meta || [])[0]
  const balances = bal[rateYear] || []

  const baseRates = useMemo(() => ratesFor(speciesList, balances, holdings), [speciesList, balances, holdings])
  const rates = useMemo(() => (year === 'next' ? projectRates(baseRates, pct) : baseRates), [baseRates, pct, year])

  const filtered = useMemo(() => applyRowFilters(holdings, { po, htype, admin }), [holdings, po, htype, admin])
  const pos = useMemo(() => [...new Set(holdings.map((r) => r.po))].sort(), [holdings])
  const htypes = useMemo(() => [...new Set(holdings.map((r) => r.htype))].sort(), [holdings])
  const admins = useMemo(() => [...new Set(holdings.map((r) => r.admin).filter(Boolean))].sort(), [holdings])
  const yearLabel = year === 'next' ? `${latest + 1} (estimate)` : String(year ?? '')

  if (!allowed) return <AppShell><div className="card"><p className="muted">UK quota holders is for skippers and viewers.</p></div></AppShell>
  const nothing = !busy && !holdings.length

  return (
    <AppShell>
      <PageHeader title="UK quota holders"
        sub={meta
          ? `Every FQA holding on the public register as at ${new Date(meta.as_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}: ${meta.holders.toLocaleString('en-GB')} holders, ${meta.licences.toLocaleString('en-GB')} licences, ${meta.species} stocks. Tonnes are estimates.`
          : 'Who holds the UK’s fixed quota allocation units, by holder, boat, PO and stock.'}>
        <Link to="/quota-swaps"><button type="button" className="secondary">UK quota swaps →</button></Link>
      </PageHeader>

      {error && <p className="error">{error}</p>}
      {nothing && !error && <div className="card"><p className="muted" style={{ margin: 0 }}>No FQA register loaded yet.</p></div>}

      {!nothing && (<>
        <div className="card qs-filters" style={{ padding: '0.8rem 1rem', marginBottom: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="muted" style={lbl}>Tonnes for year
              <select style={ctl} value={year ?? ''} onChange={(e) => setYear(e.target.value === 'next' ? 'next' : Number(e.target.value))}>
                {latest && <option value="next">{latest + 1} (estimate)</option>}
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select></label>
            <label className="muted" style={lbl}>PO
              <select style={ctl} value={po} onChange={(e) => setPo(e.target.value)}>
                <option value={ALL}>All POs</option>
                {pos.map((p) => <option key={p} value={p}>{poLabel(p)}</option>)}
              </select></label>
            <label className="muted" style={lbl}>Holding type
              <select value={htype} onChange={(e) => setHtype(e.target.value)} style={{ ...ctl, maxWidth: 260 }}>
                <option value={ALL}>All holding types</option>
                {htypes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select></label>
            <label className="muted" style={lbl}>Administration
              <select value={admin} onChange={(e) => setAdmin(e.target.value)} style={{ ...ctl, maxWidth: 240 }}>
                <option value={ALL}>All administrations</option>
                {admins.map((p) => <option key={p} value={p}>{p}</option>)}
              </select></label>
            <button type="button" className="secondary" style={{ ...ctl, padding: '0 0.9rem' }}
              onClick={() => { setPo(ALL); setHtype(ALL); setAdmin(ALL); setYear(latest ?? null) }}>Reset</button>
            {busy && <span className="muted" style={{ fontSize: '0.8rem' }}>Loading…</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
            {TABS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? '' : 'secondary'} style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}>{l}</button>
            ))}
          </div>
        </div>

        {year === 'next' && <NextYear speciesList={speciesList} base={baseRates} pct={pct} setPct={setPct} latest={latest} />}

        {tab === 'league' && <League rows={filtered} speciesList={speciesList} rates={rates} yearLabel={yearLabel} />}
        {tab === 'po' && <PoMakeup rows={filtered} speciesList={speciesList} rates={rates} balances={balances}
          yearLabel={yearLabel} swapsYear={rateYear} estimate={year === 'next'} />}
        {tab === 'lease' && <League rows={filtered} speciesList={speciesList} rates={rates} yearLabel={yearLabel} leasable balances={balances} swapsYear={rateYear} />}
        {tab === 'lookup' && <Lookup rows={filtered} rates={rates} yearLabel={yearLabel} />}

        <p className="muted" style={{ fontSize: '0.75rem', marginTop: '1rem' }}>
          Source: the public FQA register (fqaregister.service.gov.uk){meta ? `, export of ${meta.as_at}` : ''}. Units are as registered.
          Tonnes are an estimate: units × (the year's total PO TAC share for the stock in the Marine Directorate uptake report ÷ units held in POs).
          They leave out banking and swaps, and stocks the uptake report does not cover (area VII, Norway, NAFO and others) show units only.
          {year === 'next' ? ` ${latest + 1} uses ${latest}'s rate moved by your % per stock.` : ''}
        </p>
      </>)}
    </AppShell>
  )
}

/* The next year's TAC changes, one % per stock, kept in this browser. */
export function NextYear({ speciesList, base, pct, setPct, latest }) {
  const [all, setAll] = useState('')
  const [open, setOpen] = useState(true)
  const withRate = speciesList.filter((s) => base.has(s.species))
  const changed = Object.values(pct).filter((v) => Number(v)).length
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{latest + 1} TAC change by stock</h2>
        <span className="muted" style={{ fontSize: '0.8rem' }}>{changed ? `${changed} stock${changed === 1 ? "" : "s"} changed` : `every stock at ${latest} levels`}</span>
        <button type="button" className="secondary" style={{ padding: '0.25rem 0.7rem', fontSize: '0.8rem' }} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (<>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Enter the expected change in the UK quota for each stock: +10 for a 10% rise, −15 for a 15% cut. Every tonnes figure on the page then uses {latest}'s
          tonnes per unit moved by that %. Saved in this browser only, and replaced by the real figures once the {latest + 1} uptake reports arrive.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <label className="muted" style={lbl}>Same % for every stock
            <input type="number" value={all} onChange={(e) => setAll(e.target.value)} style={{ width: '6rem' }} /></label>
          <button type="button" className="secondary" style={{ padding: '0.35rem 0.8rem' }}
            onClick={() => setPct(Object.fromEntries(withRate.map((s) => [s.species, Number(all) || 0])))}>Apply to all</button>
          <button type="button" className="secondary" style={{ padding: '0.35rem 0.8rem' }} onClick={() => { setPct({}); setAll('') }}>Clear</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))', gap: '0.35rem 0.8rem' }}>
          {withRate.map((s) => {
            const r = base.get(s.species)
            const p = Number(pct[s.species]) || 0
            return (
              <label key={s.species} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                <span style={{ flex: 1 }}>{s.species}</span>
                <input type="number" step="1" value={pct[s.species] ?? ''} placeholder="0"
                  onChange={(e) => setPct({ ...pct, [s.species]: e.target.value === '' ? undefined : Number(e.target.value) })}
                  style={{ width: '4.2rem', textAlign: 'right' }} />
                <span className="muted" title={`${(r * 1000).toFixed(1)} kg per unit in ${latest}`} style={{ width: '4.6rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {(r * (1 + p / 100) * 1000).toFixed(1)} kg/u</span>
              </label>
            )
          })}
        </div>
      </>)}
    </div>
  )
}

/* Pick one or many stocks: search, presets, tick boxes. Nothing ticked = every stock. */
function SpeciesPicker({ speciesList, value, onChange, single = false, rates }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  if (single) {
    return (
      <label className="muted" style={lbl}>Stock
        <select value={value[0] || ''} onChange={(e) => onChange([e.target.value])} style={{ ...ctl, maxWidth: 260 }}>
          {speciesList.map((s) => <option key={s.species} value={s.species}>{s.species}{rates && !rates.has(s.species) ? ' (units only)' : ''}</option>)}
        </select></label>
    )
  }
  const shown = speciesList.filter((s) => s.species.toLowerCase().includes(q.toLowerCase()))
  const set = new Set(value)
  const toggle = (k) => onChange(set.has(k) ? value.filter((x) => x !== k) : [...value, k])
  const label = !value.length ? 'All stocks' : value.length === 1 ? value[0] : `${value.length} stocks`
  return (
    <div style={{ position: 'relative' }}>
      <span className="muted" style={{ fontSize: '0.75rem', display: 'block', marginBottom: 2 }}>Stocks</span>
      <button type="button" className="secondary" onClick={() => setOpen(!open)} style={{ ...ctl, minWidth: 180, textAlign: 'left', fontWeight: 400 }}>
        {label} ▾</button>
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 5, top: '100%', left: 0, width: 'min(26rem, 90vw)', margin: '0.2rem 0 0', padding: '0.7rem',
          boxShadow: '0 6px 20px rgba(0,0,0,0.18)' }}>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <button type="button" className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }} onClick={() => onChange([])}>All stocks</button>
            {PRESETS.map(([n, list]) => (
              <button key={n} type="button" className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                onClick={() => onChange(list.filter((k) => speciesList.some((s) => s.species === k)))}>{n}</button>
            ))}
          </div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a stock" style={{ width: '100%', marginBottom: '0.4rem' }} />
          <div style={{ maxHeight: '16rem', overflow: 'auto' }}>
            {shown.map((s) => (
              <label key={s.species} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.82rem', padding: '0.2rem 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={set.has(s.species)} onChange={() => toggle(s.species)} style={{ width: 'auto', padding: 0, margin: 0, flex: 'none' }} />
                <span style={{ flex: 1 }}>{s.species}</span>
                {rates && !rates.has(s.species) && <span className="muted" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}>units only</span>}
              </label>
            ))}
          </div>
          <div style={{ textAlign: 'right', marginTop: '0.4rem' }}>
            <button type="button" style={{ padding: '0.3rem 0.8rem' }} onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

const poNet = (balances, po, code) => balances.find((b) => b.po === po && b.stock === code)

/* League tables, and — with `leasable` — the lease prospects: the same ranking
 * over units not attached to a fishing boat's own licence. */
export function League({ rows, speciesList, rates, yearLabel, leasable = false, balances = [], swapsYear }) {
  const [by, setBy] = useState('holder')
  const [species, setSpecies] = useState(leasable ? ['NS haddock'] : [])
  const [metric, setMetric] = useState('tonnes')
  const [top, setTop] = useState(20)
  const [split, setSplit] = useState(false)
  const [openKey, setOpenKey] = useState(null)

  const src = useMemo(() => applyRowFilters(rows, { leasable }), [rows, leasable])
  const L = useMemo(() => league(src, { by: leasable ? 'holder' : by, species, metric, rates, split, top }), [src, by, species, metric, rates, split, top, leasable])
  const perCols = species.length > 1 && species.length <= 6 ? species : []
  const one = species.length === 1 ? speciesList.find((s) => s.species === species[0]) : null
  const noRate = species.length ? species.filter((s) => !rates.has(s)) : []
  const mode = leasable ? 'holder' : by

  return (
    <div className="card">
      <h2>{leasable ? 'Lease prospects' : 'League table'}</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        {leasable
          ? 'Units not on a fishing boat’s own licence: held by agents and owners, private persons, companies, PO pools and quota schemes. These are the units most likely to be leased out. With one stock picked, the last columns show whether the holder’s PO has been a net giver of that stock this year on the swaps page.'
          : 'Biggest holders of the stocks picked. A holder with units on several licences and POs is added together; tick "Each holding separately" to split them. Boats count vessel licences only.'}
        {' '}Tonnes are for {yearLabel}. Tap a row for the holdings behind it.
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'end', marginBottom: '0.6rem' }}>
        {!leasable && <label className="muted" style={lbl}>Rank
          <select style={ctl} value={by} onChange={(e) => { setBy(e.target.value); setOpenKey(null) }}>
            <option value="holder">Holders</option><option value="boat">Boats</option><option value="po">POs</option>
          </select></label>}
        <SpeciesPicker speciesList={speciesList} value={species} onChange={(v) => { setSpecies(v); setOpenKey(null) }} rates={rates} />
        <label className="muted" style={lbl}>Rank on
          <select style={ctl} value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="tonnes">Estimated tonnes</option><option value="units">FQA units</option>
          </select></label>
        <label className="muted" style={lbl}>Show
          <select style={ctl} value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {TOPS.map((t) => <option key={t} value={t}>{t ? `Top ${t}` : 'Everyone'}</option>)}
          </select></label>
        {mode === 'holder' && <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem', height: '2.3rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} style={{ width: 'auto', padding: 0, margin: 0, flex: 'none' }} /> Each holding separately</label>}
      </div>
      {noRate.length > 0 && <p className="muted" style={{ fontSize: '0.78rem' }}>No tonnes estimate for {noRate.join(', ')}: the uptake report does not cover {noRate.length > 1 ? 'them' : 'it'}. Units still count.</p>}
      {by === 'boat' && !leasable && L.offBoat > 0 && <p className="muted" style={{ fontSize: '0.78rem' }}>{fmtUnits(L.offBoat)} units sit on PO dummy licences with no vessel and are not in this table.</p>}
      <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
        {L.count.toLocaleString('en-GB')} {mode === 'po' ? 'POs' : mode === 'boat' ? 'boats' : split ? 'holdings' : 'holders'} hold {fmtUnits(L.totalUnits)} units
        {L.totalTonnes ? ` (≈${fmtT(L.totalTonnes)} t)` : ''}.{top ? ` The ${Math.min(top, L.count)} shown hold ${fmtPct(L.shownShare)}.` : ''}
      </p>
      <div style={scroller}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: '0.86rem' }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'right' }}>#</th>
            <th style={th}>{mode === 'po' ? 'PO' : mode === 'boat' ? 'Boat (licence)' : 'Holder'}</th>
            <th style={{ ...th, textAlign: 'right' }}>FQA units</th>
            <th style={{ ...th, textAlign: 'right' }}>Est. tonnes</th>
            <th style={{ ...th, textAlign: 'right' }}>Share</th>
            {perCols.map((s) => <th key={s} style={{ ...th, textAlign: 'right' }}>{s} ({metric === 'tonnes' ? 't' : 'u'})</th>)}
            {mode !== 'po' && <th style={th}>PO</th>}
            {mode === 'holder' && <th style={th}>Boats / licences</th>}
            {mode === 'boat' && <th style={th}>Holder</th>}
            {leasable && one?.code && <><th style={{ ...th, textAlign: 'right' }}>PO net swaps {swapsYear} (t)</th><th style={{ ...th, textAlign: 'right' }}>PO swapped out (t)</th></>}
          </tr></thead>
          <tbody>
            {L.rows.map((r) => {
              const b = leasable && one?.code && r.pos.length === 1 ? poNet(balances, r.pos[0], one.code) : null
              return (
                <Fragment key={r.key}>
                  <tr onClick={() => setOpenKey(openKey === r.key ? null : r.key)} style={{ cursor: 'pointer', background: openKey === r.key ? 'var(--line-2)' : undefined }}>
                    <td style={{ ...td, ...num }}>{r.rank}</td>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'normal', minWidth: '12rem' }}>{r.name}</td>
                    <td style={{ ...td, ...num }}>{fmtUnits(r.units)}</td>
                    <td style={{ ...td, ...num }}>{r.tonnes ? fmtT(r.tonnes) : '–'}{r.missing > 0 && r.tonnes ? '*' : ''}</td>
                    <td style={{ ...td, ...num }}>{fmtPct(r.share)}</td>
                    {perCols.map((s) => <td key={s} style={{ ...td, ...num }}>{r.per[s] ? (metric === 'tonnes' ? fmtT(r.per[s].tonnes) : fmtUnits(r.per[s].units)) : ''}</td>)}
                    {mode !== 'po' && <td style={{ ...td, whiteSpace: 'normal', fontSize: '0.8rem' }}>{r.pos.map(poLabel).join(', ')}</td>}
                    {mode === 'holder' && <td style={{ ...td, whiteSpace: 'normal', fontSize: '0.8rem', maxWidth: '18rem' }}>
                      {r.vessels.length ? r.vessels.slice(0, 4).join(', ') + (r.vessels.length > 4 ? ` +${r.vessels.length - 4}` : '') : '—'}
                      <span className="muted"> · {r.lics.length} licence{r.lics.length === 1 ? '' : 's'}</span></td>}
                    {mode === 'boat' && <td style={{ ...td, whiteSpace: 'normal', fontSize: '0.8rem' }}>{r.holders.join('; ')}</td>}
                    {leasable && one?.code && <>
                      <td style={{ ...td, ...num, ...(b ? signed(b.net_swaps_t) : null) }}>{b ? fmtT(b.net_swaps_t) : r.pos.length > 1 ? 'several POs' : ''}</td>
                      <td style={{ ...td, ...num }}>{b ? fmtT(b.swaps_out_t) : ''}</td></>}
                  </tr>
                  {openKey === r.key && <tr><td colSpan={20} style={{ ...td, background: 'var(--surface-2, var(--line-2))', whiteSpace: 'normal' }}>
                    <Holdings rows={src.filter((h) => keyOf(h, mode, split) === r.key)} species={species} rates={rates} />
                  </td></tr>}
                </Fragment>
              )
            })}
            {!L.rows.length && <tr><td colSpan={20} style={td} className="muted">No units for these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {L.rows.some((r) => r.missing > 0 && r.tonnes) && <p className="muted" style={{ fontSize: '0.75rem', margin: '0.4rem 0 0' }}>* part of this holder's units are in stocks with no tonnes estimate.</p>}
    </div>
  )
}

function keyOf(h, by, split) {
  if (by === 'po') return h.po
  if (by === 'boat') return `${h.lic}|${h.vessel}`
  return split ? `${h.hkey}|${h.lic}|${h.po}` : h.hkey
}

/* The holdings behind one league row: each licence, its PO and type, its units. */
function Holdings({ rows, species, rates }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
      <thead><tr>
        {['Licence', 'Vessel', 'Holder as registered', 'PO', 'Holding type', 'Units', 'Est. t'].map((h) => <th key={h} style={{ ...th, position: 'static', fontSize: '0.75rem' }}>{h}</th>)}
      </tr></thead>
      <tbody>
        {rows.map((h) => {
          const keys = species.length ? species : Object.keys(h.u)
          const u = keys.reduce((a, k) => a + (h.u[k] || 0), 0)
          const t = keys.reduce((a, k) => a + (rates.has(k) ? (h.u[k] || 0) * rates.get(k) : 0), 0)
          return (
            <tr key={h.id}>
              <td style={td}>{h.lt ? `${h.lt} ` : ''}{h.lic}</td><td style={td}>{h.vessel || '—'}</td>
              <td style={{ ...td, whiteSpace: 'normal' }}>{h.holder}</td><td style={td}>{poLabel(h.po)}</td>
              <td style={{ ...td, whiteSpace: 'normal', maxWidth: '16rem' }}>{h.htype}</td>
              <td style={{ ...td, ...num }}>{fmtUnits(u)}</td><td style={{ ...td, ...num }}>{t ? fmtT(t) : '–'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* PO make-up: each PO's share of a stock's units against its quota and swaps,
 * then who holds the units inside the PO picked. */
export function PoMakeup({ rows, speciesList, rates, balances, yearLabel, swapsYear, estimate }) {
  const [species, setSpecies] = useState(['NS haddock'])
  const [pick, setPick] = useState(null)
  const sp = speciesList.find((s) => s.species === species[0]) || speciesList[0]
  const shares = useMemo(() => (sp ? poShares(rows, sp.code ? balances : [], sp) : []), [rows, balances, sp])
  const inside = useMemo(() => (pick && sp ? league(rows.filter((r) => r.po === pick), { by: 'holder', species: [sp.species], metric: 'units', rates, top: 0 }) : null),
    [rows, pick, sp, rates])
  if (!sp) return null
  const r = rates.get(sp.species)
  return (<>
    <div className="card">
      <h2>PO make-up</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Each PO's share of the register's units for one stock, beside its {swapsYear} quota and swaps from the uptake report{estimate ? ` (swaps are ${swapsYear}'s, not the estimate year's)` : ''}.
        A PO swapping out a large part of its quota is long on that stock. Tap a PO for the holders whose units make up its quota.
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'end', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <SpeciesPicker single speciesList={speciesList} value={[sp.species]} onChange={(v) => { setSpecies(v); setPick(null) }} rates={rates} />
        <span className="muted" style={{ fontSize: '0.8rem', lineHeight: '2.3rem' }}>{r ? `≈${(r * 1000).toFixed(1)} kg per unit in ${yearLabel}` : 'No tonnes estimate for this stock'}</span>
      </div>
      <div style={scroller}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: '0.86rem' }}>
          <thead><tr>
            {[['PO'], ['FQA units', 1], ['Share of units', 1], [`Quota ${swapsYear} (t)`, 1], ['Swapped in (t)', 1], ['Swapped out (t)', 1], ['Net swaps (t)', 1], ['Net % of quota', 1], ['Landed (t)', 1]]
              .map(([h, n]) => <th key={h} style={n ? { ...th, textAlign: 'right' } : th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {shares.map((s) => (
              <tr key={s.po} onClick={() => setPick(pick === s.po ? null : s.po)} style={{ cursor: 'pointer', background: pick === s.po ? 'var(--line-2)' : undefined }}>
                <td style={{ ...td, fontWeight: 600 }}>{s.label}</td>
                <td style={{ ...td, ...num }}>{fmtUnits(s.units)}</td>
                <td style={{ ...td, ...num }}>{fmtPct(s.unitShare)}</td>
                <td style={{ ...td, ...num }}>{s.tac_t != null ? fmtT(s.tac_t) : DASH}</td>
                <td style={{ ...td, ...num }}>{s.swaps_in_t ? fmtT(s.swaps_in_t) : DASH}</td>
                <td style={{ ...td, ...num }}>{s.swaps_out_t ? fmtT(s.swaps_out_t) : DASH}</td>
                <td style={{ ...td, ...num, ...signed(s.net_swaps_t || 0) }}>{s.net_swaps_t ? fmtT(s.net_swaps_t) : DASH}</td>
                <td style={{ ...td, ...num, ...signed(s.netOfTac || 0) }}>{s.netOfTac != null && Math.abs(s.netOfTac) >= 0.0005 ? fmtPct(s.netOfTac) : DASH}</td>
                <td style={{ ...td, ...num }}>{s.landed_t != null ? fmtT(s.landed_t) : DASH}</td>
              </tr>
            ))}
            {!shares.length && <tr><td colSpan={9} style={td} className="muted">No units for this stock.</td></tr>}
          </tbody>
        </table>
      </div>
      {!sp.code && <p className="muted" style={{ fontSize: '0.78rem' }}>This stock is not in the uptake report, so there is no quota or swaps column.</p>}
      <p className="muted" style={{ fontSize: '0.78rem', margin: '0.5rem 0 0' }}>
        <b>Not in a PO (non-sector)</b> is real, not missing data: licences of boats outside every PO, plus administration pool licences. Their quota line is the
        uptake report’s Non Sector groups added together, and it is usually tiny against the units because most non-sector units are leased into POs.
        So there is no net % for it, and those units are left out of the tonnes-per-unit rate.
      </p>
    </div>
    {inside && (
      <div className="card">
        <h2>{poLabel(pick)}: who holds its {sp.species} units</h2>
        <p className="muted" style={{ fontSize: '0.8rem' }}>{inside.count} holders, {fmtUnits(inside.totalUnits)} units{inside.totalTonnes ? `, ≈${fmtT(inside.totalTonnes)} t in ${yearLabel}` : ''}.{pick === NO_PO ? ' Non-sector licences and administration pool licences: boats outside every PO, whose quota the MMO or Marine Scotland manages. Its quota and swaps are the uptake report\u2019s Non Sector lines added together.' : ''}</p>
        <div style={scroller}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: '0.86rem' }}>
            <thead><tr>{['#', 'Holder', 'Units', 'Est. t', 'Share of PO', 'Boats / licences'].map((h, i) => <th key={h} style={i && i < 5 && i !== 1 ? { ...th, textAlign: 'right' } : th}>{h}</th>)}</tr></thead>
            <tbody>
              {inside.rows.map((h) => (
                <tr key={h.key}>
                  <td style={{ ...td, ...num }}>{h.rank}</td><td style={{ ...td, fontWeight: 600, whiteSpace: 'normal' }}>{h.name}</td>
                  <td style={{ ...td, ...num }}>{fmtUnits(h.units)}</td><td style={{ ...td, ...num }}>{h.tonnes ? fmtT(h.tonnes) : '–'}</td>
                  <td style={{ ...td, ...num }}>{fmtPct(h.share)}</td>
                  <td style={{ ...td, whiteSpace: 'normal', fontSize: '0.8rem' }}>{h.vessels.join(', ') || '—'}<span className="muted"> · {h.lics.join(', ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}
  </>)
}

/* Look-up: a holder, vessel or licence, and everything it holds stock by stock. */
export function Lookup({ rows, rates, yearLabel }) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  const hits = useMemo(() => search(rows, q), [rows, q])
  const groups = useMemo(() => {
    const m = new Map()
    for (const h of hits) {
      const e = m.get(h.hkey) || { hkey: h.hkey, name: h.holder, rows: [] }
      e.rows.push(h); m.set(h.hkey, e)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [hits])
  const sel = pick ? rows.filter((r) => r.hkey === pick) : []
  const bd = useMemo(() => breakdown(sel, rates), [sel, rates])
  const tot = bd.reduce((a, b) => ({ u: a.u + b.units, t: a.t + (b.tonnes || 0) }), { u: 0, t: 0 })
  return (<>
    <div className="card">
      <h2>Holder look-up</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>Search by holder, vessel or licence number — for checking what comes with a vessel, licence or holder before buying or leasing.</p>
      <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPick(null) }} placeholder="e.g. Waterdance, Audacious, 43204"
        style={{ width: 'min(28rem, 100%)', marginBottom: '0.6rem' }} />
      {q.trim().length >= 2 && !groups.length && <p className="muted">Nothing on the register matches that.</p>}
      {groups.length > 0 && (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {groups.slice(0, 40).map((g) => (
            <button key={g.hkey} type="button" className={pick === g.hkey ? '' : 'secondary'} style={{ padding: '0.3rem 0.7rem', fontSize: '0.82rem' }}
              onClick={() => setPick(g.hkey)}>{g.name} <span className="muted">({g.rows.length})</span></button>
          ))}
          {groups.length > 40 && <span className="muted" style={{ fontSize: '0.8rem' }}>+{groups.length - 40} more — narrow the search</span>}
        </div>
      )}
    </div>
    {pick && sel.length > 0 && (
      <div className="card">
        <h2>{sel[0].holder}</h2>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          {sel.length} holding{sel.length === 1 ? '' : 's'} · {[...new Set(sel.map((r) => poLabel(r.po)))].join(', ')} · {fmtUnits(tot.u)} units, ≈{fmtT(tot.t)} t in {yearLabel} where an estimate exists.
        </p>
        <Holdings rows={sel} species={[]} rates={rates} />
        <h3 style={{ marginTop: '1rem' }}>By stock</h3>
        <div style={scroller}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: '0.86rem' }}>
            <thead><tr><th style={th}>Stock</th><th style={{ ...th, textAlign: 'right' }}>FQA units</th><th style={{ ...th, textAlign: 'right' }}>Est. tonnes {yearLabel}</th></tr></thead>
            <tbody>
              {bd.map((b) => (
                <tr key={b.species}>
                  <td style={td}>{b.species}</td><td style={{ ...td, ...num }}>{fmtUnits(b.units)}</td>
                  <td style={{ ...td, ...num }}>{b.tonnes == null ? <span className="muted">units only</span> : fmtT(b.tonnes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}
  </>)
}

