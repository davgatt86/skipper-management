import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import {
  ALL, isAll, applyFilters, sortRows, pairMatrix, dealsFor, stockSeries, usedTone,
  STATUS_ORDER, monthsOf, t1, t2, pct, fmtDay, fmtMonth,
} from '../lib/quota/ukSwaps.js'

/* UK QUOTA SWAPS — who is swapping what with whom, week by week.
 *
 * Shared, read-only, cross-fleet: the Marine Directorate's weekly uptake report
 * (forwarded by the SWFPA), worked into weekly swaps by the Claude scheduled task
 * and loaded into `quota_swaps_data`. See supabase/uk_quota_swaps.sql for who can
 * read it and how it is written, and src/lib/quota/ukSwaps.js for the shaping.
 *
 * Nothing on this page is any fleet's own data, and nothing on it is written
 * from here. */

const TABS = [
  ['week', 'This week'],
  ['pairs', 'Who to whom'],
  ['bal', 'PO balances'],
  ['stock', 'Stock view'],
  ['runout', 'Run-out check'],
  ['reg', 'Every swap'],
  ['intl', 'International & flex'],
  ['na', 'No-allocation stocks'],
]
const KEY_STOCKS = [
  ['POK/2C3A4', 'NS saithe'], ['POK/56-14', 'WoS saithe'], ['LIN/04-C.', 'NS ling'], ['LIN/6X14.', 'Western ling'],
  ['HKE/2AC4-C', 'NS hake'], ['COD/2A3AX4', 'NS cod'], ['HAD/2AC4.', 'NS haddock'], ['WHG/2AC4.', 'NS whiting'],
  ['ANF/2AC4-C', 'NS monk'], ['ANF/56-14', 'WoS monk'], ['LEZ/2AC4-C', 'NS megrim'], ['PLE/2A3AX4', 'NS plaice'],
  ['NEP/2AC4-C', 'NS nephrops'],
]
const LINE_COLOURS = ['var(--hull)', 'var(--rust)', 'var(--kelp)', 'var(--brass)', '#7B4FA0', '#2A8FA5', '#B5651D', '#8A6D8F']
const TONE = { rust: 'var(--rust)', brass: 'var(--brass)', kelp: 'var(--kelp)' }

const th = { textAlign: 'left', padding: '0.5rem 0.6rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--navy)',
  position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', cursor: 'pointer', userSelect: 'none', fontSize: '0.8rem' }
const td = { padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--line-2)', whiteSpace: 'nowrap', verticalAlign: 'top' }
const num = { fontFamily: 'var(--font-mono)', textAlign: 'right' }
const scroller = { maxHeight: '68vh', overflow: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid var(--line)', borderRadius: 4 }
const signed = (v) => ({ color: v > 0.05 ? 'var(--kelp)' : v < -0.05 ? 'var(--rust)' : 'var(--mute)' })

function Pill({ tone, children }) {
  const c = TONE[tone] || 'var(--mute)'
  return <span style={{ display: 'inline-block', padding: '0.05rem 0.55rem', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
    color: c, background: `color-mix(in srgb, ${c} 15%, transparent)` }}>{children}</span>
}
const CONF_TONE = { Certain: 'kelp', Likely: 'brass', Estimate: null }
const STATUS_TONE = { Short: 'rust', Tight: 'brass', OK: 'kelp' }

/* A table whose header stays put and sorts on a tap. */
function Grid({ cols, rows, initial, limit = 500, empty = 'Nothing for these filters.' }) {
  const [sort, setSort] = useState(initial || { k: cols[0].k, d: 1 })
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.k === sort.k)
    if (c?.sortBy) return rows.slice().sort((a, b) => (c.sortBy(a) - c.sortBy(b)) * sort.d)
    return sortRows(rows, sort.k, sort.d)
  }, [rows, sort, cols])
  const shown = sorted.slice(0, limit)
  const tap = (c) => setSort((s) => (s.k === c.k ? { k: c.k, d: -s.d } : { k: c.k, d: c.num ? -1 : 1 }))
  return (
    <>
      <div style={scroller}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: '0.88rem' }}>
          <thead><tr>
            {cols.map((c) => (
              <th key={c.k} style={c.num ? { ...th, textAlign: 'right' } : th} onClick={() => tap(c)}
                aria-sort={sort.k === c.k ? (sort.d > 0 ? 'ascending' : 'descending') : 'none'}>
                {c.label}{sort.k === c.k ? (sort.d > 0 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.key ?? r.id ?? i}>
                {cols.map((c) => (
                  <td key={c.k} style={{ ...td, ...(c.num ? num : null), ...(c.wrap ? { whiteSpace: 'normal', minWidth: '14rem', fontSize: '0.8rem' } : null), ...(c.style ? c.style(r) : null) }}>
                    {c.render ? c.render(r) : r[c.k]}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && <tr><td style={td} colSpan={cols.length} className="muted">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && <p className="muted" style={{ fontSize: '0.78rem', margin: '0.4rem 0 0' }}>
        Showing the first {limit} of {sorted.length} rows — narrow the filters to see the rest.</p>}
    </>
  )
}

function UsedBar({ u }) {
  if (u == null) return null
  const c = TONE[usedTone(u)]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 44, height: 8, borderRadius: 4, background: 'var(--line-2)', overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', height: '100%', width: Math.min(100, Math.max(0, u * 100)) + '%', background: c }} />
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', color: c, fontWeight: 600 }}>{pct(u)}</span>
    </span>
  )
}

export default function QuotaSwaps() {
  const { appUser } = useAuth()
  const allowed = ['skipper', 'viewer'].includes(appUser?.role)

  const [store, setStore] = useState({})      // `${dataset}:${year}` -> rows
  const [updated, setUpdated] = useState(null)
  const [loaded, setLoaded] = useState({})     // year -> true
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const [tab, setTab] = useState('week')
  const [year, setYear] = useState(null)
  const [month, setMonth] = useState(ALL)
  const [stock, setStock] = useState(ALL)
  const [po, setPo] = useState(ALL)
  const [show, setShow] = useState('all')
  const [pick, setPick] = useState({ from: null, to: null })
  const [search, setSearch] = useState('')
  const [hideOk, setHideOk] = useState(false)

  async function loadYears(years) {
    setBusy(true); setError('')
    const { data, error } = await supabase.from('quota_swaps_data').select('dataset,year,payload,updated_at').in('year', years)
    if (error) { setError(error.message); setBusy(false); return }
    setStore((s) => {
      const n = { ...s }
      for (const r of data || []) n[`${r.dataset}:${r.year}`] = r.payload
      return n
    })
    const newest = (data || []).map((r) => r.updated_at).sort().pop()
    if (newest) setUpdated((u) => (u && u > newest ? u : newest))
    setLoaded((l) => ({ ...l, ...Object.fromEntries(years.map((y) => [y, true])) }))
    setBusy(false)
  }

  useEffect(() => { if (allowed) loadYears([0]); else setBusy(false) }, [allowed])

  const periods = store['periods:0'] || []
  const years = useMemo(() => [...new Set(periods.map((p) => p.year))].sort((a, b) => b - a), [periods])
  useEffect(() => { if (year == null && years.length) setYear(years[0]) }, [years, year])
  useEffect(() => { if (year != null && !loaded[year]) loadYears([year]) }, [year])

  const get = (ds) => store[`${ds}:${year}`] || []
  const head = (store['headline:0'] || [])[0]
  const stocks = store['stocks:0'] || []
  const pos = store['pos:0'] || []
  const months = useMemo(() => monthsOf(periods, year), [periods, year])
  const f = { month, stock, po }
  const stockName = (code) => stocks.find((s) => s.stock === code)?.stock_name || code

  function reset() { setMonth(ALL); setStock(ALL); setPo(ALL); setShow('all'); setPick({ from: null, to: null }); setSearch(''); setYear(years[0] ?? null) }

  if (!allowed) return <AppShell><div className="card"><p className="muted">UK quota swaps is for skippers and viewers.</p></div></AppShell>

  const latestOfYear = periods.filter((p) => p.year === year).map((p) => p.date).sort().pop()
  const nothing = !busy && !periods.length

  return (
    <AppShell>
      <PageHeader
        title="UK quota swaps"
        sub={head
          ? `Latest Marine Directorate report ${fmtDay(head.report_date)}: ${head.stocks_moved} stocks moved and ${t1(head.tonnes_moved)} t changed hands between groups. Built from the uptake reports the SWFPA forwards, since ${fmtDay(head.first_report)}.`
          : 'Who is swapping what with whom, week by week, from the Marine Directorate uptake reports.'}
      />

      {error && <p className="error">{error}</p>}
      {nothing && !error && <div className="card"><p className="muted" style={{ margin: 0 }}>No swaps data loaded yet.</p></div>}

      {!nothing && (<>
        {/* The filters stay on screen while a long page scrolls — on a desktop.
            On a phone the box is a third of the screen, so it scrolls away
            (.qs-filters in index.css). */}
        <div className="card qs-filters" style={{ padding: '0.8rem 1rem', marginBottom: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="muted" style={{ display: 'grid', gap: 2, fontSize: '0.75rem' }}>Year
              <select value={year ?? ''} onChange={(e) => { setYear(Number(e.target.value)); setMonth(ALL) }}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select></label>
            <label className="muted" style={{ display: 'grid', gap: 2, fontSize: '0.75rem' }}>Month
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value={ALL}>All months</option>
                {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
              </select></label>
            <label className="muted" style={{ display: 'grid', gap: 2, fontSize: '0.75rem' }}>Stock
              <select value={stock} onChange={(e) => setStock(e.target.value)} style={{ maxWidth: 260 }}>
                <option value={ALL}>All stocks</option>
                {stocks.map((s) => <option key={s.stock} value={s.stock}>{s.stock_name} ({s.stock})</option>)}
              </select></label>
            <label className="muted" style={{ display: 'grid', gap: 2, fontSize: '0.75rem' }}>PO / group
              <select value={po} onChange={(e) => { setPo(e.target.value); setPick({ from: null, to: null }) }}>
                <option value={ALL}>All POs and groups</option>
                {pos.map((p) => <option key={p.po} value={p.po}>{p.po}</option>)}
              </select></label>
            <button type="button" className="secondary" onClick={reset} style={{ padding: '0.4rem 0.9rem' }}>Reset</button>
            {busy && <span className="muted" style={{ fontSize: '0.8rem' }}>Loading…</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
            {TABS.map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? '' : 'secondary'} style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}>{lbl}</button>
            ))}
          </div>
        </div>

        {tab === 'week' && <ThisWeek head={head} rows={store['this_week:0'] || []} />}
        {tab === 'pairs' && <Pairs pairs={get('pairs')} f={f} show={show} setShow={setShow} pick={pick} setPick={setPick} />}
        {tab === 'bal' && <Balances rows={get('balances')} f={f} pos={pos} setPo={setPo} asAt={latestOfYear} />}
        {tab === 'stock' && <StockView stock={stock} setStock={setStock} weekly={get('weekly')} intlWeekly={get('intl_weekly')}
          periods={periods.filter((p) => p.year === year)} balances={get('balances')} name={stockName(stock)} />}
        {tab === 'runout' && <RunOut rows={get('runout')} f={f} hideOk={hideOk} setHideOk={setHideOk} year={year} />}
        {tab === 'reg' && <Register rows={get('weekly')} f={f} search={search} setSearch={setSearch} />}
        {tab === 'intl' && <IntlFlex ytd={get('intl_ytd')} weekly={get('intl_weekly')} flex={get('flex_ytd')} f={f} />}
        {tab === 'na' && <NoAlloc rows={get('noalloc')} f={f} />}

        <p className="muted" style={{ fontSize: '0.75rem', marginTop: '1rem' }}>
          Source: Marine Directorate weekly quota uptake reports forwarded by the SWFPA{updated ? `, loaded ${fmtDay(updated.slice(0, 10))}` : ''}.
          A week's figure is the change in each group's "Change in year" between consecutive reports. Reports lag landings by 2–3 weeks;
          the 16 Jul 2025 report is missing, so its swaps sit in the 23 Jul 2025 week. Tonnes throughout.
        </p>
      </>)}
    </AppShell>
  )
}

function ThisWeek({ head, rows }) {
  if (!head) return null
  const tiles = [
    ['Report date', fmtDay(head.report_date)], ['Period covered', head.period],
    ['Stocks with swaps', head.stocks_moved], ['Tonnes changing hands', t1(head.tonnes_moved)],
    ['Stocks with UK international swaps', head.intl_stocks],
  ]
  return (<>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10.5rem, 1fr))', gap: '0.7rem', marginBottom: '0.8rem' }}>
      {tiles.map(([l, v]) => (
        <div key={l} className="card" style={{ margin: 0, padding: '0.8rem 1rem' }}>
          <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>{l}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--hull)', margin: '0.2rem 0 0' }}>{v}</p>
        </div>
      ))}
    </div>
    {head.biggest_stock && <p style={{ margin: '0 0 0.8rem' }}>
      Biggest single move: <b>{t1(head.biggest_t)} t</b> of <b>{head.biggest_stock}</b> from <b>{head.biggest_from}</b> to <b>{head.biggest_to}</b>{' '}
      <Pill tone={CONF_TONE[head.biggest_conf]}>{head.biggest_conf}</Pill></p>}
    <div className="card">
      <h2>Every stock that moved</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>Out = total transferred out by groups that week. UK international = net swap with other countries (+ in, − out). Tap a heading to sort.</p>
      <Grid rows={rows} initial={{ k: 'moved_out_t', d: -1 }} cols={[
        { k: 'stock_name', label: 'Stock' },
        { k: 'moved_out_t', label: 'Out (t)', num: true, render: (r) => t1(r.moved_out_t) },
        { k: 'uk_intl_t', label: 'UK international (t)', num: true, render: (r) => t1(r.uk_intl_t), style: (r) => signed(r.uk_intl_t) },
        { k: 'out_by', label: 'Transferred out by (t)', wrap: true },
        { k: 'in_by', label: 'Received by (t)', wrap: true },
      ]} />
    </div>
  </>)
}

function Pairs({ pairs, f, show, setShow, pick, setPick }) {
  const m = useMemo(() => pairMatrix(pairs, { ...f, show }), [pairs, f.month, f.stock, f.po, show])
  const deals = useMemo(() => dealsFor(pairs, { ...f, ...pick, show }), [pairs, f.month, f.stock, f.po, pick, show])
  const heat = (v) => {
    if (!v) return {}
    const k = Math.sqrt(v / (m.max || 1))
    return { background: `color-mix(in srgb, var(--hull) ${Math.round(12 + 80 * k)}%, transparent)`, color: k > 0.55 ? '#fff' : undefined }
  }
  const cellBase = { ...td, ...num, padding: '0.35rem 0.5rem', cursor: 'pointer', minWidth: '3.6rem', border: '1px solid var(--surface)' }
  const label = pick.from && pick.to ? `${pick.from} → ${pick.to}` : pick.from ? `everything ${pick.from} gave` : pick.to ? `everything ${pick.to} received` : 'all pairs'
  return (<>
    <div className="card">
      <h2>Who gave quota to whom</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Rows gave, columns received, in tonnes, for the year, month and stock picked. The reports only show each group's net change,
        so the other side of each deal is worked out: <Pill tone="kelp">Certain</Pill> one side of that week had a single group;{' '}
        <Pill tone="brass">Likely</Pill> tonnages matched exactly; <Pill>Estimate</Pill> the rest, split in proportion.
        "International" is the UK's swaps with other countries. Tap a box for the deals behind it.
      </p>
      <label className="muted" style={{ fontSize: '0.8rem', display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: '0.6rem' }}>Count
        <select value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="all">every match (certain, likely and estimate)</option>
          <option value="sure">certain and likely only</option>
          <option value="certain">certain only</option>
        </select></label>
      {!m.givers.length ? <p className="muted">No swaps for these filters.</p> : (
        <div style={scroller}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.8rem' }}>
            <thead><tr>
              <th style={{ ...th, left: 0, zIndex: 2, cursor: 'default' }}>Gave ↓ · Received →</th>
              {m.receivers.map((r) => <th key={r} style={{ ...th, writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '7.5rem', textAlign: 'left', verticalAlign: 'bottom' }}
                onClick={() => setPick({ from: null, to: r })}>{r}</th>)}
              <th style={{ ...th, writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '7.5rem', cursor: 'default' }}>Total given</th>
            </tr></thead>
            <tbody>
              {m.givers.map((g) => (
                <tr key={g}>
                  <th style={{ ...th, position: 'sticky', left: 0, top: 'auto', zIndex: 1, textAlign: 'right', borderBottom: '1px solid var(--line-2)' }}
                    onClick={() => setPick({ from: g, to: null })}>{g}</th>
                  {m.receivers.map((r) => {
                    const v = m.at(g, r)
                    const sel = pick.from === g && pick.to === r
                    return <td key={r} style={{ ...cellBase, ...heat(v), outline: sel ? '2px solid var(--ink)' : undefined, cursor: v ? 'pointer' : 'default' }}
                      onClick={() => v && setPick({ from: g, to: r })}>{v ? t1(v) : ''}</td>
                  })}
                  <td style={{ ...cellBase, fontWeight: 700, background: 'var(--line-2)' }}>{t1(m.given(g))}</td>
                </tr>
              ))}
              <tr>
                <th style={{ ...th, position: 'sticky', left: 0, top: 'auto', textAlign: 'right', cursor: 'default' }}>Total received</th>
                {m.receivers.map((r) => <td key={r} style={{ ...cellBase, fontWeight: 700, background: 'var(--line-2)' }}>{t1(m.got(r))}</td>)}
                <td style={cellBase} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
    <div className="card">
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>The deals behind it</h2>
        <span className="muted" style={{ fontSize: '0.85rem' }}>{label}</span>
        {(pick.from || pick.to) && <button type="button" className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
          onClick={() => setPick({ from: null, to: null })}>Show all pairs</button>}
      </div>
      <div style={{ marginTop: '0.6rem' }}>
        <Grid rows={deals} limit={400} initial={{ k: 'date', d: -1 }} cols={[
          { k: 'date', label: 'Report', render: (r) => fmtDay(r.date) },
          { k: 'stock_name', label: 'Stock' },
          { k: 'from_po', label: 'From' },
          { k: 'to_po', label: 'To' },
          { k: 'tonnes', label: 'Tonnes', num: true, render: (r) => t1(r.tonnes) },
          { k: 'confidence', label: 'How sure', render: (r) => <Pill tone={CONF_TONE[r.confidence]}>{r.confidence}</Pill> },
        ]} />
      </div>
    </div>
  </>)
}

/* A column that repeats the filter on every row is noise: with one PO picked,
   its name down the whole table says nothing, and it pushes the Used bar off a
   phone screen. */
const balCols = ({ stock, po }) => [
  ...(isAll(stock) ? [{ k: 'stock_name', label: 'Stock' }] : []),
  ...(isAll(po) ? [{ k: 'po', label: 'PO / group' }] : []),
  { k: 'initial_t', label: 'Initial (t)', num: true, render: (r) => t1(r.initial_t) },
  { k: 'swaps_in_t', label: 'Swapped in (t)', num: true, render: (r) => t1(r.swaps_in_t), style: (r) => ({ color: r.swaps_in_t ? 'var(--kelp)' : 'var(--mute)' }) },
  { k: 'swaps_out_t', label: 'Swapped out (t)', num: true, render: (r) => t1(r.swaps_out_t), style: (r) => ({ color: r.swaps_out_t ? 'var(--rust)' : 'var(--mute)' }) },
  { k: 'quota_t', label: 'Quota now (t)', num: true, render: (r) => t1(r.quota_t) },
  { k: 'landed_t', label: 'Landed (t)', num: true, render: (r) => t1(r.landed_t) },
  { k: 'left_t', label: 'Left (t)', num: true, render: (r) => t1(r.left_t), style: (r) => (r.left_t < -0.05 ? { color: 'var(--rust)', fontWeight: 700 } : null) },
  { k: 'used_pct', label: 'Used', render: (r) => <UsedBar u={r.used_pct} /> },
]

function Balances({ rows, f, pos, setPo, asAt }) {
  const pickNone = isAll(f.po) && isAll(f.stock)
  const shown = useMemo(() => {
    if (pickNone) return []
    let r = applyFilters(rows, f, { month: false })
    if (isAll(f.po)) r = r.filter((x) => x.po !== 'UK total' || !isAll(f.stock))
    return r
  }, [rows, f.po, f.stock, pickNone])
  return (
    <div className="card">
      <h2>PO balances</h2>
      {pickNone ? (<>
        <p className="muted" style={{ fontSize: '0.85rem' }}>Pick a PO, or a stock, in the filters — or tap a PO here. With a PO picked you see every stock it holds; with a stock picked, every PO holding it.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {pos.slice(0, 22).map((p) => <button key={p.po} type="button" className="secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem' }} onClick={() => setPo(p.po)}>{p.po}</button>)}
        </div>
      </>) : (<>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Position at the latest report of the year{asAt ? ` (${fmtDay(asAt)})` : ''}. Initial = TAC share plus banked quota; quota now = initial plus swaps in, less swaps out.
          Landed includes flex adjustments. The bar is how much is used: green under 75%, amber 75–90%, red over 90%.
        </p>
        <Grid rows={shown} cols={balCols(f)} initial={{ k: 'used_pct', d: -1 }} />
      </>)}
    </div>
  )
}

function StockView({ stock, setStock, weekly, intlWeekly, periods, balances, name }) {
  const s = useMemo(() => stockSeries({ weekly, intlWeekly, periods, stock }), [weekly, intlWeekly, periods, stock])
  const rows = useMemo(() => (isAll(stock) ? [] : balances.filter((b) => b.stock === stock)), [balances, stock])
  if (isAll(stock)) {
    return (
      <div className="card">
        <h2>Pick a stock</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>Use the Stock filter above, or one of these:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {KEY_STOCKS.map(([c, l]) => <button key={c} type="button" className="secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem' }} onClick={() => setStock(c)}>{l}</button>)}
        </div>
      </div>
    )
  }
  const lines = [...s.keys.map((k, i) => ({ k, c: LINE_COLOURS[i % LINE_COLOURS.length], dash: null })),
    ...(s.hasUk ? [{ k: 'UK international', c: 'var(--ink)', dash: '5 4' }] : [])]
  return (<>
    <div className="card">
      <h2>{name}: net swaps through the year (t)</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>Each line is a group's swaps so far this year: above zero = net received, below = net transferred out. Dashed = the UK's net international swap.</p>
      {!s.data.length || !lines.length ? <p className="muted">No swaps in this stock this year.</p> : (
        <div style={{ width: '100%', height: 340 }}>
          <ResponsiveContainer>
            <LineChart data={s.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => fmtDay(d).replace(/ \d{4}$/, '')} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => Math.round(v).toLocaleString('en-GB')} />
              <ReferenceLine y={0} stroke="var(--mute)" />
              <Tooltip formatter={(v, n) => [t1(v) + ' t', n]} labelFormatter={fmtDay} />
              {lines.map((l) => <Line key={l.k} type="stepAfter" dataKey={l.k} stroke={l.c} strokeDasharray={l.dash || undefined} dot={false} strokeWidth={2} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem 1rem', fontSize: '0.8rem', marginTop: '0.4rem' }}>
        {lines.map((l) => {
          const last = s.data.length ? s.data[s.data.length - 1][l.k] : 0
          return <span key={l.k}><span style={{ display: 'inline-block', width: 14, height: 3, background: l.c, verticalAlign: 'middle', marginRight: 5 }} />
            {l.k} <span style={{ fontFamily: 'var(--font-mono)' }}>{t1(last)}</span></span>
        })}
      </div>
    </div>
    <div className="card">
      <h2>Every group holding {name}</h2>
      <Grid rows={rows} cols={balCols({ stock, po: ALL })} initial={{ k: 'quota_t', d: -1 }} />
    </div>
  </>)
}

function RunOut({ rows, f, hideOk, setHideOk, year }) {
  const shown = useMemo(() => {
    let r = applyFilters(rows, f, { month: false })
    if (hideOk) r = r.filter((x) => x.status !== 'OK')
    return r
  }, [rows, f.stock, f.po, hideOk])
  const any = rows[0]
  return (
    <div className="card">
      <h2>Will it last?</h2>
      {!rows.length ? <p className="muted">The run-out check is for the current quota year only{year ? ` — pick the latest year` : ''}.</p> : (<>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Quota left at {fmtDay(any.report_date)} against what the same group landed from {fmtDay(any.ly_from)} to the end of last year's quota year ({fmtDay(any.ly_to)}).{' '}
          <Pill tone="rust">Short</Pill> last year's pace would overrun the quota; <Pill tone="brass">Tight</Pill> under 10% spare; <Pill tone="kelp">OK</Pill> room to spare.
        </p>
        <label className="muted" style={{ fontSize: '0.8rem', display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: '0.6rem' }}>
          <input type="checkbox" checked={hideOk} onChange={(e) => setHideOk(e.target.checked)} /> Hide OK rows</label>
        <Grid rows={shown} initial={{ k: 'status', d: 1 }} cols={[
          { k: 'stock_name', label: 'Stock' },
          { k: 'po', label: 'PO / group' },
          { k: 'quota_t', label: 'Quota (t)', num: true, render: (r) => t1(r.quota_t) },
          { k: 'left_t', label: 'Left now (t)', num: true, render: (r) => t1(r.left_t) },
          { k: 'landed_after_ly_t', label: 'Landed after this date last year (t)', num: true, render: (r) => t1(r.landed_after_ly_t) },
          { k: 'margin_t', label: 'Margin (t)', num: true, render: (r) => t1(r.margin_t), style: (r) => signed(r.margin_t) },
          { k: 'status', label: 'Status', sortBy: (r) => STATUS_ORDER[r.status] * 1e7 + r.margin_t, render: (r) => <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill> },
        ]} />
      </>)}
    </div>
  )
}

function Register({ rows, f, search, setSearch }) {
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    let r = applyFilters(rows, f)
    if (q) r = r.filter((x) => `${x.stock_name} ${x.stock} ${x.po} ${x.counterparty}`.toLowerCase().includes(q))
    return r
  }, [rows, f.month, f.stock, f.po, search])
  return (
    <div className="card">
      <h2>Every swap, week by week</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>One row per group, stock and report: what it received or transferred out that week. "Likely counterparty" is the best single guess.</p>
      <input type="search" placeholder="Search stock, PO or counterparty" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: '0.6rem', minWidth: 260 }} />
      <Grid rows={shown} initial={{ k: 'date', d: -1 }} cols={[
        { k: 'date', label: 'Report', render: (r) => fmtDay(r.date) },
        { k: 'stock_name', label: 'Stock' },
        { k: 'po', label: 'PO / group' },
        { k: 'in_t', label: 'In (t)', num: true, render: (r) => (r.in_t ? t1(r.in_t) : ''), style: () => ({ color: 'var(--kelp)' }) },
        { k: 'out_t', label: 'Out (t)', num: true, render: (r) => (r.out_t ? t1(r.out_t) : ''), style: () => ({ color: 'var(--rust)' }) },
        { k: 'ytd_t', label: 'Net swaps so far (t)', num: true, render: (r) => t1(r.ytd_t), style: (r) => signed(r.ytd_t) },
        { k: 'counterparty', label: 'Likely counterparty', wrap: true },
        { k: 'uk_intl_t', label: 'UK international that week (t)', num: true, render: (r) => (r.uk_intl_t ? t1(r.uk_intl_t) : ''), style: (r) => signed(r.uk_intl_t) },
      ]} />
    </div>
  )
}

function IntlFlex({ ytd, weekly, flex, f }) {
  const bars = useMemo(() => ytd.filter((r) => Math.abs(r.intl_ytd_t) >= 1).sort((a, b) => b.intl_ytd_t - a.intl_ytd_t), [ytd])
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.intl_ytd_t)))
  const wk = useMemo(() => applyFilters(weekly, f, { po: false }), [weekly, f.month, f.stock])
  const fx = useMemo(() => {
    let r = applyFilters(flex, f, { month: false })
    if (isAll(f.po)) r = r.filter((x) => x.po !== 'UK total' || !isAll(f.stock))
    return r
  }, [flex, f.stock, f.po])
  return (<>
    <div className="card">
      <h2>UK swaps with other countries, year to date</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>Right = swapped in from other countries; left = swapped out.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, 14rem) 1fr', gap: '0.25rem 0.8rem', alignItems: 'center', fontSize: '0.82rem' }}>
        {bars.map((b) => {
          const w = (Math.abs(b.intl_ytd_t) / max) * 50
          const hit = !isAll(f.stock) && b.stock === f.stock
          return [
            <span key={b.stock + 'n'} style={{ textAlign: 'right', fontWeight: hit ? 700 : 400 }}>{b.stock_name}</span>,
            <span key={b.stock + 'b'} style={{ position: 'relative', height: 18 }}>
              <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--mute)' }} />
              <span style={{ position: 'absolute', top: 3, height: 12, borderRadius: 3, background: b.intl_ytd_t > 0 ? 'var(--kelp)' : 'var(--rust)',
                left: b.intl_ytd_t > 0 ? '50%' : `${50 - w}%`, width: `${w}%`, opacity: !isAll(f.stock) && !hit ? 0.35 : 1 }} />
              <span style={{ position: 'absolute', top: 0, fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                ...(b.intl_ytd_t > 0 ? { left: `calc(${50 + w}% + 4px)` } : { right: `calc(${50 + w}% + 4px)` }) }}>{t1(b.intl_ytd_t)}</span>
            </span>,
          ]
        })}
      </div>
      {!bars.length && <p className="muted">No international swaps this year.</p>}
    </div>
    <div className="card">
      <h2>International swaps week by week</h2>
      <Grid rows={wk} initial={{ k: 'date', d: -1 }} cols={[
        { k: 'date', label: 'Report', render: (r) => fmtDay(r.date) },
        { k: 'stock_name', label: 'Stock' },
        { k: 'intl_t', label: 'This week (t)', num: true, render: (r) => t1(r.intl_t), style: (r) => signed(r.intl_t) },
        { k: 'intl_ytd_t', label: 'Year to date (t)', num: true, render: (r) => t1(r.intl_ytd_t), style: (r) => signed(r.intl_ytd_t) },
      ]} />
    </div>
    <div className="card">
      <h2>Flex between areas, year to date</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>Landings counted against another area's quota under the flex rules (e.g. North Sea saithe set against West of Scotland saithe). Minus = moved off this stock; plus = put onto it. Not a quota transfer.</p>
      <Grid rows={fx} initial={{ k: 'flex_ytd_t', d: 1 }} cols={[
        { k: 'stock_name', label: 'Stock' },
        { k: 'po', label: 'PO / group' },
        { k: 'flex_ytd_t', label: 'Flex year to date (t)', num: true, render: (r) => t1(r.flex_ytd_t), style: (r) => signed(r.flex_ytd_t) },
      ]} />
    </div>
  </>)
}

function NoAlloc({ rows, f }) {
  const shown = useMemo(() => applyFilters(rows, f), [rows, f.month, f.stock, f.po])
  return (
    <div className="card">
      <h2>Stocks with no PO allocation</h2>
      <p className="muted" style={{ fontSize: '0.8rem' }}>Rockall cod, Western spurdog, Norway demersal access, Faroe flatfish and the minor deep-sea lines are held in the UK pool, so there are no swaps to track — these are weekly landings by group. WoS pollack is included too. Small negatives are corrections to earlier weeks.</p>
      <Grid rows={shown} initial={{ k: 'date', d: -1 }} cols={[
        { k: 'date', label: 'Report', render: (r) => fmtDay(r.date) },
        { k: 'stock_name', label: 'Stock' },
        { k: 'po', label: 'PO / group' },
        { k: 'landed_t', label: 'Landed this week (t)', num: true, render: (r) => t2(r.landed_t) },
        { k: 'landed_ytd_t', label: 'Landed year to date (t)', num: true, render: (r) => t2(r.landed_ytd_t) },
      ]} />
    </div>
  )
}
