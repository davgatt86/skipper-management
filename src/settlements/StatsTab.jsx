import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import Stat from '../Stat'
import SectionRule from '../SectionRule'
import { computeMetrics, perSettlement, money, money2, pct, qty } from '../lib/su/metrics'

// Every figure comes from metrics.js, which decides per format whether a thing
// is computable. A chart whose input is n/a is not drawn at all — an empty axis
// looks like a bad month rather than a sheet that never carried the figure.

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const shortDate = d => (d ? `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : '—')
const gbpAxis = v => (Math.abs(v) >= 1000 ? '£' + Math.round(v / 1000) + 'k' : '£' + v)

function Missing({ children }) {
  return (
    <div className="card">
      <p className="muted" style={{ margin: 0 }}>
        <strong>n/a</strong> — {children}
      </p>
    </div>
  )
}

export default function StatsTab({ settlements = [], lines = [], format, tripFilter, setTripFilter }) {
  const isBeryl = format === 'beryl'

  const m = useMemo(() => computeMetrics({ settlements, lines, format }), [settlements, lines, format])
  const rows = useMemo(
    () => settlements.map(s => perSettlement(s, lines, format))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    [settlements, lines, format]
  )

  // Expenses by category across the year.
  const byCategory = useMemo(() => {
    const t = {}
    for (const l of lines) {
      if (l.section !== 'expense') continue
      const k = (l.label || 'Other').trim()
      t[k] = (t[k] || 0) + Number(l.amount || 0)
    }
    const total = Object.values(t).reduce((a, b) => a + b, 0)
    return {
      total,
      rows: Object.entries(t)
        .map(([label, amount]) => ({ label, amount, pct: total ? (amount / total) * 100 : 0 }))
        .sort((a, b) => b.amount - a.amount),
    }
  }, [lines])

  // Recoveries against the expense they offset — Audacious only.
  const recoveries = useMemo(() => {
    if (isBeryl) return null
    const rec = {}
    for (const l of lines) {
      if (l.section !== 'recovery') continue
      const k = (l.label || '').replace(/^rec\.?\s*/i, '').trim()
      rec[k] = (rec[k] || 0) + Number(l.amount || 0)
    }
    const spendFor = name => byCategory.rows
      .filter(r => r.label.toLowerCase().includes(name.toLowerCase().split(' ')[0]))
      .reduce((a, r) => a + r.amount, 0)
    return Object.entries(rec).map(([label, recovered]) => {
      const spent = spendFor(label)
      return { label, recovered, spent: spent || null, pct: spent ? (recovered / spent) * 100 : null }
    }).sort((a, b) => b.recovered - a.recovered)
  }, [lines, byCategory, isBeryl])

  const monthly = useMemo(() => {
    const t = {}
    for (const s of settlements) {
      const d = s.settling_date
      if (!d) continue
      const k = d.slice(0, 7)
      const e = (t[k] = t[k] || { key: k, label: MONTHS[Number(d.slice(5, 7)) - 1], gross: 0, expenses: 0, share: 0 })
      e.gross += Number(s.total_income || 0)
      e.expenses += Number(s.total_expenses || 0)
      e.share += Number((isBeryl ? s.boat_share : s.owners_share) || 0)
    }
    return Object.values(t).sort((a, b) => a.key.localeCompare(b.key))
  }, [settlements, isBeryl])

  const shareLabel = isBeryl ? 'Boat share' : "Owner's share"

  if (!settlements.length) {
    return <div className="card"><p className="muted" style={{ margin: 0 }}>No settlements in this year.</p></div>
  }

  return (
    <>
      {/* Science trips would drag every average down, so they are excluded by
          default. Beryl settlements carry no trip type at all. */}
      {!isBeryl && (
        <div className="boatpick" style={{ marginBottom: 16 }}>
          {['fishing', 'other', 'all'].map(k => (
            <button key={k} className={tripFilter === k ? 'on' : ''} onClick={() => setTripFilter(k)}>
              {k === 'fishing' ? 'Fishing' : k === 'other' ? 'Science / other' : 'All'}
            </button>
          ))}
        </div>
      )}
      {!isBeryl && tripFilter === 'fishing' && (
        <p className="note" style={{ marginTop: 0 }}>
          Science and other trips are left out so they do not skew the fishing averages.
        </p>
      )}

      <div className="statgrid">
        <Stat label={`Avg gross / ${isBeryl ? 'landing' : 'settlement'}`} value={money(m.avgGrossPer.value)} unavailable={m.avgGrossPer.unavailable} />
        <Stat label={`Avg ${shareLabel.toLowerCase()}`} value={money(m.avgBoatOwnerSharePer.value)} unavailable={m.avgBoatOwnerSharePer.unavailable} />
        <Stat label={`${shareLabel} %`} value={pct(m.boatOwnerSharePct.value)} unavailable={m.boatOwnerSharePct.unavailable} />
        <Stat label="Expenses % of gross" value={pct(m.expensesPctOfGross.value)} unavailable={m.expensesPctOfGross.unavailable} />
        <Stat label="Crew share % of gross" value={pct(m.crewSharePctOfGross.value)} unavailable={m.crewSharePctOfGross.unavailable} />
        <Stat label="Fuel % of gross" value={pct(m.fuelPctOfGross.value)} unavailable={m.fuelPctOfGross.unavailable} />
        <Stat label="Best landing" value={money(m.bestLanding.value)} unavailable={m.bestLanding.unavailable} accent />
      </div>

      {/* Per day at sea — available to BOTH formats. Beryl records days too. */}
      <SectionRule side={m.daysAtSea.value ? `${m.daysAtSea.value} days at sea` : undefined}>Per day at sea</SectionRule>
      <div className="statgrid">
        <Stat label="Gross / day" value={money(m.grossPerDay.value)} unavailable={m.grossPerDay.unavailable} />
        <Stat label={`${shareLabel} / day`} value={money(m.boatOwnerSharePerDay.value)} unavailable={m.boatOwnerSharePerDay.unavailable} />
        <Stat label="Expenses / day" value={money(m.expensesPerDay.value)} unavailable={m.expensesPerDay.unavailable} />
        <Stat label="Fish price / tonne" value={money(m.fishPricePerTonne.value)} unavailable={m.fishPricePerTonne.unavailable} />
        <Stat label="Fuel price / litre" value={m.fuelPricePerLitre.value == null ? null : money2(m.fuelPricePerLitre.value)} unavailable={m.fuelPricePerLitre.unavailable} />
        <Stat label="Litres / tonne" value={qty(m.litresPerTonne.value)} unavailable={m.litresPerTonne.unavailable} />
      </div>

      <SectionRule side={`${monthly.length} months`}>Gross, expenses &amp; {shareLabel.toLowerCase()} by month</SectionRule>
      <div className="card">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line-2)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={gbpAxis} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => money2(v)} />
            <Legend />
            <Bar dataKey="gross" name="Gross" fill="var(--hull)" />
            <Bar dataKey="expenses" name="Expenses" fill="var(--rust)" />
            <Line dataKey="share" name={shareLabel} stroke="var(--brass)" strokeWidth={2} dot />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <SectionRule side={money(byCategory.total)}>Expenses by category</SectionRule>
      <div className="card">
        <ResponsiveContainer width="100%" height={Math.max(200, byCategory.rows.length * 22)}>
          <BarChart data={byCategory.rows} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line-2)" />
            <XAxis type="number" tickFormatter={gbpAxis} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => money2(v)} />
            <Bar dataKey="amount" name="Spent" fill="var(--hull)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="tw" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Category</th><th className="r">Total</th><th className="r">% of expenses</th></tr></thead>
          <tbody>
            {byCategory.rows.map(r => (
              <tr key={r.label}>
                <td className="strong">{r.label}</td>
                <td className="r num">{money2(r.amount)}</td>
                <td className="r num">{r.pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total expenses</td><td className="r num">{money2(byCategory.total)}</td><td /></tr></tfoot>
        </table>
      </div>

      <SectionRule side="a good one ranks well on all of them">Which trips were better?</SectionRule>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{isBeryl ? 'Landed' : 'Trip'}</th>
              <th className="r">Days</th><th className="r">Tonnes</th>
              <th className="r">Gross / day</th><th className="r">{shareLabel} / day</th>
              <th className="r">£ / tonne</th><th className="r">Fuel %</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice().reverse().map(r => (
              <tr key={r.id}>
                <td className="strong">
                  {shortDate(r.date)}
                  <span className="g"> {r.reference}</span>
                  {r.tripType !== 'fishing' && <span className="flag warn" style={{ marginLeft: 6 }}>{r.tripType}</span>}
                </td>
                <td className="r num">{r.days ?? '—'}</td>
                <td className="r num">{r.tonnes == null ? (isBeryl ? 'n/a' : '—') : r.tonnes.toFixed(1)}</td>
                <td className="r num">{money(r.grossPerDay) ?? '—'}</td>
                <td className="r num">{money(r.sharePerDay) ?? '—'}</td>
                <td className="r num">{money(r.pricePerTonne) ?? (isBeryl ? 'n/a' : '—')}</td>
                <td className="r num">{pct(r.fuelPct) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionRule side={isBeryl ? 'n/a for this format' : 'tonnes to cover the trip'}>Break-even landing weight</SectionRule>
      {isBeryl ? (
        <Missing>a Beryl sheet does not give weight landed, so break-even cannot be worked out.</Missing>
      ) : (
        <>
          <p className="note" style={{ marginTop: 0 }}>
            Tonnes you had to land just to cover that trip's expenses, at that trip's own fish price.
            The margin is what you landed above it.
          </p>
          <div className="tw">
            <table>
              <thead><tr><th>Trip</th><th className="r">Break-even t</th><th className="r">Landed t</th><th className="r">Margin t</th></tr></thead>
              <tbody>
                {rows.slice().reverse().filter(r => r.breakEvenTonnes != null).map(r => (
                  <tr key={r.id}>
                    <td className="strong">{shortDate(r.date)}</td>
                    <td className="r num">{r.breakEvenTonnes.toFixed(1)}</td>
                    <td className="r num">{r.tonnes?.toFixed(1) ?? '—'}</td>
                    <td className="r num strong">{(r.tonnes - r.breakEvenTonnes).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <SectionRule side={isBeryl ? 'n/a for this format' : money(m.recoveries.value)}>Recoveries</SectionRule>
      {isBeryl ? (
        <Missing>a Beryl sheet has no recoveries section.</Missing>
      ) : (
        <div className="tw">
          <table>
            <thead><tr><th>Category</th><th className="r">Recovered</th><th className="r">Spent</th><th className="r">Recovery %</th></tr></thead>
            <tbody>
              {(recoveries || []).map(r => (
                <tr key={r.label}>
                  <td className="strong">{r.label}</td>
                  <td className="r num">{money2(r.recovered)}</td>
                  <td className="r num">{r.spent == null ? '—' : money2(r.spent)}</td>
                  <td className="r num">{r.pct == null ? '—' : r.pct.toFixed(0) + '%'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total recovered</td><td className="r num">{money2(m.recoveries.value)}</td><td /><td /></tr></tfoot>
          </table>
        </div>
      )}
    </>
  )
}
