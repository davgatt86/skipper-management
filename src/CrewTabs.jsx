import { NavLink } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { NAV, canSee } from './nav'

// The five crew sections, shown on every crew page.
//
// This replaces the crew-hub tile wall, which was a second menu duplicating
// the sidebar. The sections are the five agreed in CLAUDE.md, in order:
// status is set in section 1 and nowhere else; section 2 is the one
// contracted-crew workflow (contract runs → boxes land → month closes →
// bonus falls due) that used to be five separate tiles.
//
// TAKEN FROM nav.js RATHER THAN REPEATED HERE.
//
// This used to carry its own copy of the six sections and its own copy of the
// role rules, with a comment saying the two had to be kept in step. They were
// not: adding the officer role updated the sidebar and left this strip showing
// a mate links he cannot open. Deriving it means there is only one list and one
// rule, so they cannot disagree again.
const CREW_GROUP = NAV.find((g) => g.label === 'Crew')
const SECTIONS = (CREW_GROUP ? CREW_GROUP.items : []).map((i) => ({
  ...i,
  // The sidebar shouts its labels; a tab strip reads better in sentence case.
  label: i.label.replace(/\b([A-Z])(\w*)\b/g, (m, a, b, off) => (off === 0 ? m : a.toLowerCase() + b)),
}))

export default function CrewTabs() {
  const { appUser } = useAuth()
  const visible = SECTIONS.filter((s) => canSee(s.access, appUser))
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
