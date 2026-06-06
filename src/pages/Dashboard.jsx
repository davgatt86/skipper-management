import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabaseClient'

const STATUS_LABEL = { on_boat: 'On Boat', on_leave: 'On Leave', former: 'Former' }
const STATUS_COLOR = { on_boat: 'var(--green)', on_leave: 'var(--amber)', former: 'var(--grey-400)' }

export default function Dashboard() {
  const { appUser, signOut } = useAuth()
  const [crew, setCrew] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadCrew() {
      const { data, error } = await supabase
        .from('crew')
        .select('id, full_name, status')
        .is('archived_at', null)
        .order('full_name')
      if (error) setError(error.message)
      else setCrew(data || [])
      setLoading(false)
    }
    loadCrew()
  }, [])

  const onBoatCount = crew.filter(c => c.status === 'on_boat').length
  const onLeaveCount = crew.filter(c => c.status === 'on_leave').length

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Skipper Management</h1>
          <p className="muted">
            Signed in as {appUser?.display_name || 'Unknown'} ({appUser?.role || 'no role'})
          </p>
        </div>
        <button className="secondary" onClick={signOut}>Sign out</button>
      </header>

      <div className="card">
        <h2>Manage</h2>
        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Link to="/crew" style={{ display: 'block', padding: '1rem', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 600 }}>
            Crew ({crew.length})
          </Link>
          <Link to="/contracts" style={{ display: 'block', padding: '1rem', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 600 }}>
            Contracts
          </Link>
          <Link to="/landings" style={{ display: 'block', padding: '1rem', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 600 }}>
            Landings
          </Link>
          <Link to="/closeout" style={{ display: 'block', padding: '1rem', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 600 }}>
            Month Closeout
          </Link>
          {['skipper', 'viewer'].includes(appUser?.role) && (
            <Link to="/one-offs" style={{ display: 'block', padding: '1rem', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 600 }}>
              One-Off Bonuses
            </Link>
          )}
        </div>
      </div>

      {appUser?.role !== 'crew' && (
        <div className="card">
          <h2>Fleet tools</h2>
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {['skipper', 'viewer'].includes(appUser?.role) && (
              <Link to="/sales" style={{ display: 'block', padding: '1rem', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 600, background: 'var(--grey-50)' }}>
                Fish Sales
              </Link>
            )}
            <a href="https://pd-dk-gross-estimator.netlify.app" target="_blank" rel="noreferrer" style={{ display: 'block', padding: '1rem', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 600 }}>
              Trip Gross Estimator
            </a>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Crew status</h2>
        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">Error: {error}</p>}
        {!loading && !error && crew.length === 0 && (
          <p className="muted">No crew added yet. <Link to="/crew">Add your first crewman →</Link></p>
        )}
        {!loading && !error && crew.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div><span style={{ color: STATUS_COLOR.on_boat, fontWeight: 700, fontSize: '1.3rem' }}>{onBoatCount}</span> <span className="muted">on boat</span></div>
              <div><span style={{ color: STATUS_COLOR.on_leave, fontWeight: 700, fontSize: '1.3rem' }}>{onLeaveCount}</span> <span className="muted">on leave</span></div>
            </div>
            <ul style={{ listStyle: 'none' }}>
              {crew.map((c) => (
                <li key={c.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{c.full_name}</strong>
                  <span style={{ color: STATUS_COLOR[c.status], fontWeight: 600 }}>{STATUS_LABEL[c.status]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
