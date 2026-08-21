import { canSee, accessForPath, navFor } from './src/nav.js'
import { keepsLogs, keepsCrewRecords, keepsStores, homeFor, isOfficer, isCook, isSkipper } from './src/lib/roles.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const officer = { role: 'officer' }
const legacy = { role: 'engineer' }   // the old name for the same role
const skip = { role: 'skipper' }
const view = { role: 'viewer' }
const crew = { role: 'crew' }
const cook = { role: 'cook' }

// --- accessForPath: longest match wins, unlisted routes return null ---------
eq("accessForPath('/')", accessForPath('/'), 'all')
eq("accessForPath('/engine-logs')", accessForPath('/engine-logs'), 'officer')
eq("accessForPath('/gear')", accessForPath('/gear'), 'officer')
// /parts must not inherit from /party or similar — longest match wins.
eq("accessForPath('/parts')", accessForPath('/parts'), 'officer')
eq("accessForPath('/engine-room')", accessForPath('/engine-room'), 'officer')
eq("accessForPath('/maintenance')", accessForPath('/maintenance'), 'officer')
eq("accessForPath('/crew-certs')", accessForPath('/crew-certs'), 'officer')
eq("accessForPath('/crew-list')", accessForPath('/crew-list'), 'officer')
eq("accessForPath('/crew')", accessForPath('/crew'), ['all', 'officer'])
eq("accessForPath('/sales')", accessForPath('/sales'), 'fleetTools')
eq("accessForPath('/quota')", accessForPath('/quota'), 'skipper')
// /vessel must NOT swallow /vessel-certs, and /crew must not swallow /crew-list
eq("accessForPath('/vessel')", accessForPath('/vessel'), 'skipper')
eq("accessForPath('/contracted-crew')", accessForPath('/contracted-crew'), 'all')
// unlisted -> null
eq("accessForPath('/contracts/abc')", accessForPath('/contracts/abc'), null)
eq("accessForPath('/settings')", accessForPath('/settings'), null)

// --- canSee: an officer sees ONLY what is marked for him --------------------
for (const a of ['fleetTools', 'skipper', 'owner']) {
  eq(`officer denied '${a}'`, canSee(a, officer), false)
}
// 'all' alone is NOT enough for an officer — the allow-list is strict.
eq("officer denied bare 'all'", canSee('all', officer), false)
eq("officer allowed 'officer'", canSee('officer', officer), true)
// ...but an item may name both audiences, which is how Crew Status is shared.
eq("officer allowed ['all','officer']", canSee(['all', 'officer'], officer), true)
eq("everyone else still sees ['all','officer']", canSee(['all', 'officer'], crew), true)

eq('legacy engineer role behaves as officer', canSee('officer', legacy), true)
eq('legacy engineer denied fleetTools', canSee('fleetTools', legacy), false)

eq("skipper allowed 'officer'", canSee('officer', skip), true)
eq("viewer denied 'officer'", canSee('officer', view), false)
// nothing changed for the existing roles
eq("skipper still sees 'skipper'", canSee('skipper', skip), true)
eq("viewer still sees 'fleetTools'", canSee('fleetTools', view), true)
eq("viewer still denied 'skipper'", canSee('skipper', view), false)
eq("viewer still sees 'all'", canSee('all', view), true)

// --- the officer's whole menu ----------------------------------------------
const offNav = navFor(officer).flatMap((g) => g.items.map((i) => i.to)).sort()
eq('officer menu', offNav, [
  '/crew', '/crew-certs', '/crew-list',
  // The gear log is deck work — a mate keeps it as much as the skipper does.
  '/engine-logs', '/engine-room', '/fuel-log', '/garbage-log', '/gear', '/maintenance', '/parts', '/vessel-certs',
])
eq('officer sees Crew and Vessel only', navFor(officer).map((g) => g.label), ['Crew', 'Vessel'])
// The money must not appear anywhere in his menu.
for (const gone of ['/sales', '/quota', '/settlements', '/reconcile', '/contracted-crew', '/users', '/']) {
  eq(`officer menu excludes ${gone}`, offNav.includes(gone), false)
}
eq('legacy engineer gets the same menu',
  navFor(legacy).flatMap((g) => g.items.map((i) => i.to)).sort(), offNav)

// the skipper's menu must not have shrunk
const skipNav = navFor(skip).flatMap((g) => g.items.map((i) => i.to))
for (const route of ['/', '/sales', '/quota', '/engine-logs', '/fuel-log', '/garbage-log',
                     '/vessel-certs', '/reconcile', '/crew', '/crew-list', '/crew-certs',
                     '/engine-room', '/maintenance', '/contracted-crew']) {
  eq(`skipper keeps ${route}`, skipNav.includes(route), true)
}
// and a viewer's must not have grown
eq('viewer still cannot see crew certs', navFor(view).flatMap((g) => g.items.map((i) => i.to)).includes('/crew-certs'), false)

// --- role helpers ----------------------------------------------------------
eq('keepsLogs(officer)', keepsLogs(officer), true)
eq('keepsLogs(legacy engineer)', keepsLogs(legacy), true)
eq('keepsLogs(skipper)', keepsLogs(skip), true)
eq('keepsLogs(viewer)', keepsLogs(view), false)
eq('keepsCrewRecords(officer)', keepsCrewRecords(officer), true)
eq('keepsCrewRecords(viewer)', keepsCrewRecords(view), false)
eq('keepsCrewRecords(crew)', keepsCrewRecords(crew), false)
eq('homeFor(officer)', homeFor(officer), '/engine-room')
eq('homeFor(skipper)', homeFor(skip), '/')
eq('isOfficer(null)', isOfficer(null), false)
eq('isSkipper(officer)', isSkipper(officer), false)
eq('keepsLogs(null)', keepsLogs(null), false)

// --- the COOK ---------------------------------------------------------------
/* The narrowest role in the app: the stores list and nothing else. Written as
 * an allow-list for the same reason as the officer — adding a nav item hides
 * it from him by default, which is the safe direction to fail in.
 *
 * This is presentation. supabase/cook_role.sql is the boundary, and it was
 * verified by probe: reads stores 5 lines / sales 0 / crew 0 / payments 0 /
 * audit 0 / storage 0, writes his own fleet's list, blocked from another
 * fleet's, and crew_aboard_count() still returns 11 while crew itself reads 0.
 */
for (const a of ['all', 'fleetTools', 'skipper', 'owner', 'officer']) {
  eq(`cook denied '${a}'`, canSee(a, cook), false)
}
eq("cook allowed 'cook'", canSee('cook', cook), true)
eq("cook allowed ['fleetTools','cook']", canSee(['fleetTools', 'cook'], cook), true)
eq("skipper allowed 'cook'", canSee('cook', skip), true)
eq("viewer denied 'cook'", canSee('cook', view), false)
eq("officer denied 'cook'", canSee('cook', officer), false)
// The two allow-lists must not leak into each other: a cook is not a junior
// officer, and an officer has no business in the groceries.
eq("cook denied ['all','officer']", canSee(['all', 'officer'], cook), false)
eq("officer denied ['fleetTools','cook']", canSee(['fleetTools', 'cook'], officer), false)

// His whole menu is ONE page. If this ever grows, it was not on purpose.
const cookNav = navFor(cook).flatMap((g) => g.items.map((i) => i.to))
eq('cook menu is the stores list alone', cookNav, ['/stores'])
eq('and one group', navFor(cook).map((g) => g.label), ['Vessel'])
for (const gone of ['/', '/sales', '/quota', '/crew', '/engine-logs', '/gear', '/parts', '/users', '/settlements']) {
  eq(`cook menu excludes ${gone}`, cookNav.includes(gone), false)
}
// Stores did not disappear for the people who already had it.
for (const u of [skip, view]) {
  eq(`${u.role} still sees /stores`,
    navFor(u).flatMap((g) => g.items.map((i) => i.to)).includes('/stores'), true)
}
eq('officer still cannot see /stores',
  navFor(officer).flatMap((g) => g.items.map((i) => i.to)).includes('/stores'), false)

eq("accessForPath('/stores')", accessForPath('/stores'), ['fleetTools', 'cook'])
eq('isCook(cook)', isCook(cook), true)
eq('isCook(officer)', isCook(officer), false)
eq('isCook(null)', isCook(null), false)
eq('keepsStores(cook)', keepsStores(cook), true)
eq('keepsStores(skipper)', keepsStores(skip), true)
eq('keepsStores(viewer)', keepsStores(view), false)
eq('keepsStores(officer)', keepsStores(officer), false)
eq('keepsStores(null)', keepsStores(null), false)
// He keeps the groceries, not the books.
eq('keepsLogs(cook)', keepsLogs(cook), false)
eq('keepsCrewRecords(cook)', keepsCrewRecords(cook), false)
eq('homeFor(cook)', homeFor(cook), '/stores')
eq('isSkipper(cook)', isSkipper(cook), false)
eq('isOfficer(cook)', isOfficer(cook), false)


console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
