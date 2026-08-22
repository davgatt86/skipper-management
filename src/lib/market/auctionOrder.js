/* THE ORDER THE MARKET ACTUALLY SELLS IN.
 *
 * The chalk sheet decides where the fish goes. This decides what order the
 * species come in WITHIN a clock — and until now that was "biggest species
 * first, so the awkward remainders are the small ones", which is a packing
 * convenience and nothing to do with the auction.
 *
 * David, Aug 2026: "not only can we create a market layout, we could lay the
 * rough/flats out in the order it is sold on the auction."
 *
 * That is a better sheet for everybody. A buyer following the rough walks the
 * fish in the order the clock will offer it; the market staff cataloguing it
 * read down the same sequence; and a lot that has just sold is the one the
 * buyer is standing beside.
 *
 * IT IS MEASURED, NOT GUESSED. The order below comes from Peterhead's own
 * "Transactions per supplier" export for the two Audacious sales of 13-08-2026
 * and 20-08-2026 — every transaction from first to last. Both sales give the
 * SAME sequence, which is what makes it an auction order rather than a quirk
 * of one day:
 *
 *   POK → HKE → COD → ANF → LIN → POL → LEM → USK → CAT → PLE → LEZ → WIT
 *       → HAL → TUR
 *
 * (USK appears only on 20-08; no tusk was landed on the 13th. Everything else
 * is identical, in both the order of the species and the grades inside them.)
 *
 * IT IS THREE LIVE CLOCKS BLENDED, NOT ONE RUNNING ORDER. David, Aug 2026:
 * "that auction order is 3 live clocks blended, not the order exactly." The
 * clocks sell alongside each other, so the export interleaves them — lemons, a
 * flat, appear between lythe and tusk, which are rough. De-blended through the
 * clock each species is filed on, the measured sequence is exactly:
 *
 *     cod       COD
 *     rough     POK · ANF · LIN · POL · USK · CAT
 *               black · monks · ling · lythe · tusk · cat
 *     flats     HKE · LEM · PLE · LEZ · WIT · HAL · TUR
 *               hake · lemons · plaice · megrim · witch · halibut · turbot
 *
 * — which is David's own listing of it, arrived at from the two exports and
 * then confirmed by him.
 *
 * SO THE BLENDED SEQUENCE IS THE RECORD AND THE PER-CLOCK ORDER IS DERIVED.
 * It is stored as the one measured list and read only ever WITHIN a clock, by
 * `bySaleOrder`. Two things fall out of doing it that way rather than storing
 * three lists: a species moved between clocks on the rules page keeps its sale
 * position automatically, and there is no second copy to drift. `clockOrders`
 * de-blends it for anything that wants to show the three.
 *
 * Reading it as a GLOBAL order would be wrong twice: it would undo keeping a
 * clock in one run, and the clock order itself is fixed — cod, then haddock
 * and whiting, then rough, then flats — with only the flats free to move rows
 * to use up space at the end.
 *
 * IT IS NOT THE GRADE ORDER EITHER. Grades inside a species keep the tally's
 * own `seq`, which is the market's grading order and David's explicit
 * instruction — "sheet follows my grades not alphabetical". The export agrees
 * with him: every block runs its grades 1 → 5 in order.
 *
 * HADDOCK AND WHITING ARE ABSENT ON PURPOSE. They are not on a live e-auction
 * clock yet (David, Aug 2026), so there is no transaction order to read. They
 * fall back to the tally's own order, which is the honest answer — inventing a
 * position for them would put a guess on the sheet dressed as a measurement.
 */

/* Peterhead's export uses FAO codes; the tally and the app use trade names.
 * The mapping is the same one behind the clock catalogue in CLAUDE.md. */
export const FAO_SPECIES = {
  POK: 'BLACK', // saithe
  HKE: 'HAKE',
  COD: 'COD',
  ANF: 'MONKS',
  LIN: 'LING',
  POL: 'LYTHE', // pollack
  LEM: 'LEMONS',
  USK: 'TUSK',
  CAT: 'CAT',
  PLE: 'PLAICE',
  LEZ: 'MEGS', // megrim
  WIT: 'WITCH',
  HAL: 'HALIBUT',
  TUR: 'TURBOT',
  HAD: 'HADDOCK',
  WHG: 'WHITING',
  SQU: 'SQUID',
  SKA: 'SKATE',
  BLL: 'BRILL',
}

/* The measured sequence, as the app names species. Anything not on it keeps
 * the tally's own order — see `orderIndex`. */
export const DEFAULT_AUCTION_ORDER = [
  'BLACK', 'HAKE', 'COD',
  'MONKS', 'LING', 'LYTHE', 'LEMONS', 'TUSK', 'CAT',
  'PLAICE', 'MEGS', 'WITCH', 'HALIBUT', 'TURBOT',
]

const up = (s) => String(s || '').trim().toUpperCase()

/* WHERE A SPECIES SITS, AND WHERE AN UNKNOWN ONE GOES.
 *
 * An unlisted species returns null rather than a number, so the caller can
 * fall back to the tally's own order instead of being handed a position that
 * was never measured. Sorting all the unknowns to the front or the back would
 * be a decision nobody made; keeping them where the tally put them is not.
 */
export function orderIndex(order = DEFAULT_AUCTION_ORDER) {
  const at = new Map(order.map((s, i) => [up(s), i]))
  return (species) => (at.has(up(species)) ? at.get(up(species)) : null)
}

/* Sort a list of species by the auction order, ties and unknowns falling back
 * to `seqOf`. Used by both the chalk sheet and the buyers' catalogue, so the
 * two documents can never disagree about what comes next. */
export function bySaleOrder(order, seqOf = (s) => 0) {
  const idx = orderIndex(order)
  return (a, b) => {
    const ia = idx(a), ib = idx(b)
    if (ia !== null && ib !== null) return ia - ib || seqOf(a) - seqOf(b)
    // A measured species always comes before an unmeasured one — otherwise a
    // fish nobody has a sale order for could land in the middle of the run and
    // make the measured part look wrong.
    if (ia !== null) return -1
    if (ib !== null) return 1
    return seqOf(a) - seqOf(b)
  }
}

/* READ PETERHEAD'S "TRANSACTIONS PER SUPPLIER" EXPORT.
 *
 * The file is one row per transaction in the order they happened, under a
 * four-line header. There is no timestamp column — the row order IS the
 * record, which is why this takes first appearance rather than trying to sort
 * anything.
 *
 * Returns the species sequence plus what the sheet says about itself, so the
 * page can show which sale an order came from rather than asking the skipper
 * to remember.
 */
export function parseTransactions(text) {
  const rows = String(text || '').split(/\r?\n/)
  const cell = (r, i) => (r.split(',')[i] || '').trim()

  const head = rows.findIndex((r) => /^Species\s*,/i.test(r))
  if (head < 0) {
    return { error: 'That is not a Transactions per supplier export — no Species column.' }
  }

  const meta = {}
  for (const r of rows.slice(0, head)) {
    if (/^Salesdate:/i.test(r)) meta.saleDate = cell(r, 1)
    if (/^Supplier:/i.test(r)) meta.supplier = cell(r, 1)
  }

  const codes = []
  const seen = new Set()
  let lines = 0
  for (const r of rows.slice(head + 1)) {
    const code = cell(r, 0)
    // The export ends with a Total row, then the supplier and a run date.
    if (!code || /^total$/i.test(code) || /^\d/.test(code)) continue
    if (code.length > 4) continue          // "AUDACIOUS - BF83" tail row
    lines++
    if (seen.has(code)) continue
    seen.add(code)
    codes.push(code)
  }
  if (!codes.length) return { error: 'No transactions in that file.' }

  /* An unmapped FAO code is KEPT, under its own code, and named back to the
   * caller. Dropping it would silently shorten the sale order, and the first
   * anyone would know is a fish laid out in the wrong place. */
  const unmapped = codes.filter((c) => !FAO_SPECIES[c])
  return {
    ...meta,
    lines,
    codes,
    unmapped,
    order: codes.map((c) => FAO_SPECIES[c] || c),
  }
}

/* MERGE TWO SALES INTO ONE ORDER.
 *
 * One sale is one day's landing, so it only carries the fish that were on the
 * market that day — the 13-08 sale has no tusk at all. Reading a single sale
 * as the whole order would drop every species that happened not to be landed.
 *
 * Later sales win on position; a species only the older sale saw keeps its
 * place relative to the neighbours it was seen with. Anything genuinely new is
 * appended rather than guessed at.
 */
export function mergeOrders(...orders) {
  const lists = orders.filter((o) => Array.isArray(o) && o.length)
  if (!lists.length) return []
  const out = [...lists[lists.length - 1]]
  for (let i = lists.length - 2; i >= 0; i--) {
    for (let k = 0; k < lists[i].length; k++) {
      const sp = lists[i][k]
      if (out.some((s) => up(s) === up(sp))) continue
      // Slot it in after the nearest earlier species we already know about.
      let at = out.length
      for (let back = k - 1; back >= 0; back--) {
        const j = out.findIndex((s) => up(s) === up(lists[i][back]))
        if (j >= 0) { at = j + 1; break }
      }
      out.splice(at, 0, sp)
    }
  }
  return out
}

/* The stored document holds only what DIFFERS from the shipped order, same as
 * the clocks and the height grid — so a fleet that has uploaded its own sale
 * order still picks up a later correction to everything else. An empty or
 * missing row behaves exactly as the default. */
export function resolveAuctionOrder(stored) {
  const list = stored?.auctionOrder
  if (!Array.isArray(list) || !list.length) return DEFAULT_AUCTION_ORDER
  return list.map(up)
}

/* DE-BLEND THE MEASURED SEQUENCE INTO ITS CLOCKS.
 *
 * Only for showing and for testing — nothing lays out from this. The layout
 * reads the blended list within one clock at a time, which gives the same
 * answer without keeping a second copy that can drift.
 *
 * A clock with nothing measured on it comes back empty rather than absent, so
 * "haddock and whiting are not on a live clock yet" is visible rather than a
 * gap someone has to notice.
 */
export function clockOrders(order = DEFAULT_AUCTION_ORDER, rules) {
  const out = {}
  for (const c of rules?.clocks || []) out[c.id] = []
  for (const sp of order) {
    const id = rules?.clockFor ? rules.clockFor(sp) : null
    if (!id) continue
    ;(out[id] = out[id] || []).push(up(sp))
  }
  return out
}
