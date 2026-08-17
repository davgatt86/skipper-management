/* Who the morning digest may tell what.
 *
 * This is a SECURITY BOUNDARY, not a preference. An officer is denied every
 * money table at the database — contracts, payments, bonuses — and that denial
 * is the whole reason the role exists rather than handing out a skipper login.
 * But a crew_bonus alert carries the figures in its body:
 *
 *   "Eugene Tano — going-home bonus due now. Bonus 4500.00, paid so far
 *    2250.00, still to pay 2250.00."
 *
 * The digest was rendering ONE email per fleet and posting it to everybody, so
 * that went to the engineer every morning. RLS cannot catch it: the digest runs
 * on the service-role key by necessity, so the filter has to be written down.
 */
import { DIGEST_TYPES, MONEY_TYPES, TYPES_FOR_ROLE, typesFor } from './netlify/functions/alert-digest.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// The bug, asserted directly.
for (const role of ['officer', 'engineer']) {
  eq(`an ${role} is NEVER sent a bonus figure`, typesFor(role).includes('crew_bonus'), false)
}
eq('the skipper is, because it is his to pay', typesFor('skipper').includes('crew_bonus'), true)
eq('and so is the office, because it is their job', typesFor('office').includes('crew_bonus'), true)

// An officer must still get everything he CAN act on — the whole point of
// mailing him at all is that the engine log going quiet is his to fix.
for (const t of ['log_engine', 'log_fuel', 'log_garbage', 'log_crewlist', 'maint_due']) {
  eq(`an officer still gets ${t}`, typesFor('officer').includes(t), true)
}
for (const t of ['crew_passport', 'crew_cert', 'vessel_cert']) {
  eq(`and still gets ${t}`, typesFor('officer').includes(t), true)
}

// The crew answer: expiries reach the skipper.
for (const t of ['crew_passport', 'crew_cert', 'vessel_cert']) {
  eq(`the skipper gets ${t}`, typesFor('skipper').includes(t), true)
}
eq('the skipper gets every digest type', typesFor('skipper'), DIGEST_TYPES)

// A role nobody has listed gets NOTHING, rather than everything. Same
// direction of failure as the nav guards and the alert streams.
eq('an unlisted role is sent nothing', typesFor('crew'), [])
eq('and so is a missing one', [typesFor(undefined), typesFor(null)], [[], []])

// The money list must actually be a subset of what is sent at all, or the
// filter is quietly doing nothing.
eq('every money type is a real digest type',
  MONEY_TYPES.every((t) => DIGEST_TYPES.includes(t)), true)
eq('and removing them changes the officer list',
  typesFor('officer').length, DIGEST_TYPES.length - MONEY_TYPES.length)

// Every role that receives mail must have a list, or it silently gets nothing.
for (const role of Object.keys(TYPES_FOR_ROLE)) {
  eq(`${role} has a non-empty list`, typesFor(role).length > 0, true)
}

// The filter as the send loop applies it.
const fleetAlerts = [
  { type: 'crew_bonus', severity: 'warn', title: 'Bonus 4500.00 due' },
  { type: 'log_engine', severity: 'warn', title: 'Engine log 6 days quiet' },
  { type: 'vessel_cert', severity: 'warn', title: 'Liferaft service expired' },
]
const forRole = (r) => fleetAlerts.filter((a) => typesFor(r).includes(a.type))
eq('the engineer’s email has the engine log and the certificate',
  forRole('engineer').map((a) => a.type), ['log_engine', 'vessel_cert'])
eq('and no money in it at all',
  forRole('engineer').some((a) => /\d{3,}\.\d\d/.test(a.title)), false)
eq('the skipper’s email has all three', forRole('skipper').length, 3)
eq('a crew login is sent nothing and so gets no email', forRole('crew').length, 0)

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
