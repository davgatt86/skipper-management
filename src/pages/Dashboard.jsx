import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'

const tile = {
  display: 'block', padding: '1.6rem 1rem', border: '1px solid var(--border)', borderRadius: 8,
  textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 700, fontSize: '1.05rem',
  background: 'var(--grey-50)'
}
const tileSoon = { ...tile, color: 'var(--grey-400)', background: 'transparent', cursor: 'default' }

export default function Dashboard() {
  const { appUser, signOut } = useAuth()
  const fleetTools = ['skipper', 'viewer'].includes(appUser?.role)

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
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {fleetTools && (
            <Link to="/sales" style={tile}>Fish Sales</Link>
          )}
          {fleetTools && (
            <Link to="/estimator" style={tile}>Trip Estimator</Link>
          )}
          {fleetTools && (
            <div style={tileSoon}>Quota<div style={{ fontSize: '0.75rem', fontWeight: 400 }}>coming soon</div></div>
          )}
          {fleetTools && (
            <Link to="/squareup" style={tile}>Square Up</Link>
          )}
          <Link to="/crew-hub" style={tile}>Crew</Link>
        </div>
      </div>
    </div>
  )
}
