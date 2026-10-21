/* VALUING A TALLY WHEN THE BOARD CARRIES THE BOAT'S OWN GRADE CODE.
 *
 * Peterhead moved the daily board onto the grading table's codes on
 * 21-10-2026 — the same codes the day tally has always printed. Before that
 * the board was coarser than the boat's grading, so `Estimator.jsx` mapped
 * each tally grade onto a coarse board grade (`"2B" -> A4c`, `"3" -> A4m`) and
 * nudged which COLUMN to read to make up the difference. Where the board now
 * carries the grade, it is the grade, and none of that is needed.
 *
 * Lives here rather than in the page so it can be run against the real board:
 * `Estimator.jsx` is 1,000 lines behind a login and a file picker, and a build
 * passing says nothing about whether a price is found.
 */

/** The board's spelling of a tally grade code: digit + LOWERCASE size letter,
 *  `U9` keeping its upper case. `gradeCode()` upper-cases what it reads off
 *  the tally, so "Chipper (2b)" arrives as "2B" and has to be put back.
 *  Anything that is not a grade code at all returns null. */
export function boardCode(c) {
  const t = String(c || '').trim()
  if (/^u9[a-f]$/i.test(t)) return 'U9' + t.slice(2).toLowerCase()
  if (/^[0-9][a-f]$/i.test(t)) return t[0] + t[1].toLowerCase()
  if (/^[0-9]$/.test(t)) return t
  return null
}

/** A board key that is a grade code, with or without the loader's " (high)". */
export const CODE_KEY = /^(?:[0-9][a-f]?|U9[a-f])(?: \(high\))?$/

/* IS THIS SPECIES' BOARD ON THE NEW CODES?
 *
 * Read off the KEYS, never off the date. An old sheet re-uploaded today must
 * still read as old, and the two ladders will sit side by side in the record
 * for as long as the history does. */
export const onCodes = (obj) => Object.keys(obj || {}).some((k) => CODE_KEY.test(k))

/* THE GRADING TABLE'S CODES, BIGGEST FISH FIRST.
 *
 * A grade that did not sell steps to its NEIGHBOUR. Without a ladder it would
 * fall through to "any priced grade in this species" — on 21-10 that would
 * have valued haddock Metro at the first haddock price found, XL at £5.74
 * against its real £2.49. The same over-valuing the A4 family guard in the
 * page was written to stop.
 *
 * No species on the grading table mixes a bare digit with a lettered one at
 * the same number, so ordering by digit then letter is the real size order
 * for every one of them. */
export const CODE_LADDER = [
  '1', '1a', '1b', '1c', '1d',
  '2', '2a', '2b', '2c',
  '3', '3a', '3b',
  '4', '4a', '4b', '4c',
  '5', '5a', '5b',
  'U9', 'U9a', 'U9b', 'U9c', 'U9d', 'U9e', 'U9f',
]
