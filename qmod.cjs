const fs = require('fs')
const p = 'src/lib/dashboard.js'
let s = fs.readFileSync(p, 'utf8')
if (s.includes('QUOTA_ORDER')) throw new Error('already there')

const add = `
/* ==== THE QUOTA BLOCK ======================================================
 *
 * David, Sep 2026: *"instead of being populated by % caught, focus on main
 * ones. Cod, Saithe, ling. west and east. Then some others afterwards ... Blue
 * ling for instance is 371% caught, but only 0.8t. It's not an issue as such."*
 *
 * TWO RULES FALL OUT OF THAT, AND THE SECOND IS THE IMPORTANT ONE.
 *
 * The six he named come first, in his order, whatever their figures — they are
 * the boat's business and he wants them where he can find them.
 *
 * And after that, NOTABLE MEANS TONNES, NOT PER CENT. Ranked by percentage,
 * WC Blue Ling leads the statement at 371% on an allocation of 0.30 t, which is
 * a boat's worth of nothing. Ranked by tonnage it is eleventh, and three lines
 * the percentage could not see at all come to the top:
 *
 *     NS Pollack   8.2 t over      allocation 0.00, caught 8.24
 *     NS Squid     6.2 t over      allocation 0.00, caught 6.20
 *     NS Cats      4.8 t over      allocation 0.00, caught 4.75
 *
 * A stock with NO allocation cannot have a percentage — there is nothing to
 * divide by — so every one of those was scoring null and sorting last, while a
 * 0.8 t overshoot sat at the top of the page in red. They are real fish caught
 * against nothing held.
 */

/* His order, and the zone is the half that is not in the stock name. The
   statement writes west-coast cod as "Cod Area VIa" and "Cod Area VIb" with no
   prefix at all, so the zone comes off `section` and the name is only asked
   what species it is. */
export const QUOTA_ORDER = [
  { zone: 'NS', species: 'Cod' }, { zone: 'WC', species: 'Cod' },
  { zone: 'NS', species: 'Saithe' }, { zone: 'WC', species: 'Saithe' },
  { zone: 'NS', species: 'Ling' }, { zone: 'WC', species: 'Ling' },
]

/* Below this an overshoot is reported in one line at the foot rather than given
   a row and a red bar of its own. It is a JUDGEMENT AND IT IS DAVID'S TO SET —
   he named 0.8 t as "not an issue", and the statement itself has a clean gap
   between 4.75 t and 0.81 t with nothing in between, so 2 t sits in open water.
   A red bar that fires on 0.4 t of skate is a warning nobody reads. */
export const SMALL_OVERSHOOT_T = 2

/* Where the statement puts the stock. `section` is the authority because the
   name does not always carry it. */
export function zoneOf(line) {
  const sec = String(line?.section || '').toLowerCase()
  if (sec.includes('north sea')) return 'NS'
  if (sec.includes('west coast')) return 'WC'
  const st = String(line?.stock || '')
  if (/^NS\s/.test(st)) return 'NS'
  if (/^WC\s/.test(st)) return 'WC'
  return null
}

/* BLUE LING IS NOT LING, AND THAT IS THE WHOLE REASON THIS IS AN EQUALITY TEST
   RATHER THAN A SUBSTRING ONE. \`includes('Ling')\` on the west coast matches
   "WC Blue Ling" — the 371% line David singled out as not an issue — and would
   have put it in the headline six under his own name for a different fish.
   Same trap on the other side: "NS Tusk (UK)" must not answer to Ling either. */
export function speciesOf(line) {
  return String(line?.stock || '')
    .replace(/^(NS|WC)\s+/i, '')
    .replace(/\s*\((UK|NOR)\)\s*$/i, '')
    .replace(/\s+Area\s+[IVX]+[a-z]?(-[a-z])?$/i, '')
    .replace(/\s+[IVX]+[a-z]?(-[a-z])?$/i, '')
    .trim()
}

/* A statement line, scored. A stock with no allocation is NOT scored at nought
   — it has no percentage at all, and saying "0% caught" over 8.24 t of pollack
   would be the opposite of the truth. */
export function quotaLine(l) {
  const alloc = num(l.allocation)
  const balance = num(l.balance ?? l.remaining)
  const caught = num(l.catch_total)
  const used = alloc > 0 && caught != null ? caught / alloc : null
  const over = balance != null && balance < 0 ? -balance : 0
  return {
    stock: l.stock || l.species || 'Unnamed',
    zone: zoneOf(l), species: speciesOf(l),
    alloc, caught, balance, used, over,
    noAllocation: !(alloc > 0) && caught > 0,
    state: over > 0 ? 'over' : used != null && used >= 0.85 ? 'tight' : '',
  }
}

/**
 * The block: the six he named, then what else is worth knowing, then the small
 * overshoots in one line.
 *
 * A NAMED STOCK THE STATEMENT DOES NOT CARRY IS SIMPLY ABSENT. Printing
 * "WC Ling — not on the statement" for a boat that never fishes the west coast
 * is a row of nothing, and the footnote already says what the order is.
 */
export function quotaBoard(lines = [], { others = 3, small = 6 } = {}) {
  const all = (Array.isArray(lines) ? lines : []).map(quotaLine)
    /* Nothing held and nothing caught is not a line about anything. */
    .filter((l) => l.alloc > 0 || l.caught > 0 || (l.balance != null && l.balance !== 0))

  const taken = new Set()
  const named = []
  for (const want of QUOTA_ORDER) {
    const hit = all.filter((l) => !taken.has(l) && l.zone === want.zone
      && l.species.toLowerCase() === want.species.toLowerCase())
      /* Several lines can answer one slot — west-coast cod is VIa and VIb. The
         bigger allocation leads; a tail line that is only a token overshoot
         falls through to the small-overshoot line like any other. */
      .sort((a, b) => (b.alloc || 0) - (a.alloc || 0))
    for (const l of hit) {
      if (l.alloc > 0 || l.over >= SMALL_OVERSHOOT_T) { taken.add(l); named.push(l) }
    }
  }

  const rest = all.filter((l) => !taken.has(l))
  const notable = rest
    .filter((l) => l.over >= SMALL_OVERSHOOT_T || (l.used != null && l.used >= 0.85))
    .sort((a, b) => b.over - a.over || (b.used ?? -1) - (a.used ?? -1))
    .slice(0, others)
  const notableSet = new Set(notable)

  const smallOver = rest
    .filter((l) => !notableSet.has(l) && l.over > 0 && l.over < SMALL_OVERSHOOT_T)
    .sort((a, b) => b.over - a.over)

  return { named, others: notable, small: smallOver.slice(0, small), smallTotal: smallOver.length }
}
`

const anchor = '/* ==== 3. WHAT TO DO NEXT'
const i = s.indexOf(anchor)
if (i < 0) throw new Error('anchor not found')
s = s.slice(0, i) + add.trimStart() + '\n' + s.slice(i)
fs.writeFileSync(p, s)
console.log('ok')
