import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'

const tile = {
  display: 'block', padding: '1.6rem 1rem', border: '1px solid var(--border)', borderRadius: 8,
  textAlign: 'center', textDecoration: 'none', color: 'var(--navy)', fontWeight: 700, fontSize: '1.05rem',
  background: 'var(--grey-50)'
}

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
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Link to="/password" style={{ fontSize: '0.85rem' }}>Change password</Link>
          <button className="secondary" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="card">
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {fleetTools && (
            <Link to="/sales" style={tile}>Fish Sales</Link>
          )}
          {appUser?.role === 'skipper' && (
            <Link to="/sales-insights" style={tile}>Sales Insights</Link>
          )}
          <Link to="/daily-prices" style={tile}>Daily Prices</Link>
          {fleetTools && (
            <Link to="/estimator" style={tile}>Where to Land</Link>
          )}
          {appUser?.role === 'skipper' && (
            <Link to="/quota" style={tile}>Quota</Link>
          )}
          {appUser?.role === 'skipper' && (
            <Link to="/vessel" style={tile}>Vessel</Link>
          )}
          {appUser?.role === 'skipper' && (
            <Link to="/crew-list" style={tile}>Crew List</Link>
          )}
          <Link to="/crew-hub" style={tile}>Crew</Link>
          {fleetTools && (
            <Link to="/squareup" style={tile}>Square Up</Link>
          )}
          {fleetTools && (
            <Link to="/rota" style={tile}>Rota</Link>
          )}
          {appUser?.role === 'skipper' && (
            <Link to="/users" style={tile}>Users</Link>
          )}
          {appUser?.is_owner && (
            <Link to="/add-boat" style={{ ...tile, background: 'var(--navy)', color: '#fff' }}>+ Add Boat</Link>
          )}
        </div>
      </div>
    </div>
  )
}
