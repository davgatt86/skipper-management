import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { parseMarketPdf } from '../lib/market/parseMarket'
import {
  speciesFor, gradesFor, buildBoard, buildPriceSeries, buildVolumeSeries,
  monthInsights, monthLabel, latestDate, shiftDays, MONTHS,
} from '../lib/market/marketAgg'

const PALETTE = ['#1d4ed8', '#c2410c', '#15803d', '#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#4b5563', '#be123c', '#2563eb', '#65a30d', '#9333ea']
const gbp = n => n == null ? '—' : '£' + Number(n).toFixed(2)
const fmtDate = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'
const num0 = n => n == null ? '—' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })

const th = { textAlign: 'left', padding: '0.4rem 0.55rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--navy)' }
const td = { padding: '0.4rem 0.55rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right' }
const thR = { ...th, textAlign: 'right' }
const chip = (on) => ({ padding: '0.15rem 0.55rem', borderRadius: 999, border: '1px solid var(--border)', fontSize: '0.8rem', cursor: 'pointer', background: on ? 'var(--navy)' : 'var(--grey-50)', color: on ? '#fff' : 'var(--grey-400)', userSelect: 'none' })
const Delta = ({ v }) => v == null ? <span className="muted">—</span>
  : <span style={{ color: v > 0 ? '#15803d' : v < 0 ? '#b91c1c' : 'inherit', fontWeight: 600 }}>{v > 0 ? '▲' : v < 0 ? '▼' : '–'} {gbp(Math.abs(v))}</span>

function UploadBtn({ busy, onFiles }) {
  const ref = useRef()
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf" multiple style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.length) onFiles([...e.target.files]); e.target.value = '' }} />
      <button onClick={() => ref.current.click()} disabled={busy}>{busy ? 'Reading…' : 'Upload price sheets (.pdf)'}</button>
    </>
  )
}

export default function DailyPrices() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'

  const [prices, setPrices] = useState([])
  const [volumes, setVolumes] = useState([])
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState('board')
  const [skipLoaded, setSkipLoaded] = useState(true)
  const [progress, setProgress] = useState(null)
  const cancelRef = useRef(false)

  async function fetchAll(table) {
    const SIZE = 1000
    const { count, error: ce } = await supabase.from(table).select('id', { count: 'exact', head: true })
    if (ce) return { error: ce }
    if (!count) return { data: [] }
    const reqs = []
    for (let i = 0; i * SIZE < count; i++) {
      reqs.push(supabase.from(table).select('*').order('price_date').range(i * SIZE, i * SIZE + SIZE - 1))
    }
    const results = await Promise.all(reqs)
    const bad = results.find(r => r.error)
    if (bad) return { error: bad.error }
    return { data: results.flatMap(r => r.data || []) }
  }

  async function loadAll() {
    const [p, v, d] = await Promise.all([fetchAll('market_prices'), fetchAll('market_volumes'), fetchAll('market_days')])
    if (p.error || v.error || d.error) {
      setReady(false); setPrices([]); setVolumes([]); setDays([]); return
    }
    setReady(true)
    setPrices(p.data); setVolumes(v.data)
    setDays([...d.data].sort((a, b) => b.price_date.localeCompare(a.price_date)))
  }
  useEffect(() => { loadAll().then(() => setLoading(false)) }, [])

  async function upload(files) {
    setBusy(true); setLog([]); setError(''); cancelRef.current = false
    const loadedNames = new Set(days.map(d => d.filename).filter(Boolean))
    let ok = 0, fail = 0, skip = 0
    setProgress({ done: 0, total: files.length, ok, fail, skip })
    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) { setLog(l => [...l, `■ Stopped at ${i} of ${files.length}. Re-run any time — loaded sheets are skipped.`]); break }
      const f = files[i]
      try {
        if (skipLoaded && loadedNames.has(f.name)) { skip++ }
        else {
          const res = await parseMarketPdf(f)
          if (!res.source || !res.price_date || !res.prices.length) {
            fail++; setLog(l => [...l, `✘ ${f.name}: ${res.warnings[0] || 'nothing parsed'}`])
          } else {
            const { data: existing } = await supabase.from('market_days')
              .select('id').eq('source', res.source).eq('price_date', res.price_date).maybeSingle()
            if (existing) await supabase.from('market_days').delete().eq('id', existing.id)
            const { data: day, error: e1 } = await supabase.from('market_days').insert({
              source: res.source, price_date: res.price_date,
              boats: res.meta.boats ?? null, consignments: res.meta.consignments ?? null,
              total_boxes: res.meta.total_boxes ?? null, total_kg: res.meta.total_kg ?? null,
              filename: f.name,
            }).select().single()
            if (e1) throw e1
            const e2 = (await supabase.from('market_prices').insert(res.prices.map(p => ({ ...p, day_id: day.id })))).error
            const e3 = res.volumes.length ? (await supabase.from('market_volumes').insert(res.volumes.map(v => ({ ...v, day_id: day.id })))).error : null
            if (e2 || e3) { await supabase.from('market_days').delete().eq('id', day.id); throw (e2 || e3) }
            ok++; loadedNames.add(f.name)
          }
        }
      } catch (e) { fail++; setLog(l => [...l, `✘ ${f.name}: ${e.message}`]) }
      setProgress({ done: i + 1, total: files.length, ok, fail, skip })
      if ((i & 15) === 0) await new Promise(r => setTimeout(r, 0)) // let the UI breathe
    }
    await loadAll(); setBusy(false)
    setLog(l => [...l, `Done — ${ok} loaded, ${skip} already in, ${fail} failed, of ${files.length}.`])
  }

  const yearsAll = useMemo(() => [...new Set(prices.map(p => p.price_date.slice(0, 4)))].sort(), [prices])

  if (loading) return <div className="container"><p className="muted">Loading…</p></div>

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Daily Prices</h1>
          <p className="muted" style={{ marginBottom: 0 }}>Peterhead &amp; Denmark market board</p>
        </div>
        <Link to="/">← Dashboard</Link>
      </header>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {!ready && <p style={{ color: '#c2410c', fontSize: '0.85rem' }}>The market tables aren't set up yet — run <code>supabase/market_prices.sql</code> in Supabase, then reload.</p>}

      {isSkipper && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <UploadBtn busy={busy} onFiles={upload} />
            {busy && <button className="secondary" onClick={() => { cancelRef.current = true }}>Stop</button>}
            <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={skipLoaded} onChange={e => setSkipLoaded(e.target.checked)} disabled={busy} />
              skip sheets already loaded
            </label>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {days.length} day-sheet{days.length === 1 ? '' : 's'} loaded
            </span>
          </div>
          {progress && (
            <div style={{ marginTop: '0.7rem' }}>
              <div style={{ height: 8, background: 'var(--grey-50)', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <div style={{ width: `${progress.total ? Math.round(progress.done / progress.total * 100) : 0}%`, height: '100%', background: 'var(--navy)', transition: 'width 0.2s' }} />
              </div>
              <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>
                {progress.done} / {progress.total} · {progress.ok} loaded, {progress.skip} skipped, {progress.fail} failed
              </div>
            </div>
          )}
          {log.length > 0 && (
            <ul style={{ marginTop: '0.7rem', marginBottom: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', maxHeight: 180, overflowY: 'auto' }}>
              {log.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
            Big backfill? Do it on a computer, a few months at a time. Stop and resume freely — anything already in is skipped, so re-running only does what's left.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {[['board', 'Board'], ['prices', 'Price trends'], ['volume', 'Volume trends'], ['insights', 'Insights']].map(([k, lbl]) => (
          <button key={k} className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {tab === 'board' && <Board prices={prices} days={days} />}
      {tab === 'prices' && <PriceTrends prices={prices} years={yearsAll} />}
      {tab === 'volume' && <VolumeTrends volumes={volumes} years={yearsAll} />}
      {tab === 'insights' && <Insights prices={prices} volumes={volumes} />}
    </div>
  )
}

// ---------------- Board ----------------
function Board({ prices, days }) {
  const [source, setSource] = useState('PD')
  const board = useMemo(() => buildBoard(prices, source), [prices, source])
  const dayMeta = days.find(d => d.source === source && d.price_date === board.date)
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        {['PD', 'DK'].map(s => <button key={s} className={source === s ? '' : 'secondary'} onClick={() => setSource(s)}>{s === 'PD' ? 'Peterhead' : 'Denmark'}</button>)}
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {board.date ? `latest: ${fmtDate(board.date)}` : 'no data'}
          {dayMeta && source === 'PD' && dayMeta.total_boxes != null && ` · ${num0(dayMeta.total_boxes)} boxes, ${dayMeta.boats ?? '?'} boats`}
          {dayMeta && source === 'DK' && dayMeta.total_kg != null && ` · ${num0(dayMeta.total_kg)} kg total`}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.86rem' }}>
          <thead>
            <tr>
              <th style={th}>Species</th><th style={th}>Grade</th>
              {source === 'PD' && <th style={thR}>Low</th>}
              {source === 'PD' && <th style={thR}>High</th>}
              <th style={thR}>Avg</th><th style={thR}>vs prev day</th><th style={thR}>vs 4-wk avg</th>
            </tr>
          </thead>
          <tbody>
            {board.items.map((r, i) => (
              <tr key={i}>
                <td style={td}>{r.species}</td><td style={td}>{r.grade}</td>
                {source === 'PD' && <td style={tdR}>{gbp(r.low)}</td>}
                {source === 'PD' && <td style={tdR}>{gbp(r.high)}</td>}
                <td style={{ ...tdR, fontWeight: 700 }}>{gbp(r.ave)}</td>
                <td style={tdR}><Delta v={r.dDay} /></td>
                <td style={tdR}><Delta v={r.d4wk} /></td>
              </tr>
            ))}
            {!board.items.length && <tr><td style={td} colSpan={7} className="muted">No prices for this market yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------- shared trend controls ----------------
function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {options.map(([v, l]) => <button key={v} className={value === v ? '' : 'secondary'} style={{ padding: '0.2rem 0.6rem', fontSize: '0.82rem' }} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}
function YearPicker({ years, sel, onToggle }) {
  return (
    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
      {years.map(y => <span key={y} style={chip(sel.includes(y))} onClick={() => onToggle(y)}>{y}</span>)}
    </div>
  )
}
// Range presets: window length + granularity + chart type. Single ranges use
// bars; "Compare years" uses lines (month/week-of-year, one line per year).
const RANGES = [
  ['1W', '1 week', 7, 'day'],
  ['2W', '2 weeks', 14, 'day'],
  ['1M', '1 month', 31, 'week'],
  ['3M', '3 months', 93, 'month'],
  ['6M', '6 months', 186, 'month'],
  ['1Y', '1 year', 366, 'month'],
  ['YRS', 'Compare years', 0, 'month'],
]
const rangeDef = key => RANGES.find(r => r[0] === key)

function xTickFmt(gran, compareYears) {
  if (compareYears) return x => x            // 'Jan'.. or 'W01'
  if (gran === 'day') return x => x.slice(8, 10) + '/' + x.slice(5, 7)
  if (gran === 'week') return x => 'W' + x.slice(6)
  return x => MONTHS[+x.slice(5, 7) - 1] + (x.length >= 7 ? " '" + x.slice(2, 4) : '')
}

function TrendChart({ data, keys, yfmt, kind, gran, compareYears }) {
  if (!data.length || !keys.length) return <p className="muted" style={{ fontSize: '0.85rem' }}>Pick a species and at least one grade to draw the chart.</p>
  const fmtX = xTickFmt(gran, compareYears)
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
      <XAxis dataKey="x" tick={{ fontSize: 11 }} tickFormatter={fmtX} interval="preserveStartEnd" minTickGap={12} />
      <YAxis tick={{ fontSize: 11 }} tickFormatter={yfmt} width={52} />
      <Tooltip formatter={v => yfmt(v)} labelFormatter={fmtX} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
    </>
  )
  return (
    <div style={{ width: '100%', height: 380 }}>
      <ResponsiveContainer>
        {kind === 'bar' ? (
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            {common}
            {keys.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} />)}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            {common}
            {keys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} connectNulls />)}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

// ---------------- Price trends ----------------
function RangePicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {RANGES.map(([k, lbl]) => <button key={k} className={value === k ? '' : 'secondary'} style={{ padding: '0.2rem 0.6rem', fontSize: '0.82rem' }} onClick={() => onChange(k)}>{lbl}</button>)}
    </div>
  )
}

function PriceTrends({ prices, years }) {
  const [source, setSource] = useState('PD')
  const [sel, setSel] = useState([])          // [{species, grades:Set}]
  const [range, setRange] = useState('1Y')
  const [metric, setMetric] = useState('ave')
  const [yrs, setYrs] = useState(years.slice(-2))

  useEffect(() => { setYrs(years.slice(-2)) }, [years]) // eslint-disable-line
  const speciesOpts = useMemo(() => speciesFor(prices, source), [prices, source])
  const realMetric = source === 'DK' ? 'ave' : metric
  const [, , days, gran] = rangeDef(range)
  const compare = range === 'YRS'

  function toggleSpecies(sp) {
    setSel(cur => {
      const found = cur.find(s => s.species === sp)
      if (found) return cur.filter(s => s.species !== sp)
      if (cur.length >= 3) return cur
      return [...cur, { species: sp, grades: new Set(gradesFor(prices, source, sp)) }]
    })
  }
  function toggleGrade(sp, g) {
    setSel(cur => cur.map(s => {
      if (s.species !== sp) return s
      const grades = new Set(s.grades)
      grades.has(g) ? grades.delete(g) : grades.add(g)
      return { ...s, grades }
    }))
  }

  const series = useMemo(() => {
    let rows = prices
    if (!compare) {
      const latest = latestDate(prices, source)
      if (latest) { const start = shiftDays(latest, days); rows = prices.filter(p => p.price_date >= start && p.price_date <= latest) }
    }
    return buildPriceSeries(rows, { selections: sel, source, gran, metric: realMetric, compareYears: compare, years: yrs })
  }, [prices, sel, source, gran, days, realMetric, compare, yrs])

  return (
    <div className="card">
      <div style={{ display: 'grid', gap: '0.7rem', marginBottom: '0.8rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented value={source} onChange={setSource} options={[['PD', 'Peterhead'], ['DK', 'Denmark'], ['Combined', 'Combined']]} />
          {source !== 'DK' && <><span style={{ color: 'var(--border)' }}>|</span>
            <Segmented value={metric} onChange={setMetric} options={[['ave', 'Avg'], ['high', 'High'], ['low', 'Low']]} /></>}
        </div>
        <div><RangePicker value={range} onChange={setRange} /></div>
        {compare && <YearPicker years={years} sel={yrs} onToggle={y => setYrs(c => c.includes(y) ? c.filter(x => x !== y) : [...c, y])} />}
        <div>
          <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.3rem' }}>Species (up to 3):</div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {speciesOpts.map(sp => {
              const on = sel.some(s => s.species === sp)
              const full = !on && sel.length >= 3
              return <span key={sp} style={{ ...chip(on), opacity: full ? 0.4 : 1 }} onClick={() => !full && toggleSpecies(sp)}>{sp}</span>
            })}
          </div>
        </div>
        {sel.map(s => (
          <div key={s.species} style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '0.8rem', minWidth: 70 }}>{s.species}:</span>
            {gradesFor(prices, source, s.species).map(g => (
              <span key={g} style={chip(s.grades.has(g))} onClick={() => toggleGrade(s.species, g)}>{g}</span>
            ))}
          </div>
        ))}
      </div>
      <TrendChart data={series.data} keys={series.keys} yfmt={gbp} kind={compare ? 'line' : 'bar'} gran={gran} compareYears={compare} />
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem', marginBottom: 0 }}>
        {compare ? 'Lines compare the same months across the years you pick.' : 'Bars show the chosen window (daily ≤2 weeks, weekly for a month, monthly beyond).'} Denmark is average price only; Peterhead can show high/avg/low.
      </p>
    </div>
  )
}

// ---------------- Volume trends ----------------
function VolumeTrends({ volumes, years }) {
  const [source, setSource] = useState('PD')
  const [labels, setLabels] = useState([])
  const [range, setRange] = useState('1Y')
  const [yrs, setYrs] = useState(years.slice(-2))
  useEffect(() => { setYrs(years.slice(-2)) }, [years]) // eslint-disable-line
  const [, , days, gran] = rangeDef(range)
  const compare = range === 'YRS'

  const labelOpts = useMemo(() => [...new Set(volumes.filter(v => v.source === source).map(v => v.label))].sort(), [volumes, source])
  const series = useMemo(() => {
    let rows = volumes
    if (!compare) {
      const latest = latestDate(volumes, source)
      if (latest) { const start = shiftDays(latest, days); rows = volumes.filter(v => v.price_date >= start && v.price_date <= latest) }
    }
    return buildVolumeSeries(rows, { labels, source, gran, compareYears: compare, years: yrs })
  }, [volumes, labels, source, gran, days, compare, yrs])
  const unit = source === 'DK' ? 'kg' : 'boxes'

  return (
    <div className="card">
      <div style={{ display: 'grid', gap: '0.7rem', marginBottom: '0.8rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented value={source} onChange={s => { setSource(s); setLabels([]) }} options={[['PD', 'Peterhead (boxes)'], ['DK', 'Denmark (kg)']]} />
        </div>
        <div><RangePicker value={range} onChange={setRange} /></div>
        {compare && <YearPicker years={years} sel={yrs} onToggle={y => setYrs(c => c.includes(y) ? c.filter(x => x !== y) : [...c, y])} />}
        <div>
          <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.3rem' }}>Species ({unit}) — leave empty for all:</div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {labelOpts.map(l => <span key={l} style={chip(labels.includes(l))} onClick={() => setLabels(c => c.includes(l) ? c.filter(x => x !== l) : [...c, l])}>{l}</span>)}
          </div>
        </div>
      </div>
      <TrendChart data={series.data} keys={series.keys} yfmt={num0} kind={compare ? 'line' : 'bar'} gran={gran} compareYears={compare} />
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem', marginBottom: 0 }}>
        Peterhead volume is box counts per species; Denmark is kg landed (from the fiskeauktion.dk export — the Hanstholm report carries a day total only).
      </p>
    </div>
  )
}

// ---------------- Insights ----------------
function Insights({ prices, volumes }) {
  const [source, setSource] = useState('PD')
  const speciesOpts = useMemo(() => speciesFor(prices, source), [prices, source])
  const [sp, setSp] = useState('')
  useEffect(() => { if (!speciesOpts.includes(sp)) setSp(speciesOpts[0] || '') }, [speciesOpts]) // eslint-disable-line
  const ins = useMemo(() => sp ? monthInsights(prices, volumes, sp, source) : null, [prices, volumes, sp, source])

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
        <Segmented value={source} onChange={setSource} options={[['PD', 'Peterhead'], ['DK', 'Denmark'], ['Combined', 'Combined']]} />
        <select value={sp} onChange={e => setSp(e.target.value)}>
          {speciesOpts.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {!ins ? <p className="muted">No data yet.</p> : (
        <>
          <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
            <Stat label="Best avg-price month" value={ins.bestPrice ? `${gbp(ins.bestPrice.ave)}` : '—'} sub={ins.bestPrice && monthLabel(ins.bestPrice.m)} tone="ok" />
            <Stat label="Worst avg-price month" value={ins.worstPrice ? `${gbp(ins.worstPrice.ave)}` : '—'} sub={ins.worstPrice && monthLabel(ins.worstPrice.m)} tone="warn" />
            <Stat label="Most volume month" value={ins.mostVol ? num0(ins.mostVol.total) : '—'} sub={ins.mostVol && monthLabel(ins.mostVol.m)} />
            <Stat label="Least volume month" value={ins.leastVol ? num0(ins.leastVol.total) : '—'} sub={ins.leastVol && monthLabel(ins.leastVol.m)} />
          </div>
          <h4 style={{ margin: '0 0 0.4rem' }}>Volume vs price by month</h4>
          {ins.scatter.length ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" dataKey="vol" name="Volume" tick={{ fontSize: 11 }} tickFormatter={num0} />
                  <YAxis type="number" dataKey="ave" name="Avg £" tick={{ fontSize: 11 }} tickFormatter={gbp} width={52} />
                  <ZAxis range={[60, 60]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => n === 'Avg £' ? gbp(v) : num0(v)} labelFormatter={() => ''} />
                  <Scatter data={ins.scatter} fill="#1d4ed8" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="muted" style={{ fontSize: '0.85rem' }}>Not enough matched volume + price months yet to plot the relationship.</p>}
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem', marginBottom: 0 }}>
            Each dot is a month: further right = more landed, higher up = better average price. Over time this shows whether heavy landings push your price down.
          </p>
        </>
      )}
    </div>
  )
}
function Stat({ label, value, sub, tone }) {
  const fg = tone === 'ok' ? '#15803d' : tone === 'warn' ? '#b91c1c' : 'var(--navy)'
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.7rem', background: 'var(--grey-50)' }}>
      <div className="muted" style={{ fontSize: '0.75rem' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: fg }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.78rem' }}>{sub || '—'}</div>
    </div>
  )
}
