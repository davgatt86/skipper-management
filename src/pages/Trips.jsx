import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { fetchAll } from '../lib/fetchAll'
import { buildTrips, estLitres, L_PER_DAY } from '../lib/tripAgg'

/* What each trip earned, per day at sea.
 *
 * Called "rates" and not "profit" on purpose: there is no cost against a trip
 * anywhere in this database. Not one fuel entry carries a price, and a
 * settlement covers a run of trips rather than one, so a profit figure here
 * would be invented. Gross per day at sea is the honest number, and it is the
 * one the skipper asks for.
 *
 * THE UNIT IS THE TRIP. See src/lib/tripAgg.js — a trip lands more than once
 * and every landing carries the whole trip's days, so per-landing rates count
 * the same days repeatedly and understate by 42%.
 */

const fmt = (n) => (n == null ? '—' : n.toLocaleString('en-GB'))
const money = (n) => (n == null ? '—' : '£' + Math.round(n).toLocaleString('en-GB'))
const dt = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—')

/* Logbook trip references run to 14 characters — C2100420260029 — and only the
 * tail tells one from the next. Show that, keep the whole thing on hover. */
const shortRef = (nr) => {
  const s = String(nr ?? '')
  return s.length > 6 ? '…' + s.slice(-4) : s
}

export default function Trips() {
  const { appUser } = useAuth()
  const canView = ['skipper', 'viewer'].includes(appUser?.role)

  const [landings, setLandings] = useState([])
  const [quotaTrips, setQuotaTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [vessel, setVessel] = useState('')

  useEffect(() => {
    if (!canView) { setLoading(false); return }
    let cancel = false
    ;(async () => {
      // fetchAll, not a plain select: PostgREST caps a response at 1,000 rows
      // and does not say so. That silently broke Buyer League and Reconcile.
      const [ls, ts] = await Promise.all([
        fetchAll('sales_landings', '*', (q) => q.gt('value', 0).order('landing_date', { ascending: false })),
        fetchAll('quota_trips', 'trip_nr, vessel, departure_at, arrival_at, departure_port, arrival_port'),
      ])
      if (cancel) return
      if (ls.error || ts.error) setError((ls.error || ts.error).message)
      else { setLandings(ls.data || []); setQuotaTrips(ts.data || []) }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [canView])

  const vessels = useMemo(
    () => [...new Set(landings.map((l) => l.vessel).filter(Boolean))].sort(),
    [landings],
  )
  const scoped = useMemo(
    () => (vessel ? landings.filter((l) => l.vessel === vessel) : landings),
    [landings, vessel],
  )
  const { trips, unmatched, totals } = useMemo(
    () => buildTrips(scoped, quotaTrips),
    [scoped, quotaTrips],
  )

  if (!canView) return <AppShell><div className="card"><p className="muted">Skipper or viewer access only.</p></div></AppShell>
  if (loading) return <AppShell><div className="card"><p className="muted">Loading…</p></div></AppShell>

  return (
    <AppShell maxWidth={1100}>
      <PageHeader title="Trip Rates" sub="What each trip made, per day at sea">
        {vessels.length > 1 && (
          <select value={vessel} onChange={(e) => setVessel(e.target.value)}>
            <option value="">All vessels</option>
            {vessels.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
      </PageHeader>

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error" style={{ margin: 0 }}>{error}</p></div>}

      {trips.length === 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No trips to rate yet</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            A trip's length comes from the logbook — the departure and return times on the quota trip
            export. Upload those on the Quota page and every landing attaches to the trip it came off.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <Fig label="Per day at sea" value={money(totals.perDay)} big accent="var(--hull)" />
              <Fig label="Median trip" value={money(totals.median)} />
              <Fig label="Best" value={money(totals.best)} accent="var(--kelp)" />
              <Fig label="Worst" value={money(totals.worst)} accent="var(--brass)" />
              <Fig label="Trips" value={fmt(totals.trips)} />
              <Fig label="Days at sea" value={fmt(totals.days)} />
              <Fig label="Gross" value={money(totals.gross)} />
            </div>
            <p className="muted" style={{ fontSize: '0.82rem', margin: '0.7rem 0 0' }}>
              Days come from the logbook — departure to return — not from the typed figure.
              The headline is total gross over total days, not an average of the trip rates, so a
              two-day run does not carry the same weight as a nine-day one.
              {totals.multiLanding > 0 && (
                <> <strong>{totals.multiLanding}</strong> of these {totals.trips} trips landed more than
                once; those landings are added together rather than rated separately.</>
              )}
            </p>
          </div>

          {(totals.disagreeing > 0 || unmatched.length > 0) && (
            <div className="card" style={{ borderColor: 'var(--brass)' }}>
              {totals.disagreeing > 0 && (
                <p style={{ margin: 0, fontSize: '0.9rem' }}>
                  <strong>{totals.disagreeing}</strong> {totals.disagreeing === 1 ? 'trip has' : 'trips have'} a
                  typed days-at-sea figure more than a day out from the logbook. The rates below use the
                  logbook; the typed figure is shown beside it so you can see which is wrong.
                </p>
              )}
              {unmatched.length > 0 && (
                <p style={{ margin: totals.disagreeing > 0 ? '0.5rem 0 0' : 0, fontSize: '0.9rem' }}>
                  <strong>{unmatched.length}</strong> {unmatched.length === 1 ? 'landing has' : 'landings have'} no
                  logbook trip, so {unmatched.length === 1 ? 'it is' : 'they are'} left out of every figure
                  above — {unmatched.map((l) => l.landing_date).slice(0, 6).join(', ')}
                  {unmatched.length > 6 ? ` and ${unmatched.length - 6} more` : ''}.
                </p>
              )}
            </div>
          )}

          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr>
                    <th style={TH}>Trip</th>
                    <th style={TH}>Sailed</th>
                    <th style={TH}>Back</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Days</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Gross</th>
                    <th style={{ ...TH, textAlign: 'right' }}>£/day</th>
                    <th style={{ ...TH, textAlign: 'right' }}>£/kg</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Boxes</th>
                    <th style={TH}></th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((t) => {
                    const hot = totals.perDay && t.perDay ? t.perDay / totals.perDay : 1
                    return (
                      <Fragment key={t.tripNr}>
                        <tr>
                          <td style={TD}>
                            {/* The logbook reference is a 14-character string
                                (C2100420260029). Only the tail distinguishes
                                one trip from the next, so that is what is
                                shown; the whole thing is on hover. */}
                            <strong title={t.tripNr} style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                              {shortRef(t.tripNr)}
                            </strong>
                            {t.landingCount > 1 && (
                              <span className="muted" style={{ fontSize: '0.75rem' }}> · {t.landingCount} landings</span>
                            )}
                          </td>
                          <td style={TD}>{dt(t.departedAt)}</td>
                          <td style={TD}>{dt(t.arrivedAt)}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>
                            {t.days == null ? '—' : t.days.toFixed(1)}
                            {t.daysDisagree && (
                              <span title={`Typed as ${t.typedDays} days`} style={{ color: 'var(--brass)' }}> ⚠{t.typedDays}</span>
                            )}
                          </td>
                          <td style={{ ...TD, textAlign: 'right' }}>{money(t.gross)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontWeight: 700,
                                       color: hot >= 1.25 ? 'var(--kelp)' : hot <= 0.6 ? 'var(--rust)' : 'inherit' }}>
                            {money(t.perDay)}
                          </td>
                          <td style={{ ...TD, textAlign: 'right' }}>{t.perKg == null ? '—' : '£' + t.perKg.toFixed(2)}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>{fmt(t.boxes)}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>
                            <button className="secondary" style={{ padding: '0.1rem 0.45rem', fontSize: '0.75rem' }}
                                    onClick={() => setOpen(open === t.tripNr ? null : t.tripNr)}>
                              {open === t.tripNr ? 'Hide' : 'Detail'}
                            </button>
                          </td>
                        </tr>
                        {open === t.tripNr && (
                          <tr>
                            <td colSpan={9} style={{ ...TD, background: 'color-mix(in srgb, var(--hull) 5%, transparent)' }}>
                              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                                <span><span className="muted">From</span> {t.departurePort || '—'} <span className="muted">to</span> {t.arrivalPort || '—'}</span>
                                <span><span className="muted">Landed</span> {fmt(Math.round(t.kg))} kg</span>
                                {t.days && <span><span className="muted">Fuel, estimated</span> {fmt(estLitres(t.days))} L</span>}
                                {t.vessels.length > 1 && <span><span className="muted">Boats</span> {t.vessels.join(' + ')}</span>}
                              </div>
                              <div style={{ marginTop: '0.4rem' }}>
                                {t.landings.map((l) => (
                                  <div key={l.id} style={{ display: 'flex', gap: '0.8rem', borderTop: '1px solid var(--border)', padding: '0.2rem 0', fontSize: '0.82rem' }}>
                                    <span style={{ width: '5.5rem' }}>{dt(l.landing_date)}</span>
                                    <span style={{ flex: '1 1 auto' }}>{l.market || '—'}</span>
                                    <span className="muted">{fmt(l.boxes)} boxes</span>
                                    <span style={{ width: '6rem', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{money(l.value)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: '0.75rem', margin: '0.7rem 0 0' }}>
              Fuel is an <strong>estimate</strong> — {L_PER_DAY.toLocaleString('en-GB')} L per day at sea,
              measured across the twelve settlements carrying a fuel figure. It is litres and never a
              cost: not one entry in the fuel log carries a price, so a cost here would be made up.
              These are <strong>gross</strong> rates; crew shares, fuel and expenses are not deducted.
            </p>
          </div>
        </>
      )}
    </AppShell>
  )
}

function Fig({ label, value, big, accent }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{
        fontSize: big ? '2.2rem' : '1.4rem', fontWeight: 700,
        fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.1, color: accent || 'inherit',
      }}>{value}</div>
    </div>
  )
}

const TH = {
  borderBottom: '2px solid var(--border)', padding: '0.35rem 0.5rem', textAlign: 'left',
  fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.04em',
}
const TD = { borderBottom: '1px solid var(--border)', padding: '0.3rem 0.5rem' }
