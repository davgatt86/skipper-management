import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import ThemeToggle from './ThemeToggle'
import { navFor } from './nav'
import MovedBanner from './components/MovedBanner'

// Sidebar shell: a persistent menu on the left, content on the right.
// Below 900px the sidebar becomes a drawer so the wheelhouse phone keeps the
// full width for figures.
//
// `maxWidth` narrows the content column for pages that were built narrow
// (Change password, Add boat, Alerts). The sidebar is `no-print`, so a page
// that prints keeps working exactly as it did.
export default function AppShell({ children, badges = {}, maxWidth }) {
  const { appUser, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const groups = navFor(appUser)

  return (
    <div className="shell">
      <button
        className="shell-burger no-print"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
      >
        ☰
      </button>

      {open && <div className="shell-scrim" onClick={() => setOpen(false)} />}

      <aside className={'shell-side no-print' + (open ? ' is-open' : '')}>
        {/* The wordmark is a second route back to the Dashboard — the habit
            most people reach for before they find the menu item. */}
        <Link to="/" className="shell-brand" onClick={() => setOpen(false)}>
          <span className="shell-mark" aria-hidden="true" />
          <span className="shell-brandtxt">Skipper Management</span>
        </Link>

        <nav className="shell-nav">
          {groups.map(g => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items.map(i => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.end}
                  className={({ isActive }) => 'nav-item' + (isActive ? ' is-active' : '')}
                  onClick={() => setOpen(false)}
                >
                  <span>{i.label}</span>
                  {i.badge && badges[i.badge] > 0 && (
                    <span className="nav-badge num">{badges[i.badge]}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="shell-foot">
          <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
            {appUser?.display_name || 'Unknown'} · {appUser?.role || 'no role'}
          </div>
          <ThemeToggle />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
            <Link to="/password" style={{ fontSize: '0.8rem' }}>Password</Link>
            <button className="secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="shell-main" style={maxWidth ? { maxWidth } : undefined}>
        {/* Renders nothing unless the user is still on the old netlify.app
            address, so it costs the moved-over majority nothing and cannot
            become permanent furniture. */}
        <MovedBanner />
        {children}
      </main>
    </div>
  )
}
