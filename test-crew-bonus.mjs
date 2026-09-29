/* The going-home bonus: which half is owed, and when.
 *
 * Written against the boat's REAL contracts as at 29-09-2026, because the
 * complaint that started this was a real alert chasing real money at the wrong
 * time — Elizer Tano's second half, £3,500, reported as due in September when it
 * is not payable until he comes back.
 *
 * The database has the same rule in `bonus_halves_due()`, since the alerts are
 * raised there. These checks pin the JS half; the SQL half is probed against the
 * same contracts (see supabase/bonus_alerts_follow_the_return.sql).
 */
import { bonusState, bonusHalves, firstHalfFraction, halfLabel } from './src/lib/crew/bonus.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else { fail++; console.log(`  FAIL ${label}\n    got  ${g}\n    want ${w}`) }
}
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${label}`) } }

const SETTINGS = { ghb_first_half_pct: 0.5, currency: 'GBP' }
const states = (c, paid = {}, s = SETTINGS) => {
  const st = bonusState(c, paid, s)
  return st && [st.first.state, st.second.state]
}

// ---- THE HALVES ------------------------------------------------------------
eq('half and half of £7,000', bonusHalves(7000, SETTINGS), { total: 7000, first: 3500, second: 3500 })
eq('the second half takes the rounding, so the two always make the total',
   bonusHalves(1000.01, SETTINGS), { total: 1000.01, first: 500.01, second: 500 })
eq('a percentage stored as 60 means 60%', bonusHalves(1000, { ghb_first_half_pct: 60 }), { total: 1000, first: 600, second: 400 })
eq('and stored as 0.6 means the same', bonusHalves(1000, { ghb_first_half_pct: 0.6 }), { total: 1000, first: 600, second: 400 })
eq('no settings row falls back to half', firstHalfFraction(null), 0.5)

// ---- THE REAL CONTRACTS ----------------------------------------------------
/* ELIZER TANO — the case David reported. Went home 27-08-2026, first half paid
   that day, not back yet. The second half is NOT due, and the alert that said it
   was is what kept arriving. */
const elizer = { going_home_bonus: 7000, status: 'pending_return', end_date: '2026-08-27', return_date: null }
eq('Elizer: first half paid, second not due until he returns', states(elizer, { first: true }), ['paid', 'on_return'])
eq('so nothing is owed today', bonusState(elizer, { first: true }, SETTINGS).dueNow, 0)
eq('and the row says "on return", not "due"', halfLabel(states(elizer, { first: true })[1]), 'on return')

/* The same man once he is back: marked returned, so the second half falls due. */
const elizerBack = { ...elizer, status: 'completed', return_date: '2026-11-01' }
eq('once he is marked returned it is due', states(elizerBack, { first: true }), ['paid', 'due'])
eq('and that is £3,500', bonusState(elizerBack, { first: true }, SETTINGS).dueNow, 3500)

/* THE MAN WHO IS NOT COMING BACK. £4,000, first half £2,000 paid, he decided not
   to return: forfeited outright, David's word. */
const notReturning = { going_home_bonus: 4000, status: 'not_returning', end_date: '2026-03-02', return_date: null, not_returning_on: '2026-09-29' }
eq('not returning: the second half is forfeited', states(notReturning, { first: true }), ['paid', 'forfeited'])
eq('nothing is owed', bonusState(notReturning, { first: true }, SETTINGS).dueNow, 0)
eq('and the £2,000 is reported as forfeited rather than vanishing',
   bonusState(notReturning, { first: true }, SETTINGS).forfeited, 2000)
eq('"forfeited" never reads like "on return" — one is money to come, the other is money that never will',
   [halfLabel('forfeited'), halfLabel('on_return')],
   ['forfeited — did not return', 'on return'])
/* His FIRST half is still owed if it was never paid: he went home, and that is
   what the first half is for. */
eq('an unpaid first half on that contract is still due', states(notReturning, {}), ['due', 'forfeited'])

/* A contract still running: nothing is due yet and the first half is not "due",
   which is what stops the alert firing while a man is still aboard. */
const current = { going_home_bonus: 6000, status: 'current', end_date: null, return_date: null }
eq('a current contract owes nothing yet', states(current, {}), ['at_end', 'on_return'])
eq('and reads as due on going home', halfLabel('at_end'), 'on going home')

/* Fully paid — the state the alert resolver keys off. */
const donePaid = { going_home_bonus: 4500, status: 'completed', end_date: '2026-03-02', return_date: '2026-09-24' }
eq('both halves paid', states(donePaid, { first: true, second: true }), ['paid', 'paid'])
eq('nothing to chase', bonusState(donePaid, { first: true, second: true }, SETTINGS).dueNow, 0)

/* Gone home with NEITHER half paid — first due, second waiting. John Gabriel
   Binggan's shape, except his first half is paid. */
eq('gone home, nothing paid', states({ ...elizer, going_home_bonus: 4500 }, {}), ['due', 'on_return'])

// ---- NOT SET IS NOT NOUGHT ------------------------------------------------
ok('a contract with no bonus set has no state at all, rather than a bonus of zero',
   bonusState({ going_home_bonus: null, status: 'pending_return' }, {}, SETTINGS) === null)
ok('and an empty string is the same', bonusState({ going_home_bonus: '', status: 'completed' }, {}, SETTINGS) === null)
ok('a bonus of nought is a real figure and does have a state',
   bonusState({ going_home_bonus: 0, status: 'completed', return_date: '2026-01-01' }, {}, SETTINGS)?.total === 0)

// ---- RETURNED WITH NO DATE ------------------------------------------------
/* `completed` always carries a return date from the page, but a row imported
   without one must not read as "he is back" — the date is what says so. */
eq('completed with no return date is still waiting on him', states({ ...elizer, status: 'completed' }, { first: true }), ['paid', 'on_return'])

console.log(`crew bonus: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
