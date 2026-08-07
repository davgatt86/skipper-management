import { NavLink } from 'react-router-dom'
import { useAuth } from './AuthContext'

// The five crew sections, shown on every crew page.
//
// This replaces the crew-hub tile wall, which was a second menu duplicating
// the sidebar. The sections are the five agreed in CLAUDE.md, in order:
// status is set in section 1 and nowhere else; section 2 is the one
// contracted-crew workflow (contract runs → boxes land → month closes →
// bonus falls due) that used to be five separate tiles.
//
// Role gating matches nav.js exactly — the grouping changes how these are
// found, not who can reach them.
const SECTIONS = [
  { to: '/crew', label: 'Crew status', access: 'all', end: true },
  { to: '/contracted-crew', label: 'Contracted crew', access: 'all' },
  { to: '/crew-list', label: 'Crew list', access: 'skipper' },
  { to: '/rota', label: 'Rota planner', access: 'fleetTools' },
  { to: '/crew-certs', label: 'Certificates', access: 'skipper' },
]

function allowed(access, appUser) {
  const role = appUser?.role
  if (access === 'all') return true
  if (access === 'fleetTools') return ['skipper', 'viewer'].includes(role)
  if (access === 'skipper') return role === 'skipper'
  return false
}

export default function CrewTabs() {
  const { appUser } = useAuth()
  const visible = SECTIONS.filter((s) => allowed(s.access, appUser))
  if (visible.length < 2) return null

  return (
    <nav
      style={{
        display: 'flex', gap: '0.25rem', flexWrap: 'wrap',
        borderBottom: '1px solid var(--border)', marginBottom: '1rem',
      }}
    >
      {visible.map((s) => (
        <NavLink
          key={s.to}
          to={s.to}
          end={s.end}
          style={({ isActive }) => ({
            padding: '0.55rem 0.9rem',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '0.9rem',
            color: isActive ? 'var(--hull)' : 'var(--mute)',
            borderBottom: isActive ? '2px solid var(--hull)' : '2px solid transparent',
            marginBottom: -1,
            whiteSpace: 'nowrap',
          })}
        >
          {s.label}
        </NavLink>
      ))}
    </nav>
  )
}
