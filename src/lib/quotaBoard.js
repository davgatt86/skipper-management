/* THE QUOTA BLOCK ON THE FRONT PAGE.
 *
 * David, Sep 2026: "quota could instead of being populated by % caught, focus
 * on main ones. Cod, Saithe, ling. west and east. Then some others afterwards
 * ... Blue ling for instance is 371% caught, but only 0.8t. It's not an issue
 * as such."
 *
 * TWO RULES FALL OUT OF THAT, AND THE SECOND IS THE IMPORTANT ONE.
 *
 * The six he named come first, in his order, whatever their figures — they are
 * the boat's business and he wants them where he can find them.
 *
 * After that, NOTABLE MEANS TONNES, NOT PER CENT. Ranked by percentage, WC Blue
 * Ling leads the whole statement at 371% — on an allocation of 0.30 t, which is
 * a boat's worth of nothing.
 *
 * AND A ZERO ALLOCATION IS NOT AN OVERSHOOT. The first cut of this ranked by
 * tonnage and put three lines at the top that the percentage could not see:
 *
 *     NS Pollack   allocation 0.00, caught 8.24, balance -8.24
 *     NS Squid     allocation 0.00, caught 6.20, balance -6.20
 *     NS Cats      allocation 0.00, caught 4.75, balance -4.75
 *
 * David, Sep 2026: *"NS pollock, NS squid & NS cats are all non quota
 * speices."* They carry no allocation because none is REQUIRED, so that
 * negative balance is the statement doing 0 − caught, not a debt. Reported as
 * overshoots they were three false alarms at the top of the front page, ahead
 * of the one line that is real.
 *
 * The app cannot tell a non-quota species from a quota species the boat simply
 * holds none of — Cod Area VIb is the second kind, on the same zero — so it
 * refuses to guess: **a line with no allocation is never called over.** It is
 * listed at the foot as caught against no allocation, in plain words, and the
 * skipper knows which is which. Failing towards the quiet side is right here,
 * because a red bar that fires on ordinary fishing is a warning nobody reads.
 */

/* His order. The zone is the half that is NOT in the stock name: the statement
   writes west-coast cod as "Cod Area VIa" and "Cod Area VIb" with no prefix at
   all, so the zone comes off `section` and the name is only asked what species
   it is. */
export const QUOTA_ORDER = [
  { zone: 'NS', species: 'Cod' }, { zone: 'WC', species: 'Cod' },
  { zone: 'NS', species: 'Saithe' }, { zone: 'WC', species: 'Saithe' },
  { zone: 'NS', species: 'Ling' }, { zone: 'WC', species: 'Ling' },
]

/* Below this an overshoot is reported in ONE LINE at the foot rather than given
   a row and a red bar of its own.

   IT IS A JUDGEMENT AND IT IS DAVID'S TO SET. He named 0.8 t as "not an issue",
   and the statement has a clean gap between 4.75 t and 0.81 t with nothing in
   between, so 2 t sits in open water. A red bar that fires on 0.4 t of skate is
   a warning nobody reads — the same argument as the engine limits and the
   duplicate check. */
export const SMALL_OVERSHOOT_T = 2

/* AND A STOCK IS ONLY "RUNNING SHORT" IF THERE IS REAL FISHING IN IT.
   The first cut tested percentage alone — 85% caught and up — which let the
   percentage back in through the side door and put WC Blue Ling (371% of
   0.30 t), NS Tusk (131% of 2.22 t) and WC Skates/Rays (160% of 0.60 t) into
   the notable list. Those are the exact three David said are not an issue.
   Anchored on the boat rather than picked: one good trip lands about 45 t, so
   an allocation under 20 t cannot constrain her fishing whatever percentage of
   it is gone. */
export const MEANINGFUL_ALLOCATION_T = 20

/* Where the statement puts the stock. `section` is the authority, because the
   name does not always carry it. */
export function zoneOf(line) {
  const sec = String(line?.section || '').toLowerCase()
  if (sec.includes('north sea')) return 'NS'
  if (sec.includes('west coast')) return 'WC'
  const st = String(line?.stock || '')
  if (/^NS\s/i.test(st)) return 'NS'
  if (/^WC\s/i.test(st)) return 'WC'
  return null
}

/* BLUE LING IS NOT LING, AND THAT IS WHY THE MATCH IS AN EQUALITY TEST RATHER
   THAN A SUBSTRING ONE. A test of "does the name contain Ling" matches
   "WC Blue Ling" — the 371% line David singled out as NOT an issue — and would
   have promoted it into the headline six under his own name for a different
   fish. Blue ling is a deepwater species with its own TAC; it is not ling.

   Same shape as `normaliseSupplier` refusing a near miss, and as VESSEL_STOP
   holding "PD": the cost of a wrong match here is a wrong fish on the front
   page, which is worse than a fish missing from it. */
export function speciesOf(line) {
  return String(line?.stock || '')
    .replace(/^(NS|WC)\s+/i, '')
    .replace(/\s*\((UK|NOR)\)\s*$/i, '')
    .replace(/\s+Area\s+[IVX]+[a-z]?(-[a-z])?$/i, '')
    .replace(/\s+[IVX]+[a-z]?(-[a-z])?$/i, '')
    .trim()
}

/* A statement line, scored.

   A STOCK WITH NO ALLOCATION IS NOT SCORED AT NOUGHT. It has no percentage at
   all, and printing "0% caught" over 8.24 t of pollack would be the exact
   opposite of the truth. `noAllocation` is its own state, the way "never
   counted" is in the parts ledger. */
export function quotaLine(l) {
  const alloc = num(l.allocation)
  const balance = num(l.balance ?? l.remaining)
  const caught = num(l.catch_total)
  const used = alloc > 0 && caught != null ? caught / alloc : null
  /* NO ALLOCATION IS NOT AN OVERSHOOT — see the note at the top of the file.
     Over is only over when there was something to go over. */
  const noAllocation = !(alloc > 0) && caught > 0
  const over = !noAllocation && balance != null && balance < 0 ? -balance : 0
  return {
    stock: l.stock || l.species || 'Unnamed',
    zone: zoneOf(l), species: speciesOf(l),
    alloc, caught, balance, used, over,
    noAllocation, 
    state: over > 0 ? 'over'
      : used != null && used >= 0.85 && alloc >= MEANINGFUL_ALLOCATION_T ? 'tight' : '',
  }
}

/**
 * The block: the six he named, then what else is worth knowing, then the small
 * overshoots in one line at the foot.
 *
 * A NAMED STOCK THE STATEMENT DOES NOT CARRY IS SIMPLY ABSENT. Printing
 * "WC Ling — not on the statement" for a boat that never fishes the west coast
 * is a row about nothing, and the footnote already says what the order is.
 */
export function quotaBoard(lines = [], { others = 3, small = 6 } = {}) {
  const all = (Array.isArray(lines) ? lines : []).map(quotaLine)
    /* Nothing held and nothing caught is not a line about anything. The
       statement carries 20 of these — Nephrops VII, NS Herring, Pollock VII. */
    .filter((l) => l.alloc > 0 || l.caught > 0 || (l.balance != null && l.balance !== 0))

  const taken = new Set()
  const named = []
  for (const want of QUOTA_ORDER) {
    /* SEVERAL LINES CAN ANSWER ONE SLOT — west-coast cod is VIa and VIb, held
       and reported separately. Both show, bigger allocation first; they are not
       added together, because two allocations summed is an allocation nobody
       holds. A tail line that is only a token overshoot falls through to the
       small-overshoot line like any other. */
    const hit = all
      .filter((l) => !taken.has(l) && l.zone === want.zone
        && l.species.toLowerCase() === want.species.toLowerCase())
      .sort((a, b) => (b.alloc || 0) - (a.alloc || 0))
    for (const l of hit) {
      if (l.alloc > 0 || l.over >= SMALL_OVERSHOOT_T) { taken.add(l); named.push(l) }
    }
  }

  const rest = all.filter((l) => !taken.has(l))
  const notable = rest
    .filter((l) => l.over >= SMALL_OVERSHOOT_T
      || (l.used != null && l.used >= 0.85 && l.alloc >= MEANINGFUL_ALLOCATION_T))
    /* BY TONNES FIRST. This is the whole point of the rewrite. */
    .sort((a, b) => b.over - a.over || (b.used ?? -1) - (a.used ?? -1))
    .slice(0, others)
  const notableSet = new Set(notable)

  const smallOver = rest
    .filter((l) => !notableSet.has(l) && l.over > 0 && l.over < SMALL_OVERSHOOT_T)
    .sort((a, b) => b.over - a.over)

  /* Caught against no allocation. NOT called over, and not ranked with the
     overshoots — three of the four biggest are non-quota species. */
  const unallocated = all
    .filter((l) => l.noAllocation && !taken.has(l))
    .sort((a, b) => (b.caught || 0) - (a.caught || 0))

  return {
    named, others: notable,
    small: smallOver.slice(0, small), smallTotal: smallOver.length,
    unallocated: unallocated.slice(0, small), unallocatedTotal: unallocated.length,
  }
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
