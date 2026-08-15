/* Peterhead market layout — the rules, kept apart from the allocator.
 *
 * Fish are displayed for auction in TIERS. A tier is two rows back to back
 * with a walkway between them: 21 box footprints on the top row, 26 on the
 * bottom, 47 in all. Tiers themselves are back to back with a walkway every
 * second tier.
 *
 *   flat        47 boxes per tier
 *   2 high      94
 *   3 high     141
 *   4 high     188
 *
 * A stack is one species AND one grade, and may hold more than one day tag if
 * it would otherwise stand part-full. Different fish stack to different
 * heights — the whole point of the layout is that the valuable stuff is low
 * enough to be seen and handled.
 *
 * HEIGHTS ARE A CEILING, NOT A TARGET. A grade may always be laid lower than
 * its maximum — high-value fish is favoured low — but never higher.
 *
 * EVERYTHING BELOW IS A DEFAULT, NOT A LAW. The market moves species between
 * clocks and changes how high things may go; when it does, that is a settings
 * edit on the Market Rules page and not a code change. `resolveRules()` takes
 * whatever is stored for a fleet and falls back to these.
 */

export const TOP_ROW = 21
export const BOTTOM_ROW = 26
export const PER_TIER_FLAT = TOP_ROW + BOTTOM_ROW      // 47
export const PER_TIER_AT_2 = PER_TIER_FLAT * 2         // 94 — the estimate's basis

/* David's rule of thumb for asking the market for space.
 *
 *   total / 94, rounded up; and if the remainder is over .7, or it lands
 *   exactly on a whole number, add one more tier.
 *
 * Deliberately generous — it is better to be given a tier too many than to
 * run out with fish still on the pallet. Kept because it is what gets asked
 * for on the phone; the allocator works out the real figure separately and
 * the page shows both.
 */
export function tiersByRuleOfThumb(boxes) {
  if (!boxes) return 0
  const raw = boxes / PER_TIER_AT_2
  const whole = Math.ceil(raw)
  const frac = raw - Math.floor(raw)
  return frac === 0 || frac > 0.7 ? whole + 1 : whole
}

/* THE CLOCKS. Fish on one clock is kept together on the market so the buyers
 * for it can walk it in one go.
 *
 * `splitRows` says whether that clock may be broken across the top and bottom
 * rows to use up space the others leave behind. Only the flats may — a buyer
 * should not be looking in two places for the same round fish.
 *
 * Names are the market's own, off the supply catalogue. */
export const DEFAULT_CLOCKS = [
  { id: 'cod', n: 1, label: 'Cod', splitRows: false },
  { id: 'hadwhit', n: 2, label: 'Haddock & Whiting', splitRows: false },
  { id: 'rough', n: 3, label: 'Rough', splitRows: false },
  { id: 'flats', n: 4, label: 'Flats', splitRows: true },
]

/* Which clock each species goes to.
 *
 * TAKEN FROM THE MARKET'S OWN SUPPLY CATALOGUE, 13-08-2026 — one report per
 * clock, so this is what Peterhead actually did rather than what we assumed.
 * The catalogue uses FAO codes; the tally uses the boat's names.
 *
 *   Cod       COD
 *   Had/Whg   HAD · WHG
 *   Rough     ANF monks · CAT · LIN ling · POK saithe/black · POL lythe
 *   Flats     HAL halibut · HKE hake · LEM lemons · LEZ megrim · PLE plaice
 *             TUR turbot · WIT witch
 *
 * Squid, skate, brill and tusk are not in that catalogue because they were not
 * landed that day, not because they have no clock. They are placed here on the
 * obvious reading and are worth confirming the next time one is landed. */
export const DEFAULT_SPECIES_CLOCK = {
  COD: 'cod', 'COD ROE': 'cod',
  HADDOCK: 'hadwhit', 'HADDOCK ROE': 'hadwhit', WHITING: 'hadwhit',
  BLACK: 'rough', MONKS: 'rough', LING: 'rough', LYTHE: 'rough', CAT: 'rough',
  SQUID: 'rough', OTHER: 'rough', TUSK: 'rough',
  HAKE: 'flats', PLAICE: 'flats', LEMONS: 'flats', MEGS: 'flats',
  HALIBUT: 'flats', TURBOT: 'flats', WITCH: 'flats', BRILL: 'flats', SKATE: 'flats',
}

/* The size band off the tally's own grade label: "Sel (3)" → 3,
 * "Large (U9a)" → 'U9', "Cod (1c)" → 1. Null when the label carries no code. */
export function gradeBand(grade) {
  const m = /\(\s*(U9|\d)/i.exec(String(grade || ''))
  if (!m) return null
  return /^u9$/i.test(m[1]) ? 'U9' : Number(m[1])
}

/* Maximum stack height, per species and SIZE BAND.
 *
 * The band is the tally's own code digit, which is how the market grades the
 * box, so this is a grid a skipper can read and change rather than a pile of
 * name-matching rules. `*` is the species default for a grade with no code.
 *
 * Confirmed with David Aug 2026, including the three edges that were not
 * obvious from the rules as written: Sprag is 1 high (it sits inside "medium
 * cod to XL cod"), BLACK XX Sma is 4 high like the rest of the small black,
 * and the roes lie flat.
 */
export const DEFAULT_HEIGHTS = {
  COD:     { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, U9: 2, '*': 2 },
  HADDOCK: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4, U9: 2, '*': 2 },
  BLACK:   { 1: 2, 2: 2, 3: 3, 4: 4, 5: 4, U9: 2, '*': 2 },
  WHITING: { 1: 2, 2: 2, 3: 4, 4: 4, 5: 4, U9: 2, '*': 2 },
  CAT:     { '*': 2 },
  OTHER:   { '*': 2 },
  TUSK:    { '*': 2 },
  SQUID:   { '*': 1 },
  // The roes lie flat, and so do the big round fish and every flat fish —
  // they are handled singly and the box is not made to take another on top.
  'COD ROE': { '*': 1 }, 'HADDOCK ROE': { '*': 1 },
  MONKS: { '*': 1 }, LING: { '*': 1 }, LYTHE: { '*': 1 },
  HAKE: { '*': 1 }, PLAICE: { '*': 1 }, LEMONS: { '*': 1 }, MEGS: { '*': 1 },
  HALIBUT: { '*': 1 }, TURBOT: { '*': 1 }, WITCH: { '*': 1 },
  BRILL: { '*': 1 }, SKATE: { '*': 1 },
}

// A species nobody has filed yet. Two high is the common case and is the safe
// direction to be wrong in — too low costs a tier, too high damages fish.
export const FALLBACK_HEIGHT = 2

/* What the fish actually makes, £/kg.
 *
 * MEASURED, NOT GUESSED — Audacious's own sales notes across every UK landing
 * on record. Used for one thing only: deciding which fish gets laid lower when
 * there is spare room on the market.
 *
 * PER GRADE, NOT PER SPECIES. A species average gets this badly wrong, because
 * the spread inside a species is far wider than the gap between species:
 *
 *     haddock  1 → £4.91   2 → £4.07   3 → £3.20   4 → £1.65
 *     black    1 → £2.27   2 → £2.53   3 → £2.16   4 → £1.79
 *
 * On the averages (haddock £2.02, black £2.05) black wins everything. In fact
 * the big haddock beats every grade of black by a street and only the M Metro
 * falls below it — which is David's correction, and the data agrees with him.
 *
 * The sales note's A-grades are used as the price for each band because they
 * are the same ladder measured on the same fish. Note this is NOT the same
 * split as the A4 haddock sub-grades in the estimator (mini/chipper/metro all
 * come off one A4 line on the note); the market grades the box, the note
 * grades the fish.
 *
 * Only grades that stack matter — everything already flat never competes for
 * the spare room — so the flats and the big round fish carry a species figure
 * and nothing finer. */
export const GRADE_VALUE = {
  COD:     { 1: 6.11, 2: 6.37, 3: 5.77, 4: 4.97, 5: 3.97, U9: 3.88 },
  HADDOCK: { 1: 4.91, 2: 4.07, 3: 3.20, 4: 1.65, U9: 0.49 },
  BLACK:   { 1: 2.27, 2: 2.53, 3: 2.16, 4: 1.79, U9: 0.77 },
  WHITING: { 1: 3.68, 2: 2.21, 3: 1.69, 4: 1.59, U9: 1.59 },
  CAT:     { U9: 2.76 },
  OTHER:   { U9: 1.24 },
}

// Everything below lies flat already, so these never decide a drop. Kept so a
// value can always be quoted.
export const SPECIES_VALUE = {
  TURBOT: 15.69, HALIBUT: 12.05, BRILL: 9.42, LEMONS: 6.20, COD: 5.94,
  LYTHE: 5.42, HAKE: 5.08, MONKS: 4.95, CAT: 2.76, MEGS: 2.64, SQUID: 2.59,
  LING: 2.51, PLAICE: 2.45, BLACK: 2.05, HADDOCK: 2.02, WHITING: 1.72,
  SKATE: 1.59, OTHER: 1.24, TUSK: 1.24, WITCH: 0.93,
}

export const DEFAULT_RULES = {
  clocks: DEFAULT_CLOCKS,
  speciesClock: DEFAULT_SPECIES_CLOCK,
  heights: DEFAULT_HEIGHTS,
}

const up = (s) => String(s || '').toUpperCase().trim()

/* Take whatever is stored for a fleet and hand back something the allocator
 * can ask questions of. Anything missing falls back to the defaults above, so
 * a fleet that has never opened the settings page behaves exactly as before
 * and a fleet that has changed one clock keeps the rest. */
export function resolveRules(settings) {
  const clocks = (settings?.clocks?.length ? settings.clocks : DEFAULT_CLOCKS)
    .map((c, i) => ({ ...c, n: c.n ?? i + 1 }))
    .sort((a, b) => a.n - b.n)
  const speciesClock = { ...DEFAULT_SPECIES_CLOCK, ...(settings?.speciesClock || {}) }
  const heights = { ...DEFAULT_HEIGHTS, ...(settings?.heights || {}) }
  // An odd round fish belongs on Rough — that is what the clock is for, and
  // "whichever clock happens to be last" is not a rule. Only if there is no
  // Rough does it fall to the end of the list.
  const fallbackClock = settings?.fallbackClock
    || (clocks.find((c) => c.id === 'rough') ? 'rough' : clocks[clocks.length - 1]?.id)

  return {
    clocks,
    speciesClock,
    heights,
    fallbackClock,

    // An unfiled species still gets onto the market. It lands on the last
    // clock and is named in the plan's warnings, because a fish quietly put on
    // the wrong clock is worse than one the skipper was told about.
    clockFor(species) {
      return speciesClock[up(species)] || fallbackClock
    },
    isFiled(species) {
      return !!speciesClock[up(species)]
    },
    clock(id) {
      return clocks.find((c) => c.id === id) || null
    },
    canSplitRows(clockId) {
      return !!clocks.find((c) => c.id === clockId)?.splitRows
    },

    maxHeight(species, grade) {
      const row = heights[up(species)]
      if (!row) return FALLBACK_HEIGHT
      const band = gradeBand(grade)
      const h = (band != null ? row[band] : undefined) ?? row['*']
      return Number.isFinite(Number(h)) && Number(h) >= 1 ? Number(h) : FALLBACK_HEIGHT
    },

    /* £/kg for a species and grade. Falls back species-wide, then to mid-table
     * — being wrong about an unlisted fish should cost a little, not a lot. */
    valueOf(species, grade) {
      const s = up(species)
      const band = gradeBand(grade)
      const ladder = GRADE_VALUE[s]
      if (ladder && band != null && ladder[band] != null) return ladder[band]
      return SPECIES_VALUE[s] ?? 2.5
    },
  }
}

// The defaults, resolved once, for callers with nothing stored.
export const RULES = resolveRules(null)

/* Thin wrappers so the rest of the app and the tests can ask a question
 * without building a rules object first. */
export const AUCTIONS = DEFAULT_CLOCKS
export const auctionFor = (species) => RULES.clockFor(species)
export const canSplitBands = (clockId) => RULES.canSplitRows(clockId)
export const maxHeight = (species, grade) => RULES.maxHeight(species, grade)
export const valueOf = (species, grade) => RULES.valueOf(species, grade)

/* Prime is anything already laid flat, plus the top of a stacking species —
 * used only to order a species' own grades when they go down. */
export function isPrime(species, grade) {
  const g = up(grade)
  return RULES.maxHeight(species, grade) === 1 || /^(XL|X LRG|LARGE|CHAT|GOOD SEED|PINGER)/.test(g)
}

/* Every species the rules know about, for the settings page. */
export const knownSpecies = (rules = RULES) =>
  [...new Set([...Object.keys(rules.speciesClock), ...Object.keys(rules.heights)])].sort()

export const BANDS = [1, 2, 3, 4, 5, 'U9']
