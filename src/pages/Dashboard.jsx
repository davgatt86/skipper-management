import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabaseClient'
import AppShell from '../AppShell'
import ReconcileBanner from '../ReconcileBanner'
import VesselPlate, { useVessel } from '../VesselPlate'
import DashboardBody from './DashboardBody'
import { fetchAll } from '../lib/fetchAll'
import {
  priceRows, landedThisYear, boatBlocks, toDo, dashboardSpecies,
} from '../lib/dashboard'
import { boardNameFor } from '../lib/market/boardNames'

/* THE FRONT PAGE — prices, your boat, what to do next.
 *
 * All the arithmetic is in `lib/dashboard.js` and all the drawing is in
 * `DashboardBody.jsx`; this does the IO and nothing else, so the page can be
 * server-rendered by `scripts/dashboard-preview.mjs`. The states worth checking
 * are the empty ones — six of the thirteen fleets have uploaded nothing at all
 * and used to open the app on a blank page.
 *
 * THE MARKET LOADS FIRST AND ON ITS OWN. It needs no fleet data, so it paints
 * for a brand-new boat and for one on a bad connection whose own queries fail.
 */
export default function Dashboard() {
  const { appUser } = useAuth()
  const fleetTools = ['skipper', 'viewer'].includes(appUser?.role)
  const { vessel, loading: vesselLoading } = useVessel()

  const [basis, setBasis] = useState(() => read('skipper.dash.basis', 'value'))
  const [source, setSource] = useState(() => read('skipper.dash.source', 'PD'))
  const [prices, setPrices] = useState([])
  const [rows, setRows] = useState([])
  const [landings, setLandings] = useState([])
  const [quota, setQuota] = useState(null)
  const [expiring, setExpiring] = useState([])
  const [counts, setCounts] = useState({})
  const [err, setErr] = useState('')

  /* ---- the market. No fleet, no login state, nothing to go wrong. -------- */
  useEffect(() => {
    let off = false
    ;(async () => {
      const from = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('market_prices')
        .select('price_date, species, grade, subgrade, low, high, ave')
        .eq('source', source)
        .gte('price_date', from)
        .order('price_date', { ascending: false })
      if (off) return
      if (error) setErr(error.message)
      else setPrices(data || [])
    })()
    return () => { off = true }
  }, [source])

  /* ---- her own record. Every part optional. ------------------------------ */
  useEffect(() => {
    if (!fleetTools) return
    let off = false
    ;(async () => {
      try {
        const [land, srows, snap, vcerts, ccerts] = await Promise.all([
          supabase.from('sales_landings')
            .select('id, landing_date, vessel, value, weight_kg, boxes, reconcile_ok')
            .order('landing_date', { ascending: false }).limit(400),
          /* WHOLE, via fetchAll — a truncated read would silently drop species
             from her own top six, which is the one thing this picks. */
          fetchAll('sales_rows', 'species, species_canon, value, weight_kg, landing_id'),
          supabase.from('quota_snapshots').select('*')
            .order('last_landing_date', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('vessel_certificates').select('cert_type, category, expiry_date'),
          supabase.from('crew_certificates').select('cert_type, expiry_date, crew_id'),
        ])
        if (off) return

        const byId = new Map((land.data || []).map((l) => [l.id, l]))
        setLandings(land.data || [])
        /* `fetchAll` returns { data, error } — NOT an array. Treating it as one
           threw "(x || []).map is not a function" on the front page, and
           because it threw before anything was set, the whole of her own
           record was missing: her top species were never picked, so the market
           panel silently fell back to what most boats land. A crash that
           degrades into a plausible-looking page is the worst shape. */
        setRows((srows.data || []).map((r) => ({
          ...r, landing_date: byId.get(r.landing_id)?.landing_date || null,
        })))

        if (snap?.data) {
          const { data: lines } = await supabase.from('quota_lines')
            .select('*').eq('snapshot_id', snap.data.id)
          if (!off) setQuota({ snapshot: snap.data, lines: lines || [] })
        }

        const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10)
        const ex = [
          ...(vcerts.data || []).filter((c) => c.expiry_date && c.expiry_date <= soon)
            .map((c) => ({ what: c.cert_type, who: c.category, expiry_date: c.expiry_date })),
          ...(ccerts.data || []).filter((c) => c.expiry_date && c.expiry_date <= soon)
            .map((c) => ({ what: c.cert_type, who: 'crew ticket', expiry_date: c.expiry_date })),
        ]
        if (!off) setExpiring(ex)

        /* What is waiting on a decision. Counts only — the pages themselves
           are where anything gets done. */
        const today = new Date().toISOString().slice(0, 10)
        const [unrec, bundles, firms] = await Promise.all([
          supabase.from('sales_landings').select('id', { count: 'exact', head: true })
            .eq('reconcile_ok', false).is('reconcile_ack_at', null),
          supabase.from('su_invoice_batches').select('id', { count: 'exact', head: true })
            .eq('status', 'new'),
          supabase.from('su_invoice_suppliers').select('id', { count: 'exact', head: true })
            .is('category', null),
        ])
        if (!off) setCounts({
          unreconciled: unrec.count || 0,
          unreadBundles: bundles.count || 0,
          unfiledFirms: firms.count || 0,
          expiredCount: ex.filter((e) => e.expiry_date < today).length,
        })
      } catch (e) { if (!off) setErr(e.message || String(e)) }
    })()
    return () => { off = true }
  }, [fleetTools])

  const landed = useMemo(() => landedThisYear(rows), [rows])
  const species = useMemo(() => dashboardSpecies(landed, { basis }), [landed, basis])
  const board = useMemo(() => priceRows(prices, species), [prices, species])
  const blocks = useMemo(() => boatBlocks({ landings, quota, expiring }), [landings, quota, expiring])
  const todo = useMemo(() => toDo(counts), [counts])

  const pick = (k, v, set) => { set(v); try { localStorage.setItem(k, v) } catch { /* private mode */ } }

  return (
    <AppShell>
      {fleetTools && <ReconcileBanner />}
      <VesselPlate vessel={vessel} loading={vesselLoading} />
      {err && <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>}
      <DashboardBody
        vessel={vessel} board={board} species={species} landed={landed}
        basis={basis} onBasis={(v) => pick('skipper.dash.basis', v, setBasis)}
        source={source} onSource={(v) => pick('skipper.dash.source', v, setSource)}
        blocks={blocks} todo={todo} canSeeMoney={fleetTools}
      />
    </AppShell>
  )
}

/* The two toggles are a view setting, so they live in localStorage: two people
   on one fleet may reasonably want different ones, the same reasoning as the
   current-vessel picker. */
function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

export { boardNameFor }
