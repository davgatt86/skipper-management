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

/* The four auctions. Fish from one auction is kept together on the market so
 * the buyers for it can walk it in one go. */
export const AUCTIONS = [
  { id: 'cod', n: 1, label: 'Cod' },
  { id: 'hadwhit', n: 2, label: 'Haddock & whiting' },
  { id: 'rough', n: 3, label: 'Rough' },
  { id: 'flats', n: 4, label: 'Flats' },
]

const ROUGH = ['BLACK', 'MONKS', 'LING', 'LYTHE', 'SQUID', 'CAT', 'OTHER']
const FLATS = ['HAKE', 'PLAICE', 'LEMONS', 'MEGS', 'HALIBUT', 'TURBOT', 'BRILL', 'WITCH', 'SKATE']

export function auctionFor(species) {
  const s = String(species || '').toUpperCase().trim()
  if (s.startsWith('COD')) return 'cod'                 // includes COD ROE
  if (s.startsWith('HADDOCK') || s === 'WHITING') return 'hadwhit'
  if (ROUGH.includes(s)) return 'rough'
  if (FLATS.includes(s)) return 'flats'
  return 'rough'        // an unknown round fish is rough; nothing falls off the market
}

/* Only the flats auction may be split between the top and bottom rows, to use
 * up space the other three leave behind. Everything else keeps its species in
 * one band so a buyer is not looking in two places for the same fish. */
export const canSplitBands = (auction) => auction === 'flats'

/* Maximum stack height for a species and grade.
 *
 * Confirmed with David Aug 2026, including the three edges that were not
 * obvious from the rules as written: Sprag is 1 high (it sits inside "medium
 * cod to XL cod"), BLACK XX Sma is 4 high like the rest of the small black,
 * and the roes lie flat. */
export function maxHeight(species, grade) {
  const s = String(species || '').toUpperCase().trim()
  const g = String(grade || '').toUpperCase().trim()

  if (s.includes('ROE') || g.includes('ROE')) return 1

  if (s === 'HADDOCK') {
    if (g.startsWith('M METRO')) return 4
    if (g.startsWith('METRO')) return 3
    if (/^(GOOD SEED|PINGER|CHAT|XL)/.test(g)) return 1
    return 2                                            // Seed, Chipper
  }
  if (s === 'BLACK') {                                  // saithe / coley
    if (/^(XX SMA|X SMA|SMA)/.test(g)) return 4
    if (g.startsWith('SEL')) return 3
    return 2                                            // Large, Med
  }
  if (s === 'WHITING') {
    if (/^(S ROUND|ROUND)/.test(g)) return 4
    return 2                                            // Large, Med, Small
  }
  if (s === 'COD') {
    if (/^(MED|SPRAG|COD|LARGE|XL)/.test(g)) return 1
    return 2                                            // B Baby, Baby, Robbie
  }
  // Flats lie flat, and so do the big round fish that are handled singly.
  if ([...FLATS, 'LYTHE', 'MONKS', 'LING', 'SQUID'].includes(s)) return 1
  return 2                                              // CAT, tusk, anything unnamed
}

/* Roughly how much a grade is worth relative to its neighbours, used only to
 * decide what gets favoured LOW when there is a choice. Not a price — a rank.
 * Prime grades and anything that lies flat are already at height 1. */
export function isPrime(species, grade) {
  const g = String(grade || '').toUpperCase()
  return maxHeight(species, grade) === 1 || /^(XL|X LRG|LARGE|CHAT|GOOD SEED|PINGER)/.test(g)
}

/* What each species actually makes, £/kg.
 *
 * MEASURED, NOT GUESSED. Taken from Audacious's own sales notes across every
 * UK landing on record — the figures a made-up "value order" would have got
 * wrong. Used for one thing only: deciding which fish gets laid lower when
 * there is spare room on the market.
 *
 * Most of the dear fish already lies flat, so in practice this decides between
 * cod's small grades, catfish, saithe, haddock and whiting.
 *
 * Worth refreshing occasionally; the ORDER matters, not the exact figure. */
export const SPECIES_VALUE = {
  TURBOT: 15.69, HALIBUT: 12.05, BRILL: 9.42, LEMONS: 6.20,
  COD: 5.94, 'COD ROE': 5.94, LYTHE: 5.42, HAKE: 5.08, MONKS: 4.95,
  CAT: 2.76, MEGS: 2.64, SQUID: 2.59, LING: 2.51, PLAICE: 2.45,
  BLACK: 2.05, HADDOCK: 2.02, 'HADDOCK ROE': 2.02, WHITING: 1.72,
  SKATE: 1.59, OTHER: 1.24, WITCH: 0.93,
}

// An unlisted fish sits mid-table rather than first or last — being wrong
// about where it goes should cost a little, not a lot.
export const valueOf = (species) => SPECIES_VALUE[String(species || '').toUpperCase().trim()] ?? 2.5
