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
    // The five crew sections. These match CrewTabs.jsx exactly — the tab strip
    // on the crew pages and this menu group are the same five destinations,
    // so keep them in step.
    label: 'Crew',
    items: [
      { to: '/crew', label: 'Crew Status', access: 'all', end: true },
      { to: '/contracted-crew', label: 'Contracted Crew', access: 'all' },
      { to: '/crew-list', label: 'Crew List', access: 'skipper' },
      { to: '/rota', label: 'Rota Planner', access: 'fleetTools' },
      { to: '/crew-certs', label: 'Certificates', access: 'skipper' },
      { to: '/familiarisation', label: 'Familiarisation', access: 'skipper' },
    ],
  },
  {
    // The two ends of the same loop: the worksheet that goes to the office,
    // and the settled sheet that comes back.
    label: 'Settlement',
    items: [
      { to: '/squareup', label: 'Square Up', access: 'fleetTools' },
      { to: '/settlements', label: 'Settlements', access: 'skipper' },
    ],
  },
  {
    label: 'Vessel',
    items: [
      { to: '/vessel', label: 'Vessel Details', access: 'skipper' },
      // The vessel's own papers. Crew tickets live under Crew — keeping the
      // two apart is the point, since they expire on different clocks and
      // are chased from different places.
      { to: '/vessel-certs', label: 'Vessel Certificates', access: 'skipper' },
      { to: '/stowage', label: 'Stowage Plan', access: 'skipper' },
      { to: '/engine-logs', label: 'Engine Logs', access: 'skipper' },
      { to: '/fuel-log', label: 'Fuel & Oil Log', access: 'skipper' },
      { to: '/garbage-log', label: 'Garbage Record Book', access: 'skipper' },
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
