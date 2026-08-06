// Navigation groups for the sidebar.
//
// These are exactly the destinations the old dashboard tile wall offered, with
// exactly the same role gating — the grouping changes how they are found, not
// who can reach them. Do not add a route here without checking what guards it.
//
//   all        — any signed-in user
//   fleetTools — skipper or viewer
//   skipper    — skipper only
//   owner      — fleet owner only

export const NAV = [
  {
    label: 'Overview',
    items: [
      // `end` because NavLink treats "/" as a prefix match otherwise, and the
      // Dashboard would show as active on every page.
      { to: '/', label: 'Dashboard', access: 'all', end: true },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/sales', label: 'Fish Sales', access: 'fleetTools' },
      { to: '/sales-insights', label: 'Sales Insights', access: 'skipper' },
      { to: '/sales-compare', label: 'Compare Sales', access: 'skipper' },
      { to: '/price-vs-fleet', label: 'Price vs Fleet', access: 'skipper' },
    ],
  },
  {
    label: 'Market',
    items: [
      { to: '/daily-prices', label: 'Daily Prices', access: 'all' },
      { to: '/estimator', label: 'Where to Land', access: 'fleetTools' },
      { to: '/forecast', label: 'Market Forecast', access: 'skipper' },
    ],
  },
  {
    label: 'Quota',
    items: [
      { to: '/quota', label: 'Quota Position', access: 'skipper' },
    ],
  },
  {
    label: 'Crew',
    items: [
      { to: '/crew-hub', label: 'Crew', access: 'all' },
      { to: '/crew-list', label: 'Crew List', access: 'skipper' },
      { to: '/crew-certs', label: 'Certificates', access: 'skipper' },
      { to: '/rota', label: 'Rota', access: 'fleetTools' },
      { to: '/squareup', label: 'Square Up', access: 'fleetTools' },
    ],
  },
  {
    label: 'Vessel',
    items: [
      { to: '/vessel', label: 'Vessel Details', access: 'skipper' },
      { to: '/stowage', label: 'Stowage Plan', access: 'skipper' },
      { to: '/engine-logs', label: 'Engine Logs', access: 'skipper' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/alerts', label: 'Alerts', access: 'skipper', badge: 'alerts' },
      { to: '/users', label: 'Users', access: 'skipper' },
      { to: '/add-boat', label: 'Add Boat', access: 'owner' },
    ],
  },
]

export function canSee(access, appUser) {
  const role = appUser?.role
  switch (access) {
    case 'all': return true
    case 'fleetTools': return ['skipper', 'viewer'].includes(role)
    case 'skipper': return role === 'skipper'
    case 'owner': return !!appUser?.is_owner
    default: return false
  }
}

// Groups with nothing visible to this user are dropped entirely, so a viewer
// never sees an empty "Quota" heading.
export function navFor(appUser) {
  return NAV
    .map(g => ({ ...g, items: g.items.filter(i => canSee(i.access, appUser)) }))
    .filter(g => g.items.length > 0)
}
