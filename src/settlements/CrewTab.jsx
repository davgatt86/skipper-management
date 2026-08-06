import { useMemo, useState } from 'react'
import Stat from '../Stat'
import SectionRule from '../SectionRule'
import { money2 } from '../lib/su/metrics'

// Crew wages aggregated by man across the year, with each man expandable to
// his trip-by-trip history.
//
// Audacious crew names arrive as "COMPANY, PERSON · CODE" — the person is what
// you read, the company is context. Beryl names are short handles with neither.
// Split where there is something to split, leave alone otherwise.
function splitName(raw = '') {
  const m = raw.match(/^(.*?),\s*(.*)$/)
  if (m) return { person: title(m[2]), company: title(m[1]) }
  return { person: raw, company: null }
}
const title = s => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())

const n = v => Number(v || 0)

const DEDUCTIONS = [
  ['adv', 'Advances'],
  ['bond', 'Bond'],
  ['gear', 'Gear'],
  ['sundries', 'Sundries'],
  ['add_tax', 'Additional tax'],
  ['tax', 'Tax'],
]

export default function CrewTab({ crew = [], settlements = [] }) {
  const [open, setOpen] = useState(null)

  const byDate = useMemo(() => {
    const m = {}
    for (const s of settlements) m[s.id] = s
    return m
  }, [settlements])

  const men = useMemo(() => {
    const m = {}
    for (const c of crew) {
      const key = (c.crew_name || '').trim()
      if (!key) continue
      const e = (m[key] = m[key] || {
        name: key, code: c.crew_code || null, rows: [],
        gross: 0, deductions: 0, net: 0,
      })
      e.rows.push(c)
      e.gross += n(c.gross)
      e.deductions += n(c.deductions_total) || DEDUCTIONS.reduce((a, [k]) => a + n(c[k]), 0)
      e.net += n(c.net)
    }
    return Object.values(m).sort((a, b) => b.gross - a.gross)
  }, [crew])

  const totals = men.reduce((a, m) => ({
    gross: a.gross + m.gross, deductions: a.deductions + m.deductions,
    net: a.net + m.net, trips: a.trips + m.rows.length,
  }), { gross: 0, deductions: 0, net: 0, trips: 0 })

  const dedTotals = DEDUCTIONS.map(([k, label]) => [label, crew.reduce((a, c) => a + n(c[k]), 0)])
  const anyDed = dedTotals.some(([, v]) => v > 0)

  if (!crew.length) {
    return <div className="card"><p className="muted" style={{ margin: 0 }}>No crew wages for this year.</p></div>
  }

  return (
    <>
      <div className="statgrid">
        <Stat label="Total gross wages" value={money2(totals.gross)} />
        <Stat label="Total deductions" value={money2(totals.deductions)} />
        <Stat label="Total net paid" value={money2(totals.net)} accent />
        <Stat label="Crew" value={String(men.length)} sub={`${settlements.length} settlements`} />
      </div>

      <SectionRule side="tap a man for his trips">Crew wages by man</SectionRule>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Crewman</th><th className="r">Trips</th><th className="r">Gross</th>
              <th className="r">Deductions</th><th className="r">Net</th><th className="r">Avg / trip</th>
            </tr>
          </thead>
          <tbody>
            {men.map(m => {
              const { person, company } = splitName(m.name)
              const isOpen = open === m.name
              return (
                <>
                  <tr key={m.name} className="rowlink" onClick={() => setOpen(isOpen ? null : m.name)}>
                    <td className="strong">
                      {isOpen ? '▾ ' : '▸ '}{person}
                      {(company || m.code) && (
                        <div className="g" style={{ fontWeight: 400 }}>
                          {company}{company && m.code ? ' · ' : ''}{m.code || ''}
                        </div>
                      )}
                    </td>
                    <td className="r num">{m.rows.length}</td>
                    <td className="r num">{money2(m.gross)}</td>
                    <td className="r num">{m.deductions ? money2(m.deductions) : '—'}</td>
                    <td className="r num strong">{money2(m.net)}</td>
                    <td className="r num">{money2(m.gross / m.rows.length)}</td>
                  </tr>
                  {isOpen && m.rows
                    .slice()
                    .sort((a, b) => (byDate[b.settlement_id]?.settling_date || '').localeCompare(byDate[a.settlement_id]?.settling_date || ''))
                    .map(r => {
                      const s = byDate[r.settlement_id]
                      return (
                        <tr key={r.id} style={{ background: 'var(--surface-2)' }}>
                          <td style={{ paddingLeft: 28 }} className="muted">
                            {s?.settling_date || '—'} · {s?.reference || '—'}
                          </td>
                          <td />
                          <td className="r num">{money2(r.gross)}</td>
                          <td className="r num">{n(r.deductions_total) ? money2(r.deductions_total) : '—'}</td>
                          <td className="r num">{money2(r.net)}</td>
                          <td className="r muted" style={{ fontSize: '0.78rem' }}>{r.method || '—'}</td>
                        </tr>
                      )
                    })}
                </>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>{men.length} crew</td>
              <td className="r num">{totals.trips}</td>
              <td className="r num">{money2(totals.gross)}</td>
              <td className="r num">{money2(totals.deductions)}</td>
              <td className="r num">{money2(totals.net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <SectionRule>Deductions breakdown</SectionRule>
      {anyDed ? (
        <div className="tw">
          <table>
            <thead><tr><th>Type</th><th className="r">Total</th></tr></thead>
            <tbody>
              {dedTotals.map(([label, v]) => (
                <tr key={label}>
                  <td className="strong">{label}</td>
                  <td className="r num">{v ? money2(v) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total deductions</td><td className="r num">{money2(totals.deductions)}</td></tr></tfoot>
          </table>
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            This sheet format records a bond only, not a deductions breakdown.
          </p>
        </div>
      )}
    </>
  )
}
