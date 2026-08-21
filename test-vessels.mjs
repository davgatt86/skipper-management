/* Which boat am I looking at.
 *
 * The rule this file mostly exists to pin down: THE STORED CHOICE IS VALIDATED
 * AGAINST THIS FLEET'S BOATS. A stale id — from another account, or a boat
 * since retired — would filter every query to a vessel that is not there. RLS
 * returns nothing for it, so the page comes up EMPTY rather than wrong, which
 * is the worst way for this to fail: it looks like a boat with no data instead
 * of a bad setting.
 */
import {
  resolveCurrent, scopeRows, scopeQuery, storageKey, vesselName, showingLabel,
  pickDetails, needsVesselChoice,
} from './src/lib/vessels.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const A = { id: 'v1', label: 'BOY JOHN INS110', active: true }
const B = { id: 'v2', label: 'ROSEBLOOM INS353', active: true }
const RETIRED = { id: 'v3', label: 'OLD BOAT PD1', active: false }
const SOLO = { id: 'v9', label: 'AUDACIOUS BF83', active: true }

// ---- one boat: no choice to offer ------------------------------------------
/* A single-vessel tenant never sees a picker — that is the documented rule from
 * the pair-teams work, and it is why `current` is the boat rather than null. A
 * page can then filter unconditionally. */
{
  const s = resolveCurrent([SOLO], null)
  eq('one boat is the current one', s.current.id, 'v9')
  eq('and there is nothing to pick', s.multi, false)
  eq('showing that boat', s.showing, 'one')
  // Even a stored id is irrelevant: there is only one answer.
  eq('a stored id changes nothing', resolveCurrent([SOLO], 'v1').current.id, 'v9')
}

// ---- no boats at all --------------------------------------------------------
/* HANSTHOLM has no `vessels` row: no sales, no quota trips, no vessel_details.
 * The page must not pretend otherwise. */
{
  const s = resolveCurrent([], null)
  eq('no boats means no current one', s.current, null)
  eq('and it says so', s.hasVessels, false)
  eq('showing nothing', s.showing, 'none')
  eq('no picker either', s.multi, false)
  eq('null is handled', resolveCurrent(null, null).hasVessels, false)
  eq('and a fleet of only retired boats', resolveCurrent([RETIRED], null).hasVessels, false)
}

// ---- a pair ----------------------------------------------------------------
/* NULL MEANS ALL, NOT NONE. A pair team's combined view is a real view — sum
 * the gross and the boxes across both boats — so "no vessel chosen" is a
 * deliberate state, not a missing answer. */
{
  const none = resolveCurrent([A, B], null)
  eq('a pair defaults to both', none.current, null)
  eq('which is a state, not a gap', none.showing, 'all')
  eq('and it offers a choice', none.multi, true)
  eq('both boats are on offer', none.vessels.map((v) => v.id), ['v1', 'v2'])

  const one = resolveCurrent([A, B], 'v2')
  eq('a stored choice is honoured', one.current.id, 'v2')
  eq('and shows as one boat', one.showing, 'one')
}

/* THE VALIDATION. Every one of these must fall back to all rather than filter
 * on a boat that is not there. */
{
  eq('an id from another fleet falls back to all',
    resolveCurrent([A, B], 'someone-elses-boat').current, null)
  eq('and says it is showing all',
    resolveCurrent([A, B], 'someone-elses-boat').showing, 'all')
  eq('a retired boat is not selectable',
    resolveCurrent([A, B, RETIRED], 'v3').current, null)
  eq('nor does it appear in the list',
    resolveCurrent([A, B, RETIRED], null).vessels.map((v) => v.id), ['v1', 'v2'])
  eq('an empty stored id is just all', resolveCurrent([A, B], '').current, null)
  eq('and undefined', resolveCurrent([A, B], undefined).current, null)
}

// ---- applying the choice ----------------------------------------------------
{
  const rows = [
    { id: 1, vessel_id: 'v1' },
    { id: 2, vessel_id: 'v2' },
    { id: 3, vessel_id: null },     // HANSTHOLM's rota trips
  ]
  eq('one boat filters to it', scopeRows(rows, A).map((r) => r.id), [1])
  /* ALL APPLIES NOTHING AT ALL, rather than "is null or equals". 5 rows across
   * the database have no vessel_id and never will — HANSTHOLM has no boat to
   * point at — and a page showing all must not lose them. */
  eq('all keeps everything, nulls included', scopeRows(rows, null).map((r) => r.id), [1, 2, 3])
  eq('nothing at all is handled', scopeRows(null, A).length, 0)

  // The query form does the same, and takes the filter harmlessly on a
  // single-vessel fleet — so a page can call it without remembering when.
  let applied = null
  const q = { eq: (col, val) => { applied = [col, val]; return 'filtered' } }
  eq('a boat applies the filter', scopeQuery(q, A), 'filtered')
  eq('on the right column', applied, ['vessel_id', 'v1'])
  applied = null
  eq('all leaves the query alone', scopeQuery(q, null), q)
  eq('and touches nothing', applied, null)
}

// ---- odds and ends ----------------------------------------------------------
/* The key carries the FLEET, so signing into another account does not inherit
 * the last boat picked on this one. */
eq('the key is per fleet', storageKey('abc'), 'sm.currentVessel.abc')
eq('and survives no fleet at all', storageKey(null), 'sm.currentVessel.none')

eq('a boat is named by its label', vesselName(A), 'BOY JOHN INS110')
eq('falling back to its name', vesselName({ name: 'Unlabelled' }), 'Unlabelled')
eq('and nothing is nothing', vesselName(null), '')

eq('showing one boat', showingLabel(resolveCurrent([A, B], 'v1')), 'BOY JOHN INS110')
eq('showing all of them', showingLabel(resolveCurrent([A, B], null)), 'All 2 boats')
eq('showing the only one', showingLabel(resolveCurrent([SOLO], null)), 'AUDACIOUS BF83')
eq('showing none', showingLabel(resolveCurrent([], null)), 'No vessel on record')

// ---- whose particulars ------------------------------------------------------
/* vessel_details is one row per boat since Aug 2026, so every reader has to
 * choose. THERE IS NO SUCH THING AS A PAIR'S PARTICULARS: two boats have two
 * registrations and two tonnages, and picking one to stand for both would put
 * the wrong PLN on a crew list. */
{
  const rows = [
    { vessel_id: 'v1', vessel_name: 'BOY JOHN', pln: 'INS110' },
    { vessel_id: 'v2', vessel_name: 'ROSEBLOOM', pln: 'INS353' },
  ]
  eq('the current boat’s row', pickDetails(rows, A).vessel_name, 'BOY JOHN')
  eq('and the other one', pickDetails(rows, B).vessel_name, 'ROSEBLOOM')
  eq('showing all gives none, not the first', pickDetails(rows, null), null)

  // One row and nothing to choose between is unambiguous whatever the picker
  // happens to say.
  const one = [{ vessel_id: 'v9', vessel_name: 'AUDACIOUS' }]
  eq('a single row is taken', pickDetails(one, null).vessel_name, 'AUDACIOUS')
  eq('and matched when a boat is current', pickDetails(one, SOLO).vessel_name, 'AUDACIOUS')
  // A boat with no particulars row yet is a form to fill in, not a wrong answer.
  eq('a boat with no row yet', pickDetails(rows, SOLO), null)
  eq('no rows at all', pickDetails([], A), null)
  eq('and null', pickDetails(null, A), null)

  /* A REAL choice, never a missing one. A fleet with one boat and no
   * particulars is being asked to fill the form in, not to choose — and those
   * want different words on the page. */
  eq('a pair showing all must choose',
    needsVesselChoice(rows, resolveCurrent([A, B], null)), true)
  eq('a pair with a boat chosen need not',
    needsVesselChoice(rows, resolveCurrent([A, B], 'v1')), false)
  eq('a single-vessel fleet is never asked',
    needsVesselChoice(one, resolveCurrent([SOLO], null)), false)
  eq('nor is a pair whose particulars are not filled in yet',
    needsVesselChoice([], resolveCurrent([A, B], null)), false)
  eq('nor one with only a single row so far',
    needsVesselChoice([rows[0]], resolveCurrent([A, B], null)), false)
}


console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
