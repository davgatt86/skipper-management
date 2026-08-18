import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabaseClient'
import AppShell from '../AppShell'
import ReconcileBanner from '../ReconcileBanner'
import VesselPlate, { useVessel } from '../VesselPlate'
import SectionRule from '../SectionRule'
import { shortMarket } from '../lib/salesAgg'

const gbp0 = n => '£' + Math.round(Number(n || 0)).toLocaleString('en-GB')

// £1.94m once the figure stops fitting in a tile
function gbpBig(n) {
  const v = Number(n || 0)
  if (v >= 1e6) return '£' + (v / 1e6).toFixed(2) + 'm'
  return gbp0(v)
}

const fmtDay = d => (d ? `${d.slice(8, 10)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(d.slice(5, 7)) - 1]}` : '—')

function Stat({ k, v, n }) {
  return (
    <div className="tk">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {n && <div className="n">{n}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const fleetTools = ['skipper', 'viewer'].includes(appUser?.role)
  const { vessel, loading: vesselLoading } = useVessel()

  const [unread, setUnread] = useState(0)
  const [landings, setLandings] = useState([])
  const [error, setError] = useState('')
  const [quota, setQuota] = useState({ snapshot: null, lines: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSkipper) return
    let cancel = false
    ;(async () => {
      // Deliberately NOT calling generate_alerts() here any more.
      //
      // It was written when market alerts had no schedule and only fired when
      // somebody opened a page. They have run on cron every three hours since
      // Aug 2026, so this was doing the same work again — and it is not cheap:
      // measured at 573-931 ms mean over 495 calls, 283 seconds of database
      // time in total, all of it blocking the front page of the app before it
      // could show a single figure.
      //
      // The badge below reads what the cron already raised.
      const { count } = await supabase.from('alerts').select('id', { count: 'exact', head: true }).is('read_at', null).is('dismissed_at', null)
      if (!cancel) setUnread(count || 0)
    })()
    return () => { cancel = true }
  }, [isSkipper])

  // Landings drive every figure on this page. A viewer sees them too, so this
  // is not gated on skipper — RLS already scopes the rows to the fleet.
  useEffect(() => {
    if (!fleetTools) { setLoading(false); return }
    let cancel = false
    ;(async () => {
      const since = new Date()
      since.setFullYear(since.getFullYear() - 1)
      const sinceStr = since.toISOString().slice(0, 10)

      const year = new Date().getFullYear()
      const [lRes, sRes] = await Promise.all([
        // sales_landings, NOT landings. They are different tables:
        // `landings` is the crew/bonus record (date, boxes, who was aboard);
        // `sales_landings` is the sales note — value, market, days at sea,
        // reconcile_ok. Every figure on this page comes off the sales note.
        supabase
          .from('sales_landings')
          .select('id, landing_date, vessel, market, value, weight_kg, boxes, days_at_sea, reconcile_ok')
          .gte('landing_date', sinceStr)
          .order('landing_date', { ascending: false }),
        isSkipper
          ? supabase
              .from('quota_snapshots')
              .select('id, year, last_landing_date')
              .eq('year', year)
              .order('last_updated', { ascending: false, nullsFirst: false })
              .limit(1)
          : Promise.resolve({ data: [] }),
      ])
      if (cancel) return
      // Surfaced, not just logged. A failed query returning [] is
      // indistinguishable from a quiet month, and "No landings yet" is a
      // convincing thing for a broken query to say.
      if (lRes.error) setError(`Could not load landings: ${lRes.error.message}`)
      setLandings(lRes.data || [])

      const snap = (sRes.data || [])[0] || null
      if (snap) {
        const { data: lines, error } = await supabase
          .from('quota_lines')
          .select('stock, section, allocation, catch_total, balance')
          .eq('snapshot_id', snap.id)
        if (error) console.error('Dashboard quota_lines:', error)
        if (!cancel) setQuota({ snapshot: snap, lines: lines || [] })
      }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [fleetTools, isSkipper])

  const last = landings[0] || null

  const totals = useMemo(() => {
    const now = new Date()
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    let mtd = 0, mtdCount = 0, rolling = 0
    for (const l of landings) {
      const v = Number(l.value || 0)
      rolling += v
      if ((l.landing_date || '').startsWith(monthPrefix)) { mtd += v; mtdCount++ }
    }
    return { mtd, mtdCount, rolling }
  }, [landings])

  // Statement position only — it does not include trips landed since the
  // statement date, so it is labelled with the date it was good at.
  const quotaRows = useMemo(() => {
    return (quota.lines || [])
      .map(l => {
        const alloc = Number(l.allocation || 0)
        const used = Number(l.catch_total || 0)
        if (alloc <= 0) return null
        const pct = (used / alloc) * 100
        return { stock: l.stock, section: l.section, alloc, used, pct, balance: Number(l.balance || 0) }
      })
      .filter(Boolean)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5)
  }, [quota.lines])

  const flagFor = pct => (pct >= 100 ? 'bad' : pct >= 75 ? 'warn' : 'ok')
  const flagText = r => (r.pct >= 100 ? `Over ${(r.used - r.alloc).toFixed(1)} t` : r.pct >= 75 ? 'Watch' : 'On track')

  return (
    <AppShell badges={{ alerts: unread }}>
      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error" style={{ margin: 0 }}>{error}</p></div>}

      {/* Above the plate on purpose: this is the one thing on the front page
          that needs the skipper to go and DO something, and he is the only
          person who has the note. Compact here — the dismiss lives on Fish
          Sales, where he is already looking at the landing. */}
      <ReconcileBanner compact />

      <VesselPlate vessel={vessel} loading={vesselLoading} />

      <div className="trip">
        <div className="trip-b">
          <Stat
            k="Last trip gross"
            v={last ? gbp0(last.value) : '—'}
            n={last ? `${shortMarket(last.market) || last.market || ''} · ${fmtDay(last.landing_date)}` : 'No landings yet'}
          />
          <Stat
            k="Per day at sea"
            v={last && last.days_at_sea ? gbp0(Number(last.value || 0) / Number(last.days_at_sea)) : '—'}
            n={last && last.days_at_sea ? `${last.days_at_sea} days` : 'Days at sea not set'}
          />
          <Stat
            k="Boxes landed"
            v={last && last.boxes ? Number(last.boxes).toLocaleString('en-GB') : '—'}
            n={last && last.boxes ? `avg ${gbp0(Number(last.value || 0) / Number(last.boxes))} / box` : null}
          />
          <Stat
            k="Rolling 12 months"
            v={gbpBig(totals.rolling)}
            n={`${landings.length} landings`}
          />
        </div>
        {last && last.reconcile_ok === false && (
          <div className="trip-f">
            <span className="flag bad">Parse failed</span>{' '}
            The last landing did not reconcile, so its trip values cannot be trusted.{' '}
            <Link to="/landings" style={{ color: '#fff', textDecoration: 'underline' }}>Check landings</Link>
          </div>
        )}
      </div>

      {isSkipper && (
        <>
          <SectionRule side={quota.snapshot?.last_landing_date ? `as at ${fmtDay(quota.snapshot.last_landing_date)}` : undefined}>
            Quota position
          </SectionRule>
          <div className="card">
            {!quota.snapshot && (
              <p className="muted" style={{ margin: 0 }}>
                No AFPO statement loaded for {new Date().getFullYear()} yet.{' '}
                <Link to="/quota">Upload one</Link> to see the position here.
              </p>
            )}
            {quota.snapshot && quotaRows.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>Statement loaded, but no lines carry an allocation.</p>
            )}
            {quotaRows.map(r => (
              <div className="qrow" key={r.stock}>
                <div className="qtop">
                  <span className="qname">{r.stock} <span>{r.section}</span></span>
                  <span className={'flag ' + flagFor(r.pct)}>{flagText(r)}</span>
                </div>
                <div className="bar">
                  <i
                    className={flagFor(r.pct) === 'bad' ? 'bad' : flagFor(r.pct) === 'warn' ? 'warn' : ''}
                    style={{ width: Math.min(100, r.pct) + '%' }}
                  />
                </div>
                <div className="qtop" style={{ margin: '6px 0 0' }}>
                  <span className="qfig">
                    Used <b className="num">{r.used.toFixed(1)} t</b> of <b className="num">{r.alloc.toFixed(1)} t</b>
                  </span>
                  <span className="qfig num">{Math.round(r.pct)}%</span>
                </div>
              </div>
            ))}
            {quota.snapshot && (
              <p className="note">
                Statement position only — trips landed since {fmtDay(quota.snapshot.last_landing_date)} are not counted.
                The <Link to="/quota">Quota page</Link> adds them.
              </p>
            )}
          </div>
        </>
      )}

      <SectionRule side={new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}>
        Month to date
      </SectionRule>
      <div className="grid g2">
        <div className="card">
          <p className="sub">{totals.mtdCount} {totals.mtdCount === 1 ? 'trip' : 'trips'} landed</p>
          <div className="big num">{gbpBig(totals.mtd)}</div>
        </div>
        <div className="card">
          <p className="sub">Last landing</p>
          <div className="big num">{last ? fmtDay(last.landing_date) : '—'}</div>
          {last && <p className="muted" style={{ marginTop: 6 }}>{last.vessel} · {last.market}</p>}
        </div>
      </div>

      {loading && <p className="muted" style={{ marginTop: 16 }}>Loading…</p>}
      {!fleetTools && (
        <p className="muted" style={{ marginTop: 16 }}>
          Trip figures are available to skippers and viewers. Use the menu for what you can access.
        </p>
      )}
    </AppShell>
  )
}
