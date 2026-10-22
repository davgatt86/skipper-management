/* PETERHEAD GRADES vs HANSTHOLM SORTS — which lines are the same fish.
 *
 * David, Oct 2026: *"check pd grading table and hanstholm sorts (grades) and
 * look for similarities for comparing price market vs market."*
 *
 * Comparing a Peterhead price with a Hanstholm price only means something when
 * the two are the SAME SIZE OF FISH. Both markets grade by weight and publish
 * the bands, so this is measurable rather than a matter of opinion — and the
 * answer is better than expected: on several species the two markets cut at
 * exactly the same kilos.
 *
 * Transcribed from the two documents themselves, not from memory:
 *   PETERHEAD  "Peterhead Grading Table (crew)", 4 sheets
 *   HANSTHOLM  hanstholmfiskeauktion.dk/Sorts, read 21-10-2026
 *
 * A BAND IS [from, to) IN KILOS, `to: null` meaning open-ended at the top.
 * Peterhead writes "12 + kg" and Hanstholm "12+ KG" for the same thing.
 */

/* Peterhead, keyed by the grade CODE the board and the boat's day tally both
 * now print. The name is the grading table's own word for it, and is a guide:
 * the board says so in as many words. */
export const PD_GRADES = {
  Cod: [
    ['1a', 'XL', 12, null], ['1b', 'Large', 10, 12], ['1c', 'Cod', 7, 10], ['2', 'Sprag', 4, 7],
    ['3', 'Medium', 2, 4], ['4', 'Big Baby', 1, 2], ['5a', 'Baby', 0.6, 1], ['5b', 'Robbie', 0.3, 0.6],
  ],
  Haddock: [
    ['1a', 'XL', 2.5, null], ['1b', 'Chat', 2, 2.5], ['1c', 'Pinger', 1.3, 2], ['1d', 'Good Seed', 1, 1.3],
    ['2a', 'Seed', 0.7, 1], ['2b', 'Chipper', 0.57, 0.7], ['3', 'Metro', 0.37, 0.57], ['4', 'M Metro', 0.17, 0.37],
  ],
  Whiting: [
    ['1a', 'Large', 1, null], ['1b', 'Med', 0.5, 1], ['2', 'Small', 0.35, 0.5],
    ['3', 'Round', 0.25, 0.35], ['4', 'S Round', 0.11, 0.25],
  ],
  Saithe: [
    ['1', 'Large', 5, null], ['2', 'Med', 3, 5], ['3', 'Sel', 1.5, 3],
    ['4a', 'Sma', 0.8, 1.5], ['4b', 'X Sma', 0.5, 0.8], ['4c', 'XX Sma', 0.3, 0.5],
  ],
  Ling: [['1', 'Large', 5, null], ['2', 'Med', 3, 5], ['3', 'Small', 1.2, 3]],
  Pollack: [['1', 'Large', 5, null], ['2', 'Med', 3, 5], ['3', 'Sel', 1.5, 3], ['4', 'Sma', 0.3, 1.5]],
  Monkfish: [
    ['1', 'Large', 8, null], ['2', 'Med', 4, 8], ['3', 'Sel', 2, 4],
    ['4', 'Sma', 1, 2], ['5a', 'Frogs', 0.5, 1], ['5b', 'X Small', 0, 0.5],
  ],
  Hake: [
    ['1a', 'X Lrg', 6, null], ['1b', 'Large', 4, 6], ['1c', 'Med', 2.5, 4], ['2', 'Sel', 1.2, 2.5],
    ['3', 'Sma', 0.6, 1.2], ['4', 'X Sma', 0.28, 0.6], ['5', 'Pencils', 0.2, 0.28],
  ],
  Catfish: [['U9a', 'Large', 3, null], ['U9b', 'Small', 0, 3]],
  Lemon: [
    ['1a', 'X Large', 0.9, null], ['1b', 'Large', 0.6, 0.9], ['2', 'Med', 0.35, 0.6],
    ['3a', 'Sma', 0.18, 0.35], ['3b', 'X Small', 0, 0.18],
  ],
  Witch: [['U9a', 'Large', 0.3, null], ['U9b', 'Small', 0, 0.3]],
  Plaice: [
    ['1a', 'X Large', 1.2, null], ['1b', 'Large', 0.6, 1.2], ['2', 'Med', 0.4, 0.6],
    ['3', 'Sma', 0.3, 0.4], ['4', 'X Sma', 0.15, 0.3],
  ],
  Megrim: [
    ['1', 'Large', 0.8, null], ['2', 'Med', 0.45, 0.8], ['3', 'Sel', 0.25, 0.45],
    ['4a', 'Sma', 0.2, 0.25], ['4b', 'X Sma', 0.11, 0.2],
  ],
  Skate: [['1', 'Large', 5, null], ['2', 'Med', 3, 5], ['3', 'Sel', 1, 3], ['4', 'Sma', 0.3, 1]],
  Mackerel: [['1', 'Large', 0.5, null], ['2', 'Med', 0.2, 0.5], ['3', 'Small', 0.1, 0.2]],
  Brill: [['U9a', 'Large', 4, null], ['U9b', 'Small', 1, 4]],
}

/* Hanstholm, keyed by their Size number. Note Hanstholm numbers from 0 on the
 * two species where they carry a top size (cod, hake, turbot). */
export const DK_SORTS = {
  Cod: [['0', 12, null], ['1', 7, 12], ['2', 4, 7], ['3', 2, 4], ['4', 1, 2], ['5', 0.3, 1]],
  Haddock: [['1', 1, null], ['2', 0.57, 1], ['3', 0.37, 0.57], ['4', 0.17, 0.37]],
  /* THEIR OWN SHEET LEAVES A GAP HERE: size 3 reads 0,25 - 0,30 while size 2
   * starts at 0,35, so nothing covers 0.30-0.35. Recorded as printed rather
   * than quietly widened — it is their document, and a band invented to tidy
   * it would be a band nobody grades to. */
  Whiting: [['1', 0.5, null], ['2', 0.35, 0.5], ['3', 0.25, 0.3], ['4', 0.11, 0.25]],
  Saithe: [['1', 5, null], ['2', 3, 5], ['3', 1.5, 3], ['4', 0.3, 1.5]],
  Ling: [['1', 5, null], ['2', 3, 5], ['3', 0.5, 3]],
  Pollack: [['1', 5, null], ['2', 3, 5], ['3', 1.5, 3], ['4', 0.3, 1.5]],
  Monkfish: [['1', 8, null], ['2', 4, 8], ['3', 2, 4], ['4', 1, 2], ['5', 0.5, 1]],
  Hake: [['0', 4, null], ['1', 2.5, 4], ['2', 1.2, 2.5], ['3', 0.6, 1.2], ['4', 0.28, 0.6]],
  Catfish: [['1', 3, null], ['2', 1, 3], ['3', 0, 1]],
  Lemon: [['1', 0.6, null], ['2', 0.35, 0.6], ['3', 0.18, 0.35]],
  Witch: [['1', 0.5, null], ['2', 0.3, 0.5], ['3', 0, 0.3]],
  Plaice: [['1', 0.6, null], ['2', 0.4, 0.6], ['3', 0.3, 0.4], ['4', 0.15, 0.3]],
  Turbot: [['0', 5, null], ['1', 3, 5], ['2', 2, 3], ['3', 1, 2], ['4', 0, 1]],
  Brill: [['1', 1, null], ['2', 0, 1]],
  Mackerel: [['1', 0.5, null], ['2', 0.2, 0.5], ['3', 0.1, 0.2]],
  Dab: [['1', 0.25, null], ['2', 0.13, 0.25]],
}

/* GRADES THAT ARE SOLD UNGUTTED, which the band alone does not say.
 *
 * David, Oct 2026: *"a4 round is ungutted like whiting round"*. On whiting it
 * is the bottom of the size ladder — the small ones are round because they are
 * too small to gut — so the bands run straight on and nothing above gives it
 * away. The sales notes keep the two apart properly, as grade A4 presentation
 * WHL; only the BOARD welds them into one label.
 *
 * IT MATTERS FOR THE DENMARK COMPARISON AND NOWHERE ELSE SO FAR. An ungutted
 * fish carries its guts in the weight and sells cheaper by the kilo, so a
 * Peterhead round price set beside a Danish size is not like for like unless
 * Hanstholm grades that band round as well — and their published sorts do not
 * say. So the row is marked rather than dropped or quietly compared. */
export const UNGUTTED = {
  Whiting: ['3', '4'],
}

/* SPECIES ON ONE MARKET AND NOT THE OTHER, said rather than left as a silent
 * blank — a species missing from the comparison looks the same as one that
 * matched nothing, and they are different facts. */
export const NOT_COMPARABLE = {
  Megrim: 'Hanstholm publishes no megrim sorts, so there is nothing to line up against.',
  Squid: 'Peterhead grades squid by LENGTH (cm), not weight — the two cannot be compared on size.',
  Halibut: 'The Peterhead table gives halibut weight bands with no grade codes against them.',
  Turbot: 'The Peterhead table gives turbot weight bands with no grade codes against them.',
  Skate: 'Hanstholm lists longnosed skate only, which is not the same fish.',
  Tusk: 'Neither table publishes a size band for tusk, though both markets price it.',
}

const near = (a, b) => a === b || (a != null && b != null && Math.abs(a - b) < 1e-9)
const sameBand = (a1, a2, b1, b2) => near(a1, b1) && near(a2, b2)
/** Does [f,t) sit wholly inside [F,T)? Open tops compare as +infinity. */
const within = (f, t, F, T) => f >= F - 1e-9 && (T == null || (t != null && t <= T + 1e-9))

/**
 * Line up one species' grades across the two markets.
 *
 * Each entry is a Peterhead grade and the Hanstholm size(s) covering the same
 * fish, with HOW well they agree — which is the part that decides whether a
 * price comparison is fair:
 *
 *   exact     identical band. Compare the prices directly.
 *   pdFiner   several PD grades inside one Hanstholm size. A PD price is for
 *             part of what the Hanstholm price covers, so the Hanstholm
 *             figure is a blend of them — fair against the GROUP, not one.
 *   dkFiner   the reverse: Hanstholm cuts finer than Peterhead.
 *   loose     they overlap but neither contains the other. Worth knowing, not
 *             worth quoting.
 *   none      nothing on the other market covers it.
 */
export function bridgeFor(species) {
  const pd = PD_GRADES[species], dk = DK_SORTS[species]
  if (!pd || !dk) return null
  return pd.map(([code, name, f, t]) => {
    const exact = dk.find(([, F, T]) => sameBand(f, t, F, T))
    if (exact) return { code, name, from: f, to: t, dk: [exact[0]], fit: 'exact' }
    const inside = dk.find(([, F, T]) => within(f, t, F, T))
    if (inside) {
      const siblings = pd.filter(([, , pf, pt]) => within(pf, pt, inside[1], inside[2])).map(g => g[0])
      return { code, name, from: f, to: t, dk: [inside[0]], fit: 'pdFiner', group: siblings }
    }
    const covered = dk.filter(([, F, T]) => within(F, T, f, t))
    if (covered.length) return { code, name, from: f, to: t, dk: covered.map(d => d[0]), fit: 'dkFiner' }
    const over = dk.filter(([, F, T]) =>
      (T == null || f < T) && (t == null || F < t))
    return { code, name, from: f, to: t, dk: over.map(d => d[0]), fit: over.length ? 'loose' : 'none' }
  })
}

/** Every species that can be lined up at all, with its rows. */
export function bridgeAll() {
  return Object.keys(PD_GRADES)
    .filter(s => DK_SORTS[s])
    .map(s => ({ species: s, rows: bridgeFor(s) }))
}

/**
 * The grades where a Peterhead price and a Hanstholm price are for exactly the
 * same fish — the only pairs worth putting side by side without a caveat.
 */
export function exactPairs() {
  const out = []
  for (const { species, rows } of bridgeAll()) {
    for (const r of rows) if (r.fit === 'exact') out.push({ species, code: r.code, name: r.name, dk: r.dk[0], from: r.from, to: r.to })
  }
  return out
}

export const bandText = (f, t) => (t == null ? `${f}+ kg` : `${f}-${t} kg`)
