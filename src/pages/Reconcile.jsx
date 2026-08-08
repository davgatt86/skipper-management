import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

// What the fish made against what the office paid.
//
// Two independent records that have never been compared: the sales notes
// (parsed per landing) and the Don Fishing settlements (what actually came
// back). If they disagree, that is money.
//
// HOW THE MATCH IS MADE, and its limit.
//   The settlement does NOT say which landings it covers — su_settlement_lines
//   carries one "Fish Sales" line and no breakdown. So the window is inferred:
//   a settlement is taken to cover every landing after the previous settling
//   date, up to and including its own.
//
//   That is right most of the time — three settlements reconcile to the penny
//   — but it cannot be right always, because a trip landed either side of a
//   settling date can be settled on either sheet. So a large difference is
//   usually a boundary, not missing money, and the page shows the landings on
//   both sides so that can be judged rather than guessed.
//
// Danish sales ARE included: Don Fishing is the selling agent for Hanstholm
// too. Excluding them was tried and made the reconciliation worse.

const money = (n) => (n == null ? '—' : '£' + Math.round(Number(n)).toLocaleString('en-GB'))
const money2 = (n) => (n == null ? '—' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmt = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')

// What counts as agreement. Under £50 is rounding; under £2,000 on a
// six-figure settlement is a rounding-and-adjustments band worth seeing but
// not chasing; beyond that something needs explaining.
const band = (d) => {
  const a = Math.abs(d)
  if (a < 50) return { key: 'exact', label: 'Matches', color: 'var(--kelp)' }
  if (a < 2000) return { key: 'close', label: 'Close', color: 'var(--brass)' }
  return { key: 'off', label: 'Needs a look', color: 'var(--rust)' }
}

export default function Reconcile() {
  const { appUser } = useAuth()
  const canView = ['skipper', 'viewer'].includes(appUser?.role)

  const [settlements, setSettlements] = useState([])
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState('')

  useEffect(() => {
    if (!canView) { setLoading(false); return }
    async function load() {
      setLoading(true); setError('')
      const [sRes, lRes, rRes] = await Promise.all([
        supabase.from('su_settlements')
          .select('id, reference, settling_date, period, trips, days_at_sea, total_income, weight_landed')
          .not('total_income', 'is', null).order('settling_date'),
        supabase.from('sales_landings').select('id, landing_date, market, vessel'),
        supabase.from('sales_rows').select('landing_id, value, weight_kg'),
      ])
      if (sRes.error || lRes.error || rRes.error) setError((sRes.error || lRes.error || rRes.error).message)

      // Roll rows up to one figure per landing, then per landing DAY — a
      // settlement settles a day's selling, not an individual sales note.
      const perLanding = {}
      for (const r of rRes.data || []) {
        const o = (perLanding[r.landing_id] = perLanding[r.landing_id] || { value: 0, kg: 0 })
        o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0)
      }
      const byDay = {}
      for (const l of lRes.data || []) {
        const t = perLanding[l.id]; if (!t) continue
        const d = (byDay[l.landing_date] = byDay[l.landing_date] || { date: l.landing_date, value: 0, kg: 0, markets: new Set() })
        d.value += t.value; d.kg += t.kg
        if (l.market) d.markets.add(l.market)
      }
      setDays(Object.values(byDay).map((d) => ({ ...d, markets: [...d.markets] })).sort((a, b) => a.date.localeCompare(b.date)))
      setSettlements(sRes.data || [])
      setLoading(false)
    }
    load()
  }, [canView])

  const rows = useMemo(() => {
    // Only settlements that carry a trip figure are the Audacious posting
    // report; the Beryl one-page sheet has no landings behind it here.
    const list = settlements.filter((s) => s.weight_landed != null)
    return list.map((s, i) => {
      const prev = i > 0 ? list[i - 1].settling_date : null
      const from = prev || s.settling_date
      const inWindow = days.filter((d) => (prev ? d.date > prev : d.date >= from) && d.date <= s.settling_date)
      const gross = inWindow.reduce((a, d) => a + d.value, 0)
      const kg = inWindow.reduce((a, d) => a + d.kg, 0)
      const diff = gross - Number(s.total_income)
      // The nearest day either side, so a boundary case is visible.
      const after = days.find((d) => d.date > s.settling_date)
      const before = [...days].reverse().find((d) => prev && d.date <= prev)
      return { s, from: prev, inWindow, gross, kg, diff, band: band(diff), after, before }
    })
  }, [settlements, days])

  const totals = useMemo(() => rows.reduce((a, r) => ({
    sett: a.sett + Number(r.s.total_income),
    gross: a.gross + r.gross,
    exact: a.exact + (r.band.key === 'exact' ? 1 : 0),
    off: a.off + (r.band.key === 'off' ? 1 : 0),
  }), { sett: 0, gross: 0, exact: 0, off: 0 }), [rows])

  if (!canView) return <AppShell><div className="card"><p className="muted">Skipper or viewer access only.</p></div></AppShell>

  const th = { padding: '0.5rem 0.4rem', textAlign: 'left', borderBottom: '2px solid var(--border)' }
  const td = { padding: '0.5rem 0.4rem', borderBottom: '1px solid var(--border)' }
  const num = { fontFamily: 'var(--font-mono, monospace)', textAlign: 'right' }

  return (
    <AppShell>
      <PageHeader title="Landings vs Settlements" sub="What the fish made against what the office paid" />

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      <div className="card">
        <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap' }}>
          <Fig label="Settlements" value={rows.length} />
          <Fig label="Match to the penny" value={totals.exact} accent="var(--kelp)" />
          <Fig label="Need a look" value={totals.off} accent={totals.off ? 'var(--rust)' : undefined} />
          <Fig label="Settled" value={money(totals.sett)} />
          <Fig label="Sales notes" value={money(totals.gross)} />
          <Fig label="Net difference" value={money(totals.gross - totals.sett)}
               accent={Math.abs(totals.gross - totals.sett) > 2000 ? 'var(--brass)' : 'var(--kelp)'} />
        </div>
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          A settlement does not say which landings it covers — it carries one <em>Fish Sales</em> line
          and no breakdown. So each is matched to every landing after the previous settling date up to
          its own. That reconciles several to the penny, but a trip landed either side of a settling
          date can be settled on either sheet, so <strong>a large difference is usually a boundary
          rather than missing money</strong>. Open a row to see the landings either side and judge it.
        </p>
      </div>

      {loading ? <div className="card"><p className="muted">Loading…</p></div> : rows.length === 0 ? (
        <div className="card"><p className="muted">No settlements with a landed weight to reconcile against.</p></div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr>
                  <th style={th}>Settled</th>
                  <th style={th}>Ref</th>
                  <th style={{ ...th, ...num }}>Office paid</th>
                  <th style={{ ...th, ...num }}>Sales notes</th>
                  <th style={{ ...th, ...num }}>Difference</th>
                  <th style={th}></th>
                  <th style={{ ...th, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <>
                    <tr key={r.s.id}>
                      <td style={td}>{fmt(r.s.settling_date)}</td>
                      <td style={{ ...td, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.82rem' }}>{r.s.reference}</td>
                      <td style={{ ...td, ...num }}>{money2(r.s.total_income)}</td>
                      <td style={{ ...td, ...num }}>{money2(r.gross)}</td>
                      <td style={{ ...td, ...num, fontWeight: 700, color: r.band.color }}>
                        {r.diff > 0 ? '+' : ''}{money2(r.diff)}
                      </td>
                      <td style={td}>
                        <span style={{ padding: '0.05rem 0.5rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, color: '#fff', background: r.band.color }}>
                          {r.band.label}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button className="secondary" onClick={() => setOpen(open === r.s.id ? '' : r.s.id)} style={{ padding: '0.15rem 0.55rem', fontSize: '0.78rem' }}>
                          {open === r.s.id ? 'Hide' : `${r.inWindow.length} day${r.inWindow.length === 1 ? '' : 's'}`}
                        </button>
                      </td>
                    </tr>
                    {open === r.s.id && (
                      <tr key={r.s.id + '-d'}>
                        <td colSpan={7} style={{ ...td, background: 'var(--bg-soft, #f8fafc)' }}>
                          <div style={{ fontSize: '0.85rem' }}>
                            <p className="muted" style={{ marginTop: 0 }}>
                              Window {r.from ? `after ${fmt(r.from)}` : 'opening'} → {fmt(r.s.settling_date)}
                              {r.s.trips && ` · settlement says ${r.s.trips} trip${Number(r.s.trips) === 1 ? '' : 's'}`}
                              {r.s.weight_landed && ` · ${Math.round(r.s.weight_landed).toLocaleString('en-GB')} kg landed`}
                            </p>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                              <tbody>
                                {r.inWindow.map((d) => (
                                  <tr key={d.date}>
                                    <td style={{ padding: '0.2rem 0.4rem' }}>{fmt(d.date)}</td>
                                    <td style={{ padding: '0.2rem 0.4rem' }} className="muted">{d.markets.join(', ')}</td>
                                    <td style={{ padding: '0.2rem 0.4rem', ...num }}>{Math.round(d.kg).toLocaleString('en-GB')} kg</td>
                                    <td style={{ padding: '0.2rem 0.4rem', ...num }}>{money2(d.value)}</td>
                                  </tr>
                                ))}
                                <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                                  <td style={{ padding: '0.2rem 0.4rem' }} colSpan={2}>In this window</td>
                                  <td style={{ padding: '0.2rem 0.4rem', ...num }}>{Math.round(r.kg).toLocaleString('en-GB')} kg</td>
                                  <td style={{ padding: '0.2rem 0.4rem', ...num }}>{money2(r.gross)}</td>
                                </tr>
                              </tbody>
                            </table>
                            {r.band.key === 'off' && r.after && (
                              <p style={{ marginBottom: 0, marginTop: '0.6rem', color: 'var(--brass)' }}>
                                Next landing outside this window is <strong>{fmt(r.after.date)}</strong>,
                                {' '}{money2(r.after.value)}. If that trip was settled on this sheet, the
                                difference becomes {money2(r.gross + r.after.value - Number(r.s.total_income))}.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  )
}

function Fig({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, fontSize: '1.3rem', color: accent || 'var(--hull)' }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.78rem' }}>{label}</div>
    </div>
  )
}
