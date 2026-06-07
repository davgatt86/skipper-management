import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabaseClient'

const STATUS_LABEL = { on_boat: 'On Boat', on_leave: 'On Leave', former: 'Former' }
const STATUS_COLOR = { on_boat: 'var(--green)', on_leave: 'var(--amber)', former: 'var(--grey-400)' }

const linkStyle = { display: 'block', padding: '1rem', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 600 }

function monthsSince(dateStr) {
  if (!dateStr) return null
  const ms = Date.now() - new Date(dateStr + 'T00:00:00').getTime()
  return Math.max(0, Math.round((ms / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10)
}

function money(n, cur) {
  if (n === null || n === undefined) return '—'
  return `${cur || '£'}${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function CrewHub() {
  const { appUser } = useAuth()
  const [crew, setCrew] = useState([])
  const [contracts, setContracts] = useState([])
  const [monthLandings, setMonthLandings] = useState([])
  const [ghbPaid, setGhbPaid] = useState({}) // contract_id -> amount paid
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const monthStart = new Date().toISOString().slice(0, 8) + '01'
      const [cRes, ctRes, lRes, sRes, pRes] = await Promise.all([
        supabase.from('crew').select('id, full_name, status, crew_type').is('archived_at', null).order('full_name'),
        supabase.from('contracts').select('id, crew_id, start_date, end_date, status, going_home_bonus').order('start_date', { ascending: false }),
        supabase.from('landings').select('id, landing_date, boxes, landing_crew(crew_id)').gte('landing_date', monthStart),
        supabase.from('settings').select('*').maybeSingle(),
        supabase.from('wage_payments').select('contract_id, payment_type, amount').in('payment_type', ['ghb_first_half', 'ghb_second_half']),
      ])
      const firstError = cRes.error || ctRes.error || lRes.error || sRes.error
      if (firstError) setError(firstError.message)
      setCrew(cRes.data || [])
      setContracts(ctRes.data || [])
      setMonthLandings(lRes.data || [])
      setSettings(sRes.data || null)
      const paid = {}
      for (const p of (pRes.data || [])) paid[p.contract_id] = (paid[p.contract_id] || 0) + Number(p.amount || 0)
      setGhbPaid(paid)
      setLoading(false)
    }
    load()
  }, [])

  const boxRate = settings ? Number(settings.box_rate) : 0
  const cur = settings?.currency || '£'

  // per-crewman derived figures
  function info(c) {
    const own = contracts.filter(x => x.crew_id === c.id)
    const active = own.find(x => x.status === 'active' || (!x.end_date && x.status !== 'ended')) || own.find(x => !x.end_date)
    const latestEnded = own.filter(x => x.end_date).sort((a, b) => b.end_date.localeCompare(a.end_date))[0]
    const out = {}
    if (c.status === 'on_boat' && active) {
      out.aboardMonths = monthsSince(active.start_date)
      const boxes = monthLandings.reduce((s, l) => s + ((l.landing_crew || []).some(x => x.crew_id === c.id) ? Number(l.boxes || 0) : 0), 0)
      out.monthBoxes = boxes
      out.monthBonus = Math.round(boxes * boxRate * 100) / 100
      if (active.going_home_bonus != null) {
        const remaining = Number(active.going_home_bonus) - (ghbPaid[active.id] || 0)
        out.ghbOnReturn = Math.max(0, Math.round(remaining * 100) / 100)
      }
    }
    if (c.status === 'on_leave') {
      out.ashoreMonths = latestEnded ? monthsSince(latestEnded.end_date) : null
    }
    return out
  }

  const visible = crew.filter(c => c.status !== 'former')
  const onBoatCount = visible.filter(c => c.status === 'on_boat').length
  const onLeaveCount = visible.filter(c => c.status === 'on_leave').length

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Crew</h1>
          <p className="muted"><Link to="/">← Dashboard</Link></p>
        </div>
      </header>

      <div className="card">
        <h2>Manage</h2>
        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Link to="/crew" style={linkStyle}>Crew ({crew.length})</Link>
          <Link to="/contracts" style={linkStyle}>Contracts</Link>
          <Link to="/landings" style={linkStyle}>Landings</Link>
          <Link to="/closeout" style={linkStyle}>Month Closeout</Link>
          {['skipper', 'viewer'].includes(appUser?.role) && (
            <Link to="/one-offs" style={linkStyle}>One-Off Bonuses</Link>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Crew status</h2>
        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">Error: {error}</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="muted">No crew added yet. <Link to="/crew">Add your first crewman →</Link></p>
        )}
        {!loading && !error && visible.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div><span style={{ color: STATUS_COLOR.on_boat, fontWeight: 700, fontSize: '1.3rem' }}>{onBoatCount}</span> <span className="muted">on boat</span></div>
              <div><span style={{ color: STATUS_COLOR.on_leave, fontWeight: 700, fontSize: '1.3rem' }}>{onLeaveCount}</span> <span className="muted">on leave</span></div>
            </div>
            <ul style={{ listStyle: 'none' }}>
              {visible.map((c) => {
                const i = info(c)
                return (
                  <li key={c.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong>{c.full_name}{c.crew_type === 'self_employed' && <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}> · self-employed</span>}</strong>
                      <span style={{ color: STATUS_COLOR[c.status], fontWeight: 600 }}>{STATUS_LABEL[c.status]}</span>
                    </div>
                    <div className="muted" style={{ fontSize: '0.85rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                      {c.status === 'on_boat' && c.crew_type !== 'self_employed' && (
                        <>
                          {i.aboardMonths != null && <span>{i.aboardMonths} months aboard</span>}
                          <span>{i.monthBoxes ? i.monthBoxes.toLocaleString('en-GB') : 0} boxes this month → {money(i.monthBonus || 0, cur)}</span>
                          {i.ghbOnReturn != null && <span style={{ color: 'var(--navy)' }}>GHB on return: {money(i.ghbOnReturn, cur)}</span>}
                        </>
                      )}
                      {c.status === 'on_leave' && (
                        <span>{i.ashoreMonths != null ? `${i.ashoreMonths} months since last contract ended` : 'no ended contract on record'}</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
