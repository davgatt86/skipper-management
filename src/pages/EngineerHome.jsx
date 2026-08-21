import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useCurrentVessel } from '../VesselContext'
import { pickDetails } from '../lib/vessels'
import { useAuth } from '../AuthContext'
import { keepsLogs } from '../lib/roles'
import { maintenanceBoard, STATUS } from '../lib/maintenance'
import { readCache, cacheTable, isOnline, withTimeout } from '../lib/offline/queue'
import { certStatus, certUrgency } from '../lib/certs/certStatus'

/* The engineer's front page.
 *
 * He was landing on the engine-log form, which answers "what shall I write
 * down" but not "what needs doing". This answers the second: how long since
 * each book was written in, and what is falling due.
 *
 * Built to be read at arm's length in a noisy engine room — big figures, one
 * column on a phone, and colour used only where it means something.
 *
 * Everything here reads from the offline cache first, so it works with no
 * signal like the rest of his pages.
 */

const LOGS = [
  { key: 'engine_logs', label: 'Engine log', to: '/engine-logs', dateField: 'log_date' },
  { key: 'vessel_fuel_log', label: 'Fuel & oil', to: '/fuel-log', dateField: 'entry_date' },
  { key: 'garbage_log', label: 'Garbage book', to: '/garbage-log', dateField: 'entry_date' },
]

const today = () => new Date().toISOString().slice(0, 10)
const daysSince = (d) => {
  if (!d) return null
  const then = new Date(String(d).slice(0, 10) + 'T00:00:00')
  const now = new Date(today() + 'T00:00:00')
  return Math.round((now - then) / 86400000)
}
const fmt = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')
const n0 = (v) => (v == null ? '—' : Math.round(Number(v)).toLocaleString('en-GB'))

// How long a book may go unwritten before it is worth pointing at. The engine
// log is a daily habit; the garbage book only gets an entry when something is
// landed ashore, so a fortnight there is normal and not a fault.
const STALE_DAYS = { engine_logs: 3, vessel_fuel_log: 21, garbage_log: 30 }

/* Read a table offline-first. Same shape as useOfflineTable's read half, but
 * this page only reads, and from five tables, so a hook per table would be
 * five subscriptions and five flushes for nothing. */
async function readTable(table, select, order) {
  const cached = await readCache(table)
  let rows = cached.rows
  if (isOnline()) {
    let q = supabase.from(table).select(select)
    if (order) q = q.order(order, { ascending: false })
    const { data, error } = await withTimeout(q).catch((e) => ({ data: null, error: e }))
    if (!error && data) { rows = data; cacheTable(table, data) }
  }
  return rows || []
}

export default function EngineerHome() {
  const { appUser } = useAuth()
  const canEdit = keepsLogs(appUser)

  const [logs, setLogs] = useState({})
  const [tasks, setTasks] = useState([])
  const [events, setEvents] = useState([])
  const [certs, setCerts] = useState([])
  const [vessel, setVessel] = useState(null)
  const boat = useCurrentVessel()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    ;(async () => {
      const [eng, fuel, garb, t, e, vc, vd] = await Promise.all([
        readTable('engine_logs', 'id, log_date, running_hours', 'log_date'),
        readTable('vessel_fuel_log', 'id, entry_date, kind, litres', 'entry_date'),
        readTable('garbage_log', 'id, entry_date, category', 'entry_date'),
        readTable('maintenance_tasks', '*'),
        readTable('maintenance_events', '*', 'done_on'),
        readTable('vessel_certificates', 'id, cert_type, expiry_date, category'),
        readTable('vessel_details', '*'),   // one row per boat since Aug 2026
      ])
      if (!live) return
      setLogs({ engine_logs: eng, vessel_fuel_log: fuel, garbage_log: garb })
      setTasks(t); setEvents(e); setCerts(vc); setVessel(pickDetails(vd, boat.current))   // one row per boat since Aug 2026
      setLoading(false)
    })()
    return () => { live = false }
  }, [])

  // Latest running hours drives every "hours since" on the page.
  const hoursNow = useMemo(() => {
    const withHours = (logs.engine_logs || [])
      .filter((l) => l.running_hours != null)
      .sort((a, b) => String(b.log_date).localeCompare(String(a.log_date)))
    return withHours.length ? Number(withHours[0].running_hours) : null
  }, [logs])

  const board = useMemo(
    () => maintenanceBoard(tasks, events, hoursNow, today()),
    [tasks, events, hoursNow]
  )

  const needsAttention = board.filter((b) => b.status.key === 'overdue' || b.status.key === 'due')

  const expiring = useMemo(() => {
    return (certs || [])
      .filter((c) => c.expiry_date)
      .map((c) => ({ ...c, st: certStatus(c.expiry_date) }))
      .filter((c) => c.st.state === 'expired' || c.st.state === 'due')
      .sort((a, b) => certUrgency(a.expiry_date) - certUrgency(b.expiry_date))
      .slice(0, 5)
  }, [certs])

  const card = { padding: '0.9rem 1rem' }
  const big = { fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.1 }

  return (
    <AppShell maxWidth={1100}>
      <PageHeader
        title="Engine Room"
        sub={vessel?.vessel_name ? `${vessel.vessel_name}${vessel.pln ? ` · ${vessel.pln}` : ''}` : 'Your logs at a glance'}
      />

      {loading && <div className="card"><p className="muted">Loading…</p></div>}

      {/* ---- the three books, and how long since each was written in ---- */}
      <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {LOGS.map((l) => {
          const rows = logs[l.key] || []
          const latest = rows
            .map((r) => r[l.dateField])
            .filter(Boolean)
            .sort((a, b) => String(b).localeCompare(String(a)))[0]
          const d = daysSince(latest)
          const stale = d != null && d > (STALE_DAYS[l.key] ?? 14)
          return (
            <Link key={l.key} to={l.to} className="card" style={{ ...card, textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{l.label}</div>
              <div style={{ ...big, color: d == null ? 'var(--mute, inherit)' : stale ? 'var(--brass)' : 'inherit' }}>
                {d == null ? '—' : d === 0 ? 'Today' : d}
              </div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                {d == null ? 'nothing recorded yet'
                  : d === 0 ? 'written up today'
                  : `${d === 1 ? 'day' : 'days'} since · ${fmt(latest)}`}
              </div>
              <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>{rows.length} entries</div>
            </Link>
          )
        })}

        <div className="card" style={card}>
          <div className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Running hours</div>
          <div style={big}>{n0(hoursNow)}</div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {hoursNow == null ? 'no hours logged yet' : 'from the latest engine log'}
          </div>
        </div>
      </div>

      {/* ---- what needs doing ---- */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Maintenance</h2>
          <Link to="/maintenance" style={{ fontSize: '0.85rem' }}>Open the record →</Link>
        </div>

        {!loading && board.length === 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Nothing tracked yet. <Link to="/maintenance">Set up what this boat services</Link> — oil changes,
            filters, impellers — and this page will show how long since each was done.
          </p>
        )}

        {board.length > 0 && (
          <>
            {needsAttention.length === 0 && (
              <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>Nothing falling due.</p>
            )}
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {board.slice(0, 8).map((b) => (
                <div key={b.task.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
                  padding: '0.5rem 0', borderTop: '1px solid var(--border)',
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', background: b.status.color, flex: '0 0 auto',
                  }} />
                  <span style={{ fontWeight: 600, flex: '1 1 12rem' }}>{b.task.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.9rem' }}>
                    {b.days == null ? 'never done'
                      : `${b.days} ${b.days === 1 ? 'day' : 'days'}`}
                    {b.hours != null && ` · ${n0(b.hours)} h`}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: b.status.color, fontWeight: 600 }}>
                    {b.status.label}
                    {b.status.key === 'overdue' && b.daysLeft != null && b.daysLeft < 0 && ` by ${Math.abs(b.daysLeft)}d`}
                    {b.status.key === 'overdue' && b.hoursLeft != null && b.hoursLeft < 0 && ` by ${n0(Math.abs(b.hoursLeft))}h`}
                  </span>
                </div>
              ))}
            </div>
            {board.length > 8 && (
              <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
                and {board.length - 8} more on the record.
              </p>
            )}
          </>
        )}
      </div>

      {/* ---- vessel papers he can see but not change ---- */}
      {expiring.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h2 style={{ marginTop: 0 }}>Vessel certificates falling due</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Read-only — renewing these is the skipper&rsquo;s job. Here so you know what the boat is carrying.
          </p>
          {expiring.map((c) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', padding: '0.35rem 0', borderTop: '1px solid var(--border)', fontSize: '0.9rem' }}>
              <span>{c.cert_type}</span>
              <span style={{ color: c.st.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{c.st.label} · {fmt(c.expiry_date)}</span>
            </div>
          ))}
          <Link to="/vessel-certs" style={{ fontSize: '0.85rem' }}>All certificates →</Link>
        </div>
      )}

      {canEdit && (
        <div className="card no-print" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link to="/engine-logs"><button>Record an engine log</button></Link>
          <Link to="/fuel-log"><button className="secondary">Fuel or oil</button></Link>
          <Link to="/garbage-log"><button className="secondary">Garbage entry</button></Link>
          <Link to="/maintenance"><button className="secondary">Log a job done</button></Link>
        </div>
      )}
    </AppShell>
  )
}
