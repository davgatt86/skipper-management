import { canSee, accessForPath, navFor } from './src/nav.js'
import { keepsLogs, keepsCrewRecords, homeFor, isOfficer, isSkipper } from './src/lib/roles.js'

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

// --- accessForPath: longest match wins, unlisted routes return null ---------
eq("accessForPath('/')", accessForPath('/'), 'all')
eq("accessForPath('/engine-logs')", accessForPath('/engine-logs'), 'officer')
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
  '/engine-logs', '/engine-room', '/fuel-log', '/garbage-log', '/maintenance', '/vessel-certs',
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

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
