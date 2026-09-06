// Navigation groups for the sidebar.
//
// These are exactly the destinations the old dashboard tile wall offered, with
// exactly the same role gating — the grouping changes how they are found, not
// who can reach them. Do not add a route here without checking what guards it.
//
//   all        — any signed-in user (except an officer, see below)
//   fleetTools — skipper or viewer
//   officer    — skipper or officer: the logs, maintenance and crew papers
//   cook       — skipper or cook: the stores list
//   skipper    — skipper only
//   owner      — fleet owner only
//
// An officer sees ONLY items marked `officer`, and a cook ONLY items marked
// `cook` — neither sees the ones marked `all`. That mirrors the allow-lists in
// `supabase/officer_role.sql` and `supabase/cook_role.sql`, which is where the
// boundary actually lives: hiding a menu entry hides nothing from anyone
// holding a session token.
//
// `access` may be an ARRAY when an item belongs to two audiences that do not
// nest — Crew Status is for everybody AND for officers, and neither level
// contains the other. Written as `['all', 'officer']`.

// Extension included on purpose: node resolves ESM specifiers literally, so
// './lib/roles' would break `node test-roles.mjs`. Vite is happy either way.
import { isOfficer, isCook } from './lib/roles.js'

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
    label: 'Market',
    items: [
      { to: '/daily-prices', label: 'Daily Prices', access: 'all' },
      { to: '/estimator', label: 'Where to Land', access: 'fleetTools' },
      // Laying the trip out on the market floor once the destination is settled.
      { to: '/market-layout', label: 'Market Layout', access: 'fleetTools' },
      // Which clock each fish goes on and how high it stacks. Read by the
      // layout page, changed only by the skipper — the market moves species
      // between clocks and that should not need a deploy.
      { to: '/market-rules', label: 'Market Rules', access: 'fleetTools' },
      { to: '/forecast', label: 'Market Forecast', access: 'skipper' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/sales', label: 'Fish Sales', access: 'fleetTools' },
      { to: '/sales-insights', label: 'Sales Insights', access: 'skipper' },
      { to: '/buyer-league', label: 'Buyer League', access: 'fleetTools' },
      // What each TRIP made per day at sea. The unit is the trip, not the
      // landing — see src/lib/tripAgg.js for why that distinction matters.
      { to: '/trips', label: 'Trip Rates', access: 'fleetTools' },
      { to: '/sales-compare', label: 'Compare Sales', access: 'skipper' },
      /* NOT ON THE DEMO. It is the one page that is deliberately cross-fleet,
         and the demo login goes to strangers and competitors. The RPCs
         exclude demo fleets on their own — that is the boundary — but a page
         that answers "No sales in 2026" for a boat with 25 landings looks
         broken rather than withheld, so it comes off the menu too. */
      { to: '/price-vs-fleet', label: 'Price vs Fleet', access: 'skipper', notOnDemo: true },
    ],
  },
  {
    label: 'Quota',
    items: [
      { to: '/quota', label: 'Quota Position', access: 'skipper' },
    ],
  },
  {
    // The two ends of the same loop: the worksheet that goes to the office,
    // and the settled sheet that comes back.
    label: 'Settlement',
    items: [
      { to: '/squareup', label: 'Square Up', access: 'fleetTools' },
      { to: '/settlements', label: 'Settlements', access: 'skipper' },
      // The costs the office sends back every Monday, split by supplier.
      // Skipper only: an invoice is money, which is what the officer and
      // cook roles are denied at the database.
      { to: '/invoices', label: 'Invoices', access: 'skipper' },
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
      // The officer's front page: how long since each book was written in and
      // what is falling due.
      { to: '/engine-room', label: 'Engine Room', access: 'officer' },
      { to: '/maintenance', label: 'Maintenance', access: 'officer' },
      // What a job used and what is left aboard. The stock figure is derived
      // from the maintenance record, never typed — see src/lib/maintenance/parts.js.
      { to: '/parts', label: 'Parts', access: 'officer' },
      // Read-only to an engineer — he needs to see when the liferaft service
      // or the extinguisher certificate runs out; renewing them is not his job.
      { to: '/vessel-certs', label: 'Vessel Certificates', access: 'officer' },
      { to: '/stowage', label: 'Stowage Plan', access: 'skipper' },
      // Provisions for the trip. The catalogue is the order form the boat
      // already uses; the page exists to get it to a supplier who has no login.
      // 'cook' as well as fleetTools: this is the cook's ONLY page, and the
      // two audiences do not nest — a viewer is not a cook and vice versa.
      { to: '/stores', label: 'Stores', access: ['fleetTools', 'cook'] },
      { to: '/engine-logs', label: 'Engine Logs', access: 'officer' },
      { to: '/fuel-log', label: 'Fuel & Oil Log', access: 'officer' },
      // The third book the boat keeps: what was done to the nets, and when.
      // Deck work, so it is the mate's as much as the skipper's.
      { to: '/gear', label: 'Gear Log', access: 'officer' },
    ],
  },
  {
    /* THE STATUTORY BOOKS, and they answer to a different reader.
     *
     * Everything else in this menu is for the boat. These are for whoever comes
     * aboard to check her — an MCA surveyor, a port state inspector — and they
     * are kept to a standard the rest of the app does not have to meet.
     *
     * David, Sep 2026: "garbage, crew lists & oil record book would end up
     * being part of certification part."
     *
     * THE CREW LIST MOVED HERE OUT OF CREW, which drops CrewTabs from five
     * sections to four. It is a border document — an IMO FAL Form 5 — long
     * before it is a crew admin page, and it belongs with the papers a boarding
     * officer asks for.
     *
     * STILL MISSING: an Oil Record Book. Audacious is 498 GT, so MARPOL Annex I
     * Part I applies, and the Fuel & Oil Log under Vessel is NOT one — it is a
     * bunkering record, with no coded entries and no master's signature. That
     * gap is real and is not closed by this group existing.
     */
    label: 'Certification',
    items: [
      // The annual self-certification, worked through the MCA's own aide
      // memoire for the 15m to 24m band. Which band applies is decided on
      // REGISTERED length, and Audacious is 23.96 m — see selfCert.js.
      { to: '/self-certification', label: 'Self-Certification', access: 'officer' },
      { to: '/crew-list', label: 'Crew List', access: 'officer' },
      { to: '/garbage-log', label: 'Garbage Record Book', access: 'officer' },
    ],
  },
  {
    // The five crew sections. These match CrewTabs.jsx exactly — the tab strip
    // on the crew pages and this menu group are the same five destinations,
    // so keep them in step.
    label: 'Crew',
    items: [
      // An officer adds a man and files his tickets, so these three are his as
      // well. Contracted Crew is NOT — that is contracts, bonuses and pay,
      // which he is denied at the database.
      { to: '/crew', label: 'Crew Status', access: ['all', 'officer'], end: true },
      { to: '/contracted-crew', label: 'Contracted Crew', access: 'all' },
      { to: '/rota', label: 'Rota Planner', access: 'fleetTools' },
      { to: '/crew-certs', label: 'Certificates', access: 'officer' },
      { to: '/familiarisation', label: 'Familiarisation', access: 'skipper' },
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

export function canSee(access, appUser, item) {
  /* A page can be withheld from the DEMONSTRATION tenant. This hides a MENU
   * ENTRY and nothing else — nav.js is presentation and RLS is the boundary,
   * so anything genuinely withheld is withheld at the database too. It exists
   * so a visitor is not shown a page that can only ever answer "nothing":
   * Price vs Fleet reads across fleets by design, the RPCs now exclude demo
   * fleets, and the page would otherwise say "No sales in 2026" to a boat
   * with twenty-five landings. */
  if (item?.notOnDemo && appUser?.is_demo) return false
  const list = Array.isArray(access) ? access : [access]
  // Deliberately first, and deliberately allow-lists: an officer sees the pages
  // marked `officer` and nothing else, including nothing marked 'all'; a cook
  // sees only `cook`. Adding a nav item therefore hides it from both by
  // default, which is the safe direction to fail in.
  if (isOfficer(appUser)) return list.includes('officer')
  if (isCook(appUser)) return list.includes('cook')
  return list.some((a) => canSeeOne(a, appUser))
}

function canSeeOne(access, appUser) {
  const role = appUser?.role
  switch (access) {
    case 'all': return true
    case 'fleetTools': return ['skipper', 'viewer'].includes(role)
    case 'officer': return role === 'skipper'
    case 'cook': return role === 'skipper'
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
    .map(g => ({ ...g, items: g.items.filter(i => canSee(i.access, appUser, i)) }))
    .filter(g => g.items.length > 0)
}
