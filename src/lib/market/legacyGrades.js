/* JOINING FOUR YEARS OF BOARD PRICES ONTO THE NEW GRADE CODES.
 *
 * Peterhead moved the daily board off the A-ladder and onto the grading
 * table's own codes on 21-10-2026. The record is 41,696 PD rows back to
 * 04-08-2022 and FORTY-FOUR of them are on the new ladder, so a key of
 * `grade + subgrade` does not merely thin out at the changeover — it breaks.
 * Every Peterhead chart, every day-on-day move and every four-week average
 * compares a key that exists on one side of 21 October and not the other.
 *
 * DAVID SETTLED THE MAPPING, species by species (Oct 2026). His own words on
 * haddock, which is the shape of the whole thing:
 *
 *     "A3 haddock is now 2a for example. A2 is 1d. A1 is a blend of 1a, 1b
 *      & 1c. A4 chipper is 2b. A4 metro is 3, A4 mini is 4"
 *
 * So the old ladder is the new one with the grades the board did not print
 * collapsed into one line — at the TOP for haddock, cod, hake, lemons and
 * plaice, and at the BOTTOM for saithe, monks and megrim. Where the two
 * ladders are the same length (ling, lythe) it is one for one.
 *
 * A COLLAPSED LINE IS A BLEND AND IS NEVER PRESENTED AS A GRADE'S OWN PRICE.
 * The old A1 haddock row is one figure covering 1a, 1b and 1c, and on 21-10
 * Metro made 2.49 against Mini Metro's 1.93 — 29% apart. Pretending one old
 * row was either grade's price would overstate one and understate the other,
 * so a blend keeps its own key (1a+1b+1c) and both ladders roll onto it. The
 * series is then continuous and honest about what it is, which is the same
 * discipline `gradeBridge.js` keeps against Hanstholm.
 *
 * WHAT CANNOT BE JOINED IS NAMED, NEVER GUESSED — see `UNBRIDGED`.
 */
import { PD_GRADES } from './gradeBridge.js'

/* Codes the BOARD prints for species the crew grading table gives no coded
 * bands for. The table lists halibut and turbot by weight with no codes
 * against them, and grades squid by LENGTH — but the board prints U9 sizes
 * for all of them, so the codes are real even where the band is not published.
 * Kept apart from `PD_GRADES` for exactly that reason: a band nobody printed
 * must not be invented to make the table look complete. */
export const BOARD_ONLY_CODES = {
  Halibut: ['U9a', 'U9b'],
  Turbot: ['U9a', 'U9b'],
  Tusk: ['U9a', 'U9b'],
  Squid: ['U9a', 'U9b', 'U9c', 'U9d', 'U9e', 'U9f'],
}

/** Every code this species can carry, off the grading table where there is one. */
export function codesOf(species) {
  const g = PD_GRADES[species]
  if (g) return g.map((x) => x[0])
  return BOARD_ONLY_CODES[species] || null
}

/* THE BOARD AND THE GRADING TABLE DISAGREE ON ONE CODE, and it is recorded
 * rather than quietly reconciled. Don's sheet of 21-10 prints megrim's top
 * line as "1a Large"; the crew grading table prints "1 LARGE" and gives
 * megrim no 1b at all. The old A1 was the top megrim grade and so is this,
 * whichever label the two documents use, so they are joined — and
 * `test-legacy-grades.mjs` fails on any code that is neither in the table nor
 * aliased here, so a real 1b appearing later is a test failure and not a
 * silent mis-join. */
export const CODE_ALIAS = {
  Megrim: { '1a': '1' },
}

/* THE BRIDGE. Keyed on the legacy key exactly as the record carries it —
 * `grade` plus `subgrade` where there is one — because haddock's A4 is three
 * different lines and only the subgrade tells them apart. */
export const LEGACY_BRIDGE = {
  Brill: { U9: ['U9a', 'U9b'] },
  Catfish: { 'U9 Scottish': ['U9a', 'U9b'] },
  Cod: {
    'A1 Large': ['1a', '1b', '1c'],
    'A2 Sprags': ['2'],
    'A3 Medium': ['3'],
    'A4 Selected': ['4'],
    'A5 Small': ['5a', '5b'],
  },
  Haddock: {
    'A1 Lge/Med': ['1a', '1b', '1c'],
    'A2 Selected': ['1d'],
    'A3 Seed': ['2a'],
    'A4 Chipper': ['2b'],
    'A4 Metro': ['3'],
  },
  Hake: { A1: ['1a', '1b', '1c'], A2: ['2'], A3: ['3'], A4: ['4'], A5: ['5'] },
  Halibut: { U9: ['U9a', 'U9b'] },
  Lemon: { A1: ['1a', '1b'], A2: ['2'], A3: ['3a', '3b'] },
  Ling: { A1: ['1'], A2: ['2'], A3: ['3'] },
  Megrim: { A1: ['1'], A2: ['2'], A3: ['3'], A4: ['4a', '4b'] },
  Monkfish: { A1: ['1'], A2: ['2'], A3: ['3'], A4: ['4'], A5: ['5a', '5b'] },
  Plaice: { A1: ['1a', '1b'], A2: ['2'], A3: ['3'], A4: ['4'] },
  Pollack: { A1: ['1'], A2: ['2'], A3: ['3'], A4: ['4'] },
  Saithe: { A1: ['1'], A2: ['2'], A3: ['3'], A4: ['4a', '4b', '4c'] },
  Skate: { A3: ['3'] },
  Turbot: { U9: ['U9a', 'U9b'] },
  Tusk: { U9: ['U9a', 'U9b'] },
  Witch: { U9: ['U9a', 'U9b'] },
}

const WHITING = 'Whiting is not joined. The old board ran A1, A2, A3, A4 and A4 Round; '
  + 'the grading table runs 1a Large, 1b Med, 2 Small, 3 Round, 4 S Round — and the '
  + 'board of 21-10 names code 1b "Large" and code 2 "Medium", a step bigger than the '
  + 'table does. A1 also stopped in Aug 2025 while A2 carried on, so which line is the '
  + 'top grade changes partway through the history. Several readings fit and the record '
  + 'cannot choose between them, so it is a question for the skipper rather than a guess.'

/* WHAT IS NOT JOINED, AND WHY. A gap that says so is worth more than a series
 * joined onto the wrong grade, because a wrong join looks exactly like a real
 * price move. Measured, not estimated: 4,074 rows of the 39,774 graded PD rows
 * are here — 10.2%, and 35,700 join. */
export const UNBRIDGED = {
  'Haddock|A3': 'One row, 04-08-2026, with no subgrade on it. The named A3 Seed line '
    + 'is joined; this one cannot be told from it.',
  'Haddock|A4': '145 rows, Sep 2024 to Oct 2026, carrying no subgrade — and a bare A4 '
    + 'shares a day with a NAMED A4 on 82 of those days, so it is not simply the only '
    + 'A4 line. Which of Chipper, Metro or Round each one is cannot be read back.',
  'Haddock|A4 Round': 'The haddock grading table has eight codes and not one of them is '
    + 'Round, so there is nothing on the new ladder to join 754 rows of it to.',
  'Megrim|B4': 'The old board ran a B-ladder as well as an A-ladder — second-quality '
    + 'fish. 167 rows of megrim B4, Aug 2022 to May 2026, averaging 1.21 against the '
    + 'A-grades. The grading table has no B code at all, so there is nothing to join it '
    + 'to; it keeps its own key and its own series, which ends in May 2026.',
  'Whiting|A1': WHITING,
  'Whiting|A2': WHITING,
  'Whiting|A3': WHITING,
  'Whiting|A4': WHITING,
  'Whiting|A4 Round': WHITING,
}

/* THE B-LADDER COUNTS AS LEGACY, and leaving it out was a real fault. The old
 * board graded second-quality fish B1-B9 beside the A-ladder, and megrim B4
 * alone is 167 rows. Matched on A ONLY, `B4` fell through as though it were a
 * grading-table code, so a species that HAS a bridge reported it `newOnly` —
 * a 2022 grade described as one the old board never printed. Found by
 * censusing the real record rather than by reading the regex. */
const LEGACY = /^([AB][0-9]|U9)$/

/** The record's own key for a row: grade, plus subgrade where there is one. */
export const legacyKeyOf = (grade, subgrade) =>
  [String(grade ?? '').trim(), String(subgrade ?? '').trim()].filter(Boolean).join(' ')

/** Is this an A-ladder (or bare U9) grade rather than a grading-table code? */
export const isLegacyGrade = (grade) => LEGACY.test(String(grade ?? '').trim())

/** A board code with this species' alias applied. */
export function codeOf(species, grade) {
  const t = String(grade ?? '').trim()
  const a = CODE_ALIAS[species]
  return a && a[t] ? a[t] : t
}

/** The new codes one legacy line covered, or null if it is not joined. */
export function codesForLegacy(species, key) {
  const m = LEGACY_BRIDGE[species]
  return (m && m[key]) || null
}

/** The legacy line a new code's history comes from, with every code it covered. */
export function legacyForCode(species, code) {
  const m = LEGACY_BRIDGE[species]
  if (!m) return null
  const c = codeOf(species, code)
  for (const [key, codes] of Object.entries(m)) if (codes.includes(c)) return { key, codes }
  return null
}

/**
 * THE ONE KEY A PRICE SERIES USES, so four years joins onto the new ladder.
 *
 * Both ladders land on the same string: the new codes the line covers, joined
 * with a plus. A line-for-line pair is just the code — "A3 Seed" and "2a" are
 * both "2a" — and a collapsed line is the group, so "A1 Lge/Med", "1a", "1b"
 * and "1c" are all "1a+1b+1c", which says in the key itself that the figure
 * before the changeover is a blend of three grades.
 *
 * NULL means this row cannot be joined — see `UNBRIDGED`. Null and a key must
 * never be conflated: dropping these rows silently would take 9.4% of the
 * Peterhead record out of every chart with nothing to say it had gone.
 *
 * DENMARK GRADES A0-A9 AND IS NOT TOUCHED. U9 is on both boards, so a bridge
 * that ignored the source would read Danish witch as Peterhead witch. The
 * caller passes the row's own source; only PD is bridged.
 */
export function seriesKey(row) {
  if (!row) return null
  const { source, species } = row
  const g = String(row.grade ?? '').trim()
  if (source != null && source !== 'PD') return legacyKeyOf(row.grade, row.subgrade) || null
  if (!g) return null
  if (isLegacyGrade(g)) {
    const codes = codesForLegacy(species, legacyKeyOf(g, row.subgrade))
    return codes ? codes.join('+') : null
  }
  const hit = legacyForCode(species, g)
  return hit ? hit.codes.join('+') : codeOf(species, g)
}

/**
 * How good that join is, which decides how a figure may be quoted.
 *
 *   exact      one old line, one new code. The series is continuous.
 *   group      one old line covered several codes. Before 21-10-2026 the
 *              figure is a blend of them — fair against the group, never
 *              against one grade.
 *   newOnly    a code the old board never printed. Haddock Mini Metro is the
 *              one that matters: Peterhead printed ONE Metro row and the boat
 *              graded two off it, so code 4's board history starts 21-10.
 *   unbridged  no join, with a reason.
 */
export function seriesFit(row) {
  if (!row) return 'unbridged'
  const { source, species } = row
  if (source != null && source !== 'PD') return 'exact'
  const g = String(row.grade ?? '').trim()
  if (!g) return 'unbridged'
  if (isLegacyGrade(g)) {
    const codes = codesForLegacy(species, legacyKeyOf(g, row.subgrade))
    if (!codes) return 'unbridged'
    return codes.length > 1 ? 'group' : 'exact'
  }
  const hit = legacyForCode(species, g)
  if (!hit) return LEGACY_BRIDGE[species] ? 'newOnly' : 'unbridged'
  return hit.codes.length > 1 ? 'group' : 'exact'
}

/**
 * THE SAME QUESTION, BUT ONLY WHERE IT IS ACTUALLY BEING ASKED.
 *
 * `seriesFit` describes the line. This describes the COMPARISON, and they are
 * not the same: haddock A1 is a blend of three new codes whether or not
 * anybody is looking across the change, so a page that warned on `seriesFit`
 * alone told a skipper reading a September board — every line of it on the old
 * ladder, nothing crossed — that his figures "compare against the old board".
 * Noise, on the card that already refuses to repeat itself, and it would have
 * trained him past the warning before the one that mattered arrived.
 *
 * A comparison crosses only when the line being shown is on the NEW ladder and
 * the history behind it is on the old one. Caught by rendering the page; the
 * unit checks on `seriesFit` were all perfectly happy.
 */
export function fitAcross(row, history = []) {
  if (!row) return 'exact'
  const g = String(row.grade ?? '').trim()
  if (!g || isLegacyGrade(g)) return 'exact'
  const crossed = history.some((r) => r && isLegacyGrade(r.grade)
    && String(r.price_date) < String(row.price_date))
  return crossed ? seriesFit(row) : 'exact'
}

/** Why a row is not joined, in words a skipper can read. */
export const unbridgedReason = (species, grade, subgrade) =>
  UNBRIDGED[`${species}|${legacyKeyOf(grade, subgrade)}`] || null

/**
 * Codes of a joined species that no legacy line covered, so their board
 * history begins at the changeover. Derived rather than listed — a code added
 * to the grading table shows up here without anyone remembering to.
 */
export function codesWithNoHistory(species) {
  const m = LEGACY_BRIDGE[species]
  const codes = codesOf(species)
  if (!m || !codes) return []
  const covered = new Set(Object.values(m).flat())
  return codes.filter((c) => !covered.has(c))
}

/** Every species the bridge covers, for the report and the test. */
export const bridgedSpecies = () => Object.keys(LEGACY_BRIDGE).sort()
