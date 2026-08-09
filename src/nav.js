// Navigation groups for the sidebar.
//
// These are exactly the destinations the old dashboard tile wall offered, with
// exactly the same role gating — the grouping changes how they are found, not
// who can reach them. Do not add a route here without checking what guards it.
//
//   all        — any signed-in user (except an engineer, see below)
//   fleetTools — skipper or viewer
//   engineer   — skipper or engineer: the logs kept by whoever is aboard
//   skipper    — skipper only
//   owner      — fleet owner only
//
// An engineer sees ONLY items marked `engineer`, and nothing else — not even
// the ones marked `all`. That mirrors the allow-list in
// `supabase/engineer_role.sql`, which is where the boundary actually lives:
// hiding a menu entry hides nothing from anyone holding a session token.

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
      { to: '/buyer-league', label: 'Buyer League', access: 'fleetTools' },
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
      // The two ends of the loop compared: sales notes against what came back.
      { to: '/reconcile', label: 'Landings vs Settlements', access: 'fleetTools' },
    ],
  },
  {
    label: 'Vessel',
    items: [
      { to: '/vessel', label: 'Vessel Details', access: 'skipper' },
      // The vessel's own papers. Crew tickets live under Crew — keeping the
      // two apart is the point, since they expire on different clocks and
      // are chased from different places.
      // The engineer's front page: how long since each book was written in and
      // what is falling due. First in the group so it is first in his menu.
      { to: '/engine-room', label: 'Engine Room', access: 'engineer' },
      { to: '/maintenance', label: 'Maintenance', access: 'engineer' },
      // Read-only to an engineer — he needs to see when the liferaft service
      // or the extinguisher certificate runs out; renewing them is not his job.
      { to: '/vessel-certs', label: 'Vessel Certificates', access: 'engineer' },
      { to: '/stowage', label: 'Stowage Plan', access: 'skipper' },
      { to: '/engine-logs', label: 'Engine Logs', access: 'engineer' },
      { to: '/fuel-log', label: 'Fuel & Oil Log', access: 'engineer' },
      { to: '/garbage-log', label: 'Garbage Record Book', access: 'engineer' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/alerts', label: 'Alerts', access: 'skipper', badge: 'alerts' },
      { to: '/users', label: 'Users', access: 'skipper' },
      // Under Admin on purpose, not the dashboard. The dashboard is for the
      // boat; this is for going back and finding out who changed something.
      { to: '/activity', label: 'Activity', access: 'skipper' },
      { to: '/add-boat', label: 'Add Boat', access: 'owner' },
    ],
  },
]

export function canSee(access, appUser) {
  const role = appUser?.role
  // Deliberately first, and deliberately an allow-list: an engineer sees the
  // four log pages and nothing else, including nothing marked 'all'. Adding a
  // nav item therefore hides it from engineers by default, which is the safe
  // direction to fail in.
  if (role === 'engineer') return access === 'engineer'
  switch (access) {
    case 'all': return true
    case 'fleetTools': return ['skipper', 'viewer'].includes(role)
    case 'engineer': return role === 'skipper'
    case 'skipper': return role === 'skipper'
    case 'owner': return !!appUser?.is_owner
    default: return false
  }
}

// What access a URL needs, derived from the menu above rather than repeated in
// the router — so adding a page to the menu guards its route in the same edit.
//
// Longest match wins, so /contracts/:id inherits /contracts. Returns null for
// routes that are not in the menu at all (/settings, /password, the contracted-
// crew workflow pages), which the router treats as "allow, unless engineer" —
// failing towards the tighter role rather than the looser one.
export function accessForPath(pathname) {
  let best = null
  for (const g of NAV) {
    for (const i of g.items) {
      const hit = i.to === '/'
        ? pathname === '/'
        : pathname === i.to || pathname.startsWith(i.to + '/')
      if (hit && (!best || i.to.length > best.to.length)) best = i
    }
  }
  return best ? best.access : null
}

// Groups with nothing visible to this user are dropped entirely, so a viewer
// never sees an empty "Quota" heading.
export function navFor(appUser) {
  return NAV
    .map(g => ({ ...g, items: g.items.filter(i => canSee(i.access, appUser)) }))
    .filter(g => g.items.length > 0)
}
