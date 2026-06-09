import { useEffect, useMemo, useState } from 'react'
import BackNav from '../BackNav'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { bySpecies, gradesFor, bestBuyerByGrade, priceTrendSeries, seasonalityGrid } from '../lib/salesAgg'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from 'recharts'

const PALETTE = ['#1e3a5f', '#c2410c', '#0e7490', '#15803d', '#7c3aed', '#b45309', '#be123c', '#4338ca']
const gbp = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = n => Number(n || 0).toLocaleString('en-GB')
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtMonth = x => { const [y, m] = String(x).split('-'); return m ? `${MON[Number(m) - 1]} ${y.slice(2)}` : x }

const th = { textAlign: 'left', padding: '0.45rem 0.6rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--navy)' }
const td = { padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right' }
const thR = { ...th, textAlign: 'right' }
const Scroll = ({ children }) => <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>

export default function SalesInsights() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'

  const [landings, setLandings] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('trends')
  const [scope, setScope] = useState('all')   // 'all' | a year string

  // load landings once
  useEffect(() => {
    if (!isSkipper) { setLoading(false); return }
    (async () => {
      const { data, error } = await supabase.from('sales_landings').select('id, landing_date, market').order('landing_date')
      if (error) setError(error.message)
      setLandings(data || [])
    })()
  }, [isSkipper])

  const years = useMemo(() => [...new Set(landings.map(l => (l.landing_date || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [landings])

  // load rows for the current scope
  useEffect(() => {
    if (!isSkipper) return
    (async () => {
      setLoading(true); setError('')
      const ids = landings.filter(l => scope === 'all' || (l.landing_date || '').startsWith(scope)).map(l => l.id)
      if (!ids.length) { setRows([]); setLoading(false); return }
      const out = []
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from('sales_rows').select('*').in('landing_id', ids.slice(i, i + 200))
        if (error) { setError(error.message); break }
        out.push(...(data || []))
      }
      setRows(out); setLoading(false)
    })()
  }, [isSkipper, landings, scope])

  const landingById = useMemo(() => Object.fromEntries(landings.map(l => [l.id, l])), [landings])

  if (!isSkipper) {
    return (
      <div className="container">
        <div style={{ marginBottom: '1rem' }}><BackNav /></div>
        <div className="card"><p className="muted">Sales insights are available to the skipper.</p></div>
      </div>
    )
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}><BackNav /></div>

      <div className="card">
        <h1 style={{ marginBottom: '0.5rem' }}>Sales Insights</h1>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {[['trends', 'Price Trends'], ['buyers', 'Buyer League'], ['season', 'Seasonality']].map(([k, lbl]) => (
            <button key={k} className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: '0.8rem' }}>Period:</span>
          <button className={scope === 'all' ? '' : 'secondary'} style={{ padding: '0.2rem 0.6rem', fontSize: '0.82rem' }} onClick={() => setScope('all')}>All</button>
          {years.map(y => <button key={y} className={scope === y ? '' : 'secondary'} style={{ padding: '0.2rem 0.6rem', fontSize: '0.82rem' }} onClick={() => setScope(y)}>{y}</button>)}
        </div>
      </div>

      {loading ? <div className="card"><p className="muted">Loading…</p></div>
        : error ? <div className="card"><p className="error">Error: {error}</p></div>
          : rows.length === 0 ? <div className="card"><p className="muted">No sales in this period yet.</p></div>
            : tab === 'trends' ? <Trends rows={rows} landingById={landingById} />
              : tab === 'buyers' ? <BuyerLeague rows={rows} />
                : <Seasonality rows={rows} landingById={landingById} />}
    </div>
  )
}

function Trends({ rows, landingById }) {
  const speciesList = useMemo(() => bySpecies(rows).map(s => s.species), [rows])
  const [species, setSpecies] = useState('')
  const [selGrades, setSelGrades] = useState([])
  const [metric, setMetric] = useState('pkg')   // 'pkg' | 'box'
  const [period, setPeriod] = useState('month') // 'month' | 'year'
  const [chart, setChart] = useState('line')    // 'line' | 'bar'

  const sp = species || speciesList[0] || ''
  const grades = useMemo(() => gradesFor(rows, sp).map(g => g.grade), [rows, sp])

  // default selected grades when species/scope changes
  useEffect(() => { setSelGrades(grades.slice(0, 5)) }, [sp, rows]) // eslint-disable-line

  const toggle = g => setSelGrades(s => s.includes(g) ? s.filter(x => x !== g) : [...s, g])
  const series = useMemo(
    () => priceTrendSeries(rows, landingById, { species: sp, grades: selGrades, metric, period }),
    [rows, landingById, sp, selGrades, metric, period]
  )
  const yLabel = metric === 'box' ? '£/box' : '£/kg'

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <label style={{ fontSize: '0.85rem' }}>
          <div className="muted" style={{ marginBottom: '0.2rem' }}>Species</div>
          <select value={sp} onChange={e => setSpecies(e.target.value)} style={{ padding: '0.3rem 0.5rem' }}>
            {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Seg label="Measure" value={metric} onChange={setMetric} options={[['pkg', '£/kg'], ['box', '£/box']]} />
        <Seg label="By" value={period} onChange={setPeriod} options={[['month', 'Month'], ['year', 'Year']]} />
        <Seg label="Chart" value={chart} onChange={setChart} options={[['line', 'Line'], ['bar', 'Bar']]} />
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.3rem' }}>Grades (tap to add/remove):</div>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {grades.map(g => (
            <button key={g} className={selGrades.includes(g) ? '' : 'secondary'} style={{ padding: '0.2rem 0.55rem', fontSize: '0.8rem' }} onClick={() => toggle(g)}>{g}</button>
          ))}
        </div>
      </div>

      {selGrades.length === 0 ? <p className="muted">Pick at least one grade to plot.</p> : (
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            {chart === 'bar' ? (
              <BarChart data={series.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="x" tick={{ fontSize: 11 }} tickFormatter={period === 'month' ? fmtMonth : undefined} interval="preserveStartEnd" minTickGap={12} />
                <YAxis tick={{ fontSize: 11 }} width={48} label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--grey-400)' } }} />
                <Tooltip formatter={v => v == null ? '—' : gbp(v)} labelFormatter={period === 'month' ? fmtMonth : undefined} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {series.keys.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} />)}
              </BarChart>
            ) : (
              <LineChart data={series.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="x" tick={{ fontSize: 11 }} tickFormatter={period === 'month' ? fmtMonth : undefined} interval="preserveStartEnd" minTickGap={12} />
                <YAxis tick={{ fontSize: 11 }} width={48} label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--grey-400)' } }} />
                <Tooltip formatter={v => v == null ? '—' : gbp(v)} labelFormatter={period === 'month' ? fmtMonth : undefined} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {series.keys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} connectNulls />)}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
        Average {yLabel} from your own sales notes. A4 haddock shows split into Mini Metro / Metro / Chipper for any trip you've entered totals for.
      </p>
    </div>
  )
}

function Seg({ label, value, onChange, options }) {
  return (
    <div style={{ fontSize: '0.85rem' }}>
      <div className="muted" style={{ marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {options.map(([v, l]) => (
          <button key={v} className={value === v ? '' : 'secondary'} style={{ padding: '0.2rem 0.6rem', fontSize: '0.82rem' }} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  )
}

function BuyerLeague({ rows }) {
  const league = useMemo(() => bestBuyerByGrade(rows), [rows])
  const [open, setOpen] = useState('')

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.05rem', marginBottom: '0.25rem' }}>Best-paying buyer by species &amp; grade</h2>
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}>Ranked by average £/kg across this period's sales notes. Tap a row to see every buyer.</p>
      <Scroll>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.88rem' }}>
          <thead><tr><th style={th}>Species</th><th style={th}>Grade</th><th style={th}>Best buyer</th><th style={thR}>£/kg</th><th style={thR}>Boxes</th></tr></thead>
          <tbody>
            {league.map(g => {
              const key = g.species + '||' + g.grade
              const isOpen = open === key
              return (
                <FragmentRows key={key} g={g} isOpen={isOpen} onToggle={() => setOpen(isOpen ? '' : key)} />
              )
            })}
          </tbody>
        </table>
      </Scroll>
    </div>
  )
}

function Seasonality({ rows, landingById }) {
  const [metric, setMetric] = useState('pkg')
  const grid = useMemo(() => seasonalityGrid(rows, landingById, metric), [rows, landingById, metric])
  const fmt = v => v == null ? '' : metric === 'pkg' ? gbp(v) : metric === 'kg' ? v.toFixed(1) + 't' : metric === 'boxes' ? num(v) : '£' + Math.round(v).toLocaleString('en-GB')
  const cellStyle = v => {
    const i = v == null || !grid.max ? 0 : v / grid.max
    return {
      padding: '0.4rem 0.3rem', textAlign: 'center', fontSize: '0.78rem', whiteSpace: 'nowrap',
      background: v == null ? 'transparent' : `rgba(30,58,95,${(0.06 + 0.6 * i).toFixed(3)})`,
      color: i > 0.55 ? '#fff' : 'var(--navy)', border: '1px solid var(--border)',
    }
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <div>
          <h2 style={{ fontSize: '1.05rem', marginBottom: '0.15rem' }}>Seasonality</h2>
          <p className="muted" style={{ fontSize: '0.8rem' }}>Species by month — darker is higher. Pools all years in the period to show the pattern.</p>
        </div>
        <Seg label="Show" value={metric} onChange={setMetric} options={[['pkg', '£/kg'], ['value', '£'], ['kg', 'Tonnes'], ['boxes', 'Boxes']]} />
      </div>
      <Scroll>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--card, #fff)' }}>Species</th>
              {MON.map(m => <th key={m} style={{ ...thR, textAlign: 'center', padding: '0.4rem 0.3rem' }}>{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.species.map(s => (
              <tr key={s}>
                <td style={{ ...td, fontWeight: 600, position: 'sticky', left: 0, background: 'var(--card, #fff)' }}>{s}</td>
                {MON.map((_, i) => { const v = grid.cells[s][i + 1]; return <td key={i} style={cellStyle(v)}>{fmt(v)}</td> })}
              </tr>
            ))}
            {!grid.species.length && <tr><td style={td} colSpan={13} className="muted">No sales in this period yet.</td></tr>}
          </tbody>
        </table>
      </Scroll>
    </div>
  )
}

function FragmentRows({ g, isOpen, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={td}>{g.species}</td>
        <td style={td}>{g.grade}</td>
        <td style={td}><strong>{g.best?.buyer || '—'}</strong></td>
        <td style={tdR}>{g.best ? gbp(g.best.pkg) : '—'}</td>
        <td style={tdR}>{g.best ? num(g.best.boxes) : '—'}</td>
      </tr>
      {isOpen && g.buyers.length > 1 && g.buyers.slice(1).map(b => (
        <tr key={b.buyer} style={{ background: 'var(--grey-50)' }}>
          <td style={td}></td>
          <td style={td}></td>
          <td style={{ ...td, color: 'var(--grey-400)' }}>{b.buyer}</td>
          <td style={{ ...tdR, color: 'var(--grey-400)' }}>{gbp(b.pkg)}</td>
          <td style={{ ...tdR, color: 'var(--grey-400)' }}>{num(b.boxes)}</td>
        </tr>
      ))}
    </>
  )
}
