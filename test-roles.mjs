import { canSee, accessForPath, navFor } from './src/nav.js'
import { keepsLogs, homeFor, isEngineer } from './src/lib/roles.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const eng = { role: 'engineer' }
const skip = { role: 'skipper' }
const view = { role: 'viewer' }

// --- accessForPath: longest match wins, unlisted routes return null ---------
eq("accessForPath('/')", accessForPath('/'), 'all')
eq("accessForPath('/engine-logs')", accessForPath('/engine-logs'), 'engineer')
eq("accessForPath('/fuel-log')", accessForPath('/fuel-log'), 'engineer')
eq("accessForPath('/garbage-log')", accessForPath('/garbage-log'), 'engineer')
eq("accessForPath('/vessel-certs')", accessForPath('/vessel-certs'), 'engineer')
eq("accessForPath('/engine-room')", accessForPath('/engine-room'), 'engineer')
eq("accessForPath('/maintenance')", accessForPath('/maintenance'), 'engineer')
eq("accessForPath('/sales')", accessForPath('/sales'), 'fleetTools')
eq("accessForPath('/quota')", accessForPath('/quota'), 'skipper')
eq("accessForPath('/settlements')", accessForPath('/settlements'), 'skipper')
// /vessel must NOT swallow /vessel-certs (prefix trap)
eq("accessForPath('/vessel')", accessForPath('/vessel'), 'skipper')
// unlisted -> null
eq("accessForPath('/contracts/abc')", accessForPath('/contracts/abc'), null)
eq("accessForPath('/settings')", accessForPath('/settings'), null)

// --- canSee: an engineer sees ONLY 'engineer' ------------------------------
for (const a of ['all', 'fleetTools', 'skipper', 'owner']) {
  eq(`engineer denied '${a}'`, canSee(a, eng), false)
}
eq("engineer allowed 'engineer'", canSee('engineer', eng), true)
eq("skipper allowed 'engineer'", canSee('engineer', skip), true)
eq("viewer denied 'engineer'", canSee('engineer', view), false)
// nothing changed for the existing roles
eq("skipper still sees 'skipper'", canSee('skipper', skip), true)
eq("viewer still sees 'fleetTools'", canSee('fleetTools', view), true)
eq("viewer still denied 'skipper'", canSee('skipper', view), false)
eq("viewer still sees 'all'", canSee('all', view), true)

// --- the engineer's whole menu ---------------------------------------------
const engNav = navFor(eng).flatMap((g) => g.items.map((i) => i.to)).sort()
eq('engineer menu', engNav,
  ['/engine-logs', '/engine-room', '/fuel-log', '/garbage-log', '/maintenance', '/vessel-certs'])
eq('engineer sees one group', navFor(eng).map((g) => g.label), ['Vessel'])

// the skipper's menu must not have shrunk
const skipNav = navFor(skip).flatMap((g) => g.items.map((i) => i.to))
for (const route of ['/', '/sales', '/quota', '/engine-logs', '/fuel-log', '/garbage-log', '/vessel-certs', '/reconcile']) {
  eq(`skipper keeps ${route}`, skipNav.includes(route), true)
}

// --- role helpers ----------------------------------------------------------
eq('keepsLogs(engineer)', keepsLogs(eng), true)
eq('keepsLogs(skipper)', keepsLogs(skip), true)
eq('keepsLogs(viewer)', keepsLogs(view), false)
// An engineer opens on his own front page, not the engine-log form: the
// dashboard behind "/" is built from sales and quota, which he cannot read.
eq('homeFor(engineer)', homeFor(eng), '/engine-room')
eq('homeFor(skipper)', homeFor(skip), '/')
eq('isEngineer(null)', isEngineer(null), false)
eq('keepsLogs(null)', keepsLogs(null), false)

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
