import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { useAuth } from '../AuthContext'
import { solveSettlementRuns, matchConfidence } from '../lib/salesAgg'

// What the fish made against what the office paid.
//
// Two independent records that have never been compared: the sales notes
// (parsed per landing) and the Don Fishing settlements (what actually came
// back). If they disagree, that is money.
//
// HOW THE MATCH IS MADE.
//   The settlement does not say which landings it covers, and Don Fishing do
//   not provide that. It does not have to be guessed either.
//
//   Two facts make the boundaries solvable: landings and settlements are both
//   in date order and a settlement always covers a CONSECUTIVE run, and each
//   settlement states TWO independent figures — the Fish Sales value and the
//   weight landed. So solveSettlementRuns() picks the cut points that make
//   both figures agree best across the whole year at once, rather than a date
//   rule applied one settlement at a time. A cut that fixes one settlement and
//   wrecks the next is rejected automatically — which a per-settlement window
//   cannot see.
//
//   Weight turns out to be the stronger signal: six settlements match to the
//   exact kilo. Agreeing on BOTH value and weight is what makes a run
//   confirmed rather than inferred.
//
// COMPARE AGAINST THE FISH SALES LINE, NOT total_income.
//   total_income is the settlement's whole income side, and some settlements
//   carry income that never came from a sales note — Towage of £73,347 on
//   12-06 and £24,448 on 26-06. Comparing landings against total_income
//   charged the boat with earning fish it never landed. Against the Fish
//   Sales line, 26-06 goes from £24,448 out to exactly nothing.
//
// WHERE VALUE AGREES BUT WEIGHT DOES NOT, the match is still right.
//   26-06 reconciles to the penny on value and is 18,348 kg over. Since the
//   money is exact the landings must be correct, so that is the settlement
//   measuring weight on a different basis — not a matching error, and not
//   something to go chasing.
//
// Danish sales ARE included: Don Fishing is the selling agent for Hanstholm
// too. Excluding them was tried and made the reconciliation worse.

const money = (n) => (n == null ? '—' : '£' + Math.round(Number(n)).toLocaleString('en-GB'))
const money2 = (n) => (n == null ? '—' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmt = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')

// What counts as agreement. Under £50 is rounding; under £2,000 on a
// six-figure settlement is a rounding-and-adjustments band worth seeing but
// not chasing; beyond that something needs explaining.
const shiftDays = (d, n) => {
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00')
  x.setDate(x.getDate() + n)
  return x.toISOString().slice(0, 10)
}

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
  const [income, setIncome] = useState({})
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState('')

  useEffect(() => {
    if (!canView) { setLoading(false); return }
    async function load() {
      setLoading(true); setError('')
      const [sRes, lRes, rRes, slRes] = await Promise.all([
        supabase.from('su_settlements')
          .select('id, reference, settling_date, period, trips, days_at_sea, total_income, weight_landed')
          .not('total_income', 'is', null).order('settling_date'),
        // fetchAll, not a plain select: Supabase returns at most 1,000 rows per
        // request and does not say so. This page was reading 1,000 of 8,067,
        // so every landing's value came out a fraction of its real size and the
        // solver rejected every arrangement — the page showed nothing at all,
        // with no error. See src/lib/fetchAll.js.
        fetchAll('sales_landings', 'id, landing_date, market, vessel'),
        fetchAll('sales_rows', 'landing_id, value, weight_kg'),
        fetchAll('su_settlement_lines', 'settlement_id, section, label, amount', (q) => q.eq('section', 'income')),
      ])
      // slRes was not checked before, so a failure on the income lines fell
      // through to the total_income fallback with no sign anything was wrong.
      const firstErr = sRes.error || lRes.error || rRes.error || slRes.error
      if (firstErr) setError(firstErr.message)

      // Split the income side: fish, and everything that is not fish.
      const inc = {}
      for (const r of slRes.data || []) {
        const o = (inc[r.settlement_id] = inc[r.settlement_id] || { fish: 0, other: 0, otherLabels: [] })
        if (/fish/i.test(r.label || '')) o.fish += Number(r.amount || 0)
        else { o.other += Number(r.amount || 0); o.otherLabels.push(r.label) }
      }
      setIncome(inc)

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
    if (!list.length || !days.length) return []
    // Only the landing days that fall inside the settled period at all — a
    // wide margin, because the solver decides the boundaries, not this.
    const first = list[0].settling_date, last = list[list.length - 1].settling_date
    const scope = days.filter((d) => d.date >= shiftDays(first, -30) && d.date <= shiftDays(last, 5))

    const targets = list.map((s) => {
      const inc = income[s.id] || { fish: 0, other: 0, otherLabels: [] }
      return { ...s, fish: inc.fish || Number(s.total_income), kg: Number(s.weight_landed), inc }
    })

    const runs = solveSettlementRuns(scope, targets)
    return runs.map((r) => {
      const s = r.settlement
      const conf = matchConfidence(r.valueDiff, r.kgDiff, s.fish, s.kg)
      const lastDay = r.landings[r.landings.length - 1]
      const after = scope.find((d) => lastDay && d.date > lastDay.date)
      return {
        s, inc: s.inc, fish: s.fish, sKg: s.kg,
        inWindow: r.landings, gross: r.value, kg: r.kg,
        diff: r.valueDiff, kgDiff: r.kgDiff,
        band: band(r.valueDiff), conf, after,
      }
    })
  }, [settlements, days, income])

  const totals = useMemo(() => rows.reduce((a, r) => ({
    sett: a.sett + r.fish,
    gross: a.gross + r.gross,
    exact: a.exact + (r.conf.key === 'confirmed' ? 1 : 0),
    off: a.off + (r.conf.key === 'unmatched' ? 1 : 0),
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
          <Fig label="Confirmed on both" value={totals.exact} accent="var(--kelp)" />
          <Fig label="Need a look" value={totals.off} accent={totals.off ? 'var(--rust)' : undefined} />
          <Fig label="Settled" value={money(totals.sett)} />
          <Fig label="Sales notes" value={money(totals.gross)} />
          <Fig label="Net difference" value={money(totals.gross - totals.sett)}
               accent={Math.abs(totals.gross - totals.sett) > 2000 ? 'var(--brass)' : 'var(--kelp)'} />
        </div>
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Compared against the settlement&rsquo;s <strong>Fish Sales</strong> line, not its total income —
          some settlements carry money that never came from a sales note, and towage is shown beside
          the figure where it does. The settlement does not say <em>which</em> landings it covers, so
          each is matched to the landings in its own window, with two days&rsquo; grace either side
          because a trip landed just after a settling date is still settled on that sheet. Open a row
          to see the landings and the next one outside the window.
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
                  <th style={{ ...th, ...num }}>Fish on the settlement</th>
                  <th style={{ ...th, ...num }}>Sales notes</th>
                  <th style={{ ...th, ...num }}>Difference</th>
                  <th style={{ ...th, ...num }}>Weight</th>
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
                      <td style={{ ...td, ...num }}>
                        {money2(r.fish)}
                        {r.inc.other > 0 && (
                          <div className="muted" style={{ fontSize: '0.72rem' }}>
                            + {money(r.inc.other)} {r.inc.otherLabels.join(', ').toLowerCase()}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, ...num }}>{money2(r.gross)}</td>
                      <td style={{ ...td, ...num, fontWeight: 700, color: r.band.color }}>
                        {r.diff > 0 ? '+' : ''}{money2(r.diff)}
                      </td>
                      <td style={{ ...td, ...num }}>
                        <span style={{ color: Math.abs(r.kgDiff) < 1 ? 'var(--kelp)' : 'inherit', fontWeight: Math.abs(r.kgDiff) < 1 ? 700 : 400 }}>
                          {r.kgDiff > 0 ? '+' : ''}{Math.round(r.kgDiff).toLocaleString('en-GB')} kg
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ padding: '0.05rem 0.5rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, color: '#fff', background: r.conf.color }}>
                          {r.conf.label}
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
                        <td colSpan={8} style={{ ...td, background: 'var(--bg-soft, #f8fafc)' }}>
                          <div style={{ fontSize: '0.85rem' }}>
                            <p className="muted" style={{ marginTop: 0 }}>
                              Landings the solver assigned to this settlement
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
                                difference becomes {money2(r.gross + r.after.value - r.fish)}.
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
