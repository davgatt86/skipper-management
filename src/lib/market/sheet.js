/* The chalk sheet — turning a layout into something you can carry onto the
 * market floor and copy onto the concrete.
 *
 * The screen view is a picture of the market. This is the working document,
 * and it wants different things:
 *
 *  - TIERS ARE COLUMNS, read top to bottom, because that is how you walk them.
 *    The top row sits at the top of the column and the bottom row at the
 *    bottom, with the walkway between, so the sheet is a plan view of the floor
 *    rather than a diagram of it.
 *  - RUNS, NOT BOXES. Twelve footprints of the same grade off the same day tag
 *    is one chalked block, written once. That is how it goes on the floor and
 *    it is what makes a 47-deep column readable.
 *  - Every boundary is marked: a new species, a new grade inside it, a new day
 *    tag. Those are the three things you can get wrong while chalking.
 *  - FIVE tiers to a page. It was ten, which fitted but read badly: a 19mm
 *    column is not enough to write a species, a grade, a code, a tag, a count
 *    and a height in at a size anyone can read on a wet market floor. Five
 *    doubles the column to ~40mm and lets the type go up with it. More pages,
 *    but the sheet is for reading, not for saving paper.
 */

/* Consecutive stacks of the same grade off the same day tag become one block.
 * A stack can span two days, so the day signature is the whole part list. */
export function runsOf(stacks) {
  const runs = []
  for (const s of stacks) {
    const days = s.parts.map((p) => p.day)
    const key = `${s.species}||${s.grade}||${days.join('/')}`
    const last = runs[runs.length - 1]
    if (last && last.key === key) {
      last.footprints += 1
      last.boxes += s.boxes
    } else {
      runs.push({
        key, species: s.species, grade: s.grade, auction: s.auction,
        days, footprints: 1, boxes: s.boxes,
        height: s.height, max: s.max, lowered: s.lowered,
      })
    }
  }
  // The three boundaries worth marking, computed once so the view does not
  // have to look backwards while rendering.
  //
  // A day change is only marked INSIDE a grade. Marking it everywhere fired on
  // 287 of 297 blocks on a real trip — a rule that is almost always true tells
  // you nothing, and it buried the species boundaries under it. A new grade
  // already carries its own heavier mark, and every block shows its day tag
  // regardless; what wants calling out is the same fish off a different tag,
  // which is the pair that actually gets chalked wrong.
  runs.forEach((r, i) => {
    const prev = runs[i - 1]
    r.newSpecies = !prev || prev.species !== r.species
    r.newGrade = r.newSpecies || prev.grade !== r.grade
    r.newDay = !r.newGrade && prev.days.join('/') !== r.days.join('/')
  })
  return runs
}

/* Tiers cut into pages of ten, each tier a column of two runs lists. */
export function sheetPages(plan, perPage = 5) {
  const pages = []
  const tiers = plan?.byTier || []
  for (let i = 0; i < tiers.length; i += perPage) {
    pages.push({
      /* THE MARKET'S OWN NUMBER, not a count from one. The man chalking this
         is standing at tier 84 and the sheet has to agree with the floor. */
      from: tiers[i].number ?? tiers[i].tier,
      to: tiers[Math.min(i + perPage, tiers.length) - 1].number
          ?? tiers[Math.min(i + perPage, tiers.length) - 1].tier,
      columns: tiers.slice(i, i + perPage).map((t) => ({
        tier: t.number ?? t.tier,
        area: t.area ?? null,
        // How deep THIS tier is. Outside the new market the top is nought.
        cap: t.cap ?? null,
        top: runsOf(t.top),
        bottom: runsOf(t.bottom),
      })),
    })
  }
  return pages
}

/* Six hues, three shades each. Light enough to write black on and to
 * photocopy, saturated on the edge so a block's boundary survives a wet market
 * floor. The species carries the hue; grades inside it take different shades.
 *
 * THREE shades, not two, because two is not always enough: the shade has to
 * differ between grades that actually touch, and a species' grades do not lay
 * out in a simple alternating line. Two shades let HAKE Large sit against HAKE
 * Med in the same pink. */
export const PALETTE = [
  { name: 'blue',   edge: '#1749A8', shades: ['#DCE7F7', '#B4CBEE', '#8FB2E4'] },
  { name: 'green',  edge: '#26654F', shades: ['#DBEDE3', '#B2D9C6', '#8CC5AB'] },
  { name: 'amber',  edge: '#A97614', shades: ['#F7EBD2', '#EFD6A2', '#E5C275'] },
  { name: 'rose',   edge: '#C2342A', shades: ['#F7DEDC', '#EFBAB5', '#E59A92'] },
  { name: 'violet', edge: '#5B3E9B', shades: ['#E6DEF2', '#CBB9E4', '#B197D6'] },
  { name: 'teal',   edge: '#1C6B78', shades: ['#D7EDF0', '#A9D8E0', '#82C3D0'] },
]

/* Day tags get their own strong colours, used ONLY on the day chip. The fill
 * stays with the fish; mixing the two would mean a block's colour answered two
 * questions at once and neither clearly. */
export const DAY_INK = ['#1749A8', '#C2342A', '#26654F', '#A97614', '#5B3E9B', '#1C6B78', '#8A3E7A', '#4A5A16']
export const dayInk = (day) => DAY_INK[(Number(day) - 1 + DAY_INK.length) % DAY_INK.length] || DAY_INK[0]

/* Assign each species a hue so that NO TWO TOUCHING BLOCKS SHARE A COLOUR.
 *
 * Greedy graph colouring over the species that actually end up next to each
 * other on the sheet — cheaper than it sounds, since a row only ever has a
 * handful of neighbours, and it means the palette can be reused freely as long
 * as the repeat is somewhere else on the floor. A species keeps one hue across
 * every tier and both rows, so the eye can follow it down the market. */
export function assignColours(pages) {
  const neighbours = new Map()
  const seen = []
  // Grade-level adjacency, per species — what the SHADE has to separate.
  const gradeNb = new Map()
  const gradesOf = new Map()
  const noteGrade = (sp, g) => {
    const k = `${sp}||${g}`
    if (!gradeNb.has(k)) {
      gradeNb.set(k, new Set())
      if (!gradesOf.has(sp)) gradesOf.set(sp, [])
      gradesOf.get(sp).push(g)
    }
    return k
  }
  const note = (sp) => {
    if (!neighbours.has(sp)) { neighbours.set(sp, new Set()); seen.push(sp) }
  }
  for (const page of pages) {
    for (const col of page.columns) {
      for (const row of [col.top, col.bottom]) {
        row.forEach((r, i) => {
          note(r.species)
          const key = noteGrade(r.species, r.grade)
          const prev = row[i - 1]
          if (!prev) return
          if (prev.species !== r.species) {
            neighbours.get(r.species).add(prev.species)
            neighbours.get(prev.species).add(r.species)
          } else if (prev.grade !== r.grade) {
            const pk = noteGrade(prev.species, prev.grade)
            gradeNb.get(key).add(pk)
            gradeNb.get(pk).add(key)
          }
        })
      }
    }
  }

  // Spread across the palette FIRST, then resolve conflicts. Taking the lowest
  // free index instead — the textbook greedy colouring — is correct and useless
  // here: on a real trip only a handful of species ever touch, so eleven of
  // sixteen came out the same blue. A legal colouring is not the goal; telling
  // the fish apart down the length of the market is.
  const hue = new Map()
  seen.forEach((sp, i) => {
    const taken = new Set([...neighbours.get(sp)].map((n) => hue.get(n)).filter((h) => h != null))
    let pick = i % PALETTE.length
    for (let k = 0; k < PALETTE.length && taken.has(pick); k++) pick = (pick + 1) % PALETTE.length
    hue.set(sp, pick)
  })

  /* Shades, the same way: step down the ladder so consecutive grades usually
   * differ, then shift off anything a grade actually TOUCHES. Alternating on
   * index alone is not the rule — it only looks like it — and it put HAKE
   * Large against HAKE Med in the same pink. */
  const gradeShade = new Map()
  const shades = PALETTE[0].shades.length
  for (const [sp, list] of gradesOf) {
    list.forEach((g, i) => {
      const k = `${sp}||${g}`
      const taken = new Set([...gradeNb.get(k)].map((n) => gradeShade.get(n)).filter((s) => s != null))
      let pick = i % shades
      for (let t = 0; t < shades && taken.has(pick); t++) pick = (pick + 1) % shades
      gradeShade.set(k, pick)
    })
  }

  return {
    hueOf: (sp) => hue.get(sp) ?? 0,
    styleFor: (species, grade) => {
      const p = PALETTE[hue.get(species) ?? 0]
      return { fill: p.shades[gradeShade.get(`${species}||${grade}`) ?? 0], edge: p.edge, hue: p.name }
    },
    species: seen,
  }
}

/* Short enough for a 20mm column, still unmistakable on a market floor. */
const SHORT = {
  HADDOCK: 'HAD', WHITING: 'WHIT', BLACK: 'BLK', MONKS: 'MONK', LYTHE: 'LYTH',
  SQUID: 'SQD', HALIBUT: 'HALI', TURBOT: 'TURB', LEMONS: 'LEM', PLAICE: 'PLA',
  MEGS: 'MEG', WITCH: 'WIT', SKATE: 'SKT', BRILL: 'BRIL', OTHER: 'OTH',
}
export const shortSpecies = (s) => SHORT[String(s || '').toUpperCase().trim()] || String(s || '').toUpperCase()

/* "Good Seed (1d)" → "Good Seed". The code is shown on its own, so repeating
 * it inside the name wastes the only width the column has. */
export const gradeName = (g) => String(g || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
export const gradeCode = (g) => (/\(([^)]*)\)\s*$/.exec(String(g || '')) || [, ''])[1]
