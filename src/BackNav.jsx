import { Link, useNavigate } from 'react-router-dom'

// "← Back" goes one page back in history (e.g. Landings -> Crew hub),
// with Dashboard alongside as the fixed escape hatch.
export default function BackNav() {
  const navigate = useNavigate()
  return (
    <span style={{ fontSize: '0.9rem', display: 'inline-flex', gap: '1rem', alignItems: 'center' }}>
      <button
        onClick={() => navigate(-1)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--navy)', fontSize: '0.9rem', textDecoration: 'underline', fontFamily: 'inherit'
        }}
      >
        ← Back
      </button>
      <Link to="/">Dashboard</Link>
    </span>
  )
}
