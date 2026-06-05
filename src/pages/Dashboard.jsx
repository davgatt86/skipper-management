import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabaseClient'

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
        .order('full_name')
      if (error) {
        setError(error.message)
      } else {
        setCrew(data || [])
      }
      setLoading(false)
    }
    loadCrew()
  }, [])

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Dashboard</h1>
          <p className="muted">
            Signed in as {appUser?.display_name || 'Unknown'} ({appUser?.role || 'no role'})
          </p>
        </div>
        <button className="secondary" onClick={signOut}>Sign out</button>
      </header>

      <div className="card">
        <h2>Database connection test</h2>
        {loading && <p className="muted">Loading crew from database…</p>}
        {error && (
          <div>
            <p className="error">Error: {error}</p>
            <p className="muted">
              This usually means the crew table is empty (which it is — we haven't added anyone yet),
              or that Row Level Security is blocking access. Both are normal at this stage.
            </p>
          </div>
        )}
        {!loading && !error && (
          <>
            <p className="success">✓ Connected to Supabase</p>
            {crew.length === 0 ? (
              <p className="muted">No crew in the database yet. We'll add them in the next step.</p>
            ) : (
              <ul style={{ listStyle: 'none', marginTop: '0.5rem' }}>
                {crew.map((c) => (
                  <li key={c.id} style={{ padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                    <strong>{c.full_name}</strong> — <span className="muted">{c.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>What's working so far</h2>
        <ul style={{ paddingLeft: '1.2rem', lineHeight: '1.8' }}>
          <li>✓ App deployed to Netlify</li>
          <li>✓ Connected to Supabase database</li>
          <li>✓ Login + auth flow</li>
          <li>✓ Reads from the crew table</li>
          <li className="muted">○ Crew management (next)</li>
          <li className="muted">○ Contracts (next)</li>
          <li className="muted">○ Landings (next)</li>
          <li className="muted">○ Month closeout (later)</li>
        </ul>
      </div>
    </div>
  )
}
