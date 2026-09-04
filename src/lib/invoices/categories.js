import { yearShares } from './when.js'

/* WHAT THE MONEY WENT ON.
 *
 * David, Sep 2026: "catagorize them into catagories. engine repairs, filters,
 * tools, fishing gear, quota, etc, etc."
 *
 * THE CATEGORY SITS ON THE SUPPLIER, and is overridable on the invoice.
 *
 * 2,625 invoices is far too many to file one at a time, and 153 suppliers is
 * not: a firm sells one kind of thing far more often than not. Jackson Trawls
 * is nets, Finning is engine parts, AFPO is quota. So the supplier carries the
 * category and every invoice inherits it — one decision covering a hundred
 * rows, the same shape as the crew-certificate categoriser filing by TYPE
 * rather than by row.
 *
 * But a firm is not ALWAYS one thing, and where it is not the invoice wins.
 * Macduff Shipyards does slipping, welding and the odd bit of chandlery; the
 * odd bit gets moved on the invoice without disturbing the other 177.
 *
 * NOTHING IS FILED WITHOUT BEING CONFIRMED. `suggestCategory` reads the firm's
 * name and what it has actually sold and offers an answer — it never applies
 * one. £8m across ten years is a lot of money to have quietly bucketed by a
 * regex, and this codebase has said the same thing once already about crew
 * tickets: a pattern does not know the boat's business better than the skipper.
 *
 * THE LIST IS A SETTING. Shipped here, overridden per fleet, merged by
 * `resolveCategories` — the same arrangement as the market clocks, the stores
 * catalogue and the gear parts, so a later correction here still reaches a boat
 * that has added one of its own.
 */

/* Derived from Audacious's OWN 153 suppliers and what they actually invoice
 * for, not from a general idea of what a boat buys. The order is the order they
 * are shown in, heaviest spend first as the record actually falls. */
export const DEFAULT_CATEGORIES = [
  { key: 'gear',        label: 'Fishing gear',        hint: 'nets, trawls, rope, twine, wire, doors' },
  { key: 'quota',       label: 'Quota & leasing',     hint: 'quota rent and leases' },
  { key: 'engine',      label: 'Engine & machinery',  hint: 'engine work, gearbox, spares, overhauls' },
  { key: 'filters',     label: 'Filters & oils',      hint: 'filters, lube oil, greases' },
  { key: 'hydraulics',  label: 'Hydraulics',          hint: 'winches, rams, valves, hoses' },
  { key: 'electronics', label: 'Electronics',         hint: 'sounders, sensors, plotters, scales' },
  { key: 'electrical',  label: 'Electrical',          hint: 'motors, cable, switchgear, lighting' },
  { key: 'shipyard',    label: 'Shipyard & steel',    hint: 'slipping, welding, fabrication, blasting, paint' },
  /* NEWBUILD FIT-OUT IS NOT A TRADE, IT IS AN EVENT — and that is exactly why
   * it needs its own bucket. David: "make it's own category. bopp for new
   * vessel fit out."
   *
   * The BOPP order is £616,200 on one day in May 2018, fitting out a boat that
   * had not yet fished: winches, windlass, cabling, Scantrol, panels. Spread
   * across hydraulics, electrical and electronics it swamps all three and makes
   * the routine spend in them unreadable — hydraulics went from a real £410k
   * over ten years to £1.03m, and nothing on the page said why. Kept together
   * it is one line that reads as what it was: kitting out a new boat. */
  { key: 'newbuild',    label: 'Newbuild fit-out',    hint: 'kitting out a new boat, before she fishes' },
  { key: 'refrig',      label: 'Refrigeration & ice', hint: 'ice plant, chillers, gas' },
  { key: 'chandlery',   label: 'Chandlery & stores',  hint: 'oilskins, gloves, cleaning, general ship supplies' },
  { key: 'tools',       label: 'Tools & hardware',    hint: 'power tools, consumables, fixings' },
  { key: 'safety',      label: 'Safety & survey',     hint: 'liferafts, LSA, FFA, surveys, stability, certification' },
  /* Both of these came out of reading what the firms actually sold rather than
     out of a general idea of a boat's costs. The medicine chest is a statutory
     locker with its own survey, and crew tickets are a real recurring bill —
     N.E.F.T.A. safety courses, Shetland UHI for an engineer's ticket. */
  { key: 'medical',     label: 'Medical stores',      hint: 'medicine chest, dressings, ENG1' },
  { key: 'training',    label: 'Training & tickets',  hint: 'courses, certificates of competency' },
  { key: 'harbour',     label: 'Harbour & landing',   hint: 'dues, towage, shiplift, bins, forklift' },
  { key: 'freight',     label: 'Freight & carriage',  hint: 'couriers, haulage, transport' },
  { key: 'vehicle',     label: 'Vehicles',            hint: 'van, tyres, repairs, fuel for the road' },
  { key: 'travel',      label: 'Travel & crew',       hint: 'flights, taxis, accommodation' },
  { key: 'office',      label: 'Office & fees',       hint: 'accountancy, insurance, subscriptions, dues' },
  { key: 'other',       label: 'Other',               hint: 'anything that fits nowhere else' },
]

/** Merge a fleet's own list over the shipped one, exactly like the market rules:
 *  a stored row supplies only what it CHANGES, so later corrections here still
 *  reach a boat that has added a category of its own. */
export function resolveCategories(stored) {
  const out = DEFAULT_CATEGORIES.map((c) => ({ ...c }))
  for (const s of stored || []) {
    const at = out.findIndex((c) => c.key === s.key)
    if (at >= 0) out[at] = { ...out[at], ...s }
    else out.push({ ...s })
  }
  return out
}

export const categoryLabel = (key, cats = DEFAULT_CATEGORIES) =>
  cats.find((c) => c.key === key)?.label || (key ? key : 'Not filed')

/* The words that point at each category, tested against the firm's NAME and
 * against what it has actually sold. Deliberately ordered: the first hit wins,
 * and the narrow trades come before the broad ones, or "Marine Engine Services"
 * lands under Electronics because it says "marine". Same lesson as the crew
 * certificate hints, where Engineer had to be tested before Deck and Radio
 * before everything. */
const HINTS = [
  /* Medical and training first: both are unmistakable in their own words and
     both would otherwise be swallowed by broader trades — a medicine chest
     invoice says "supplies", and a ticket course says "safety". */
  ['medical',     /medicine chest|medical suppl|\bpharmac|\bchemist\b|dressings|\beng ?1\b|first aid/i],
  ['training',    /\bcourse\b|\btraining\b|safety awareness|certificate of competen|\bnav ?5\b|\buhi\b/i],
  /* SAFETY BEFORE GEAR, and this is not a nicety: a "Trawler Helmet" is PPE,
     and with gear first the word `trawl` claimed Blue Anchor Fire & Safety —
     a firm that sells liferafts and lifejackets — as a net loft. Safety words
     are unambiguous where trade words are not, so they go first. Same lesson
     as the crew certificate hints, where Radio had to be tested before
     everything or a GMDSS certificate of COMPETENCE became an officer ticket. */
  ['safety',      /liferaft|\blsa\b|\bffa\b|extinguish|marasafe|lifejacket|helmet|\bmob\b|hydrostatic release|\bepirb\b|stability|incline|\bmca\b|fishsafe|\bsolas\b|\bsurvey/i],
  /* TOOLS BEFORE THE TRADES for the same reason: an "Engineers Vice" is not an
     engine job and a "Travel Trolley" is not a flight. */
  ['tools',       /\btools?\b|power tool|\bvice\b|\bdrill|grinder|\bfixings?\b|ironmonger|\bhardware\b|\bhammer\b|spanner|socket set|chainblock|sharpen/i],
  ['quota',       /\bquota\b|\blease of\b|\bfish lease\b|producers organisation|\bafpo\b|tonnes? [a-z/]* ?(cod|haddock|saithe|hake|coley|whiting|monk)|(cod|haddock|saithe|hake|coley|whiting) .{0,12}\bton/i],
  ['gear',        /trawl|\bnets?\b|netting|twine|\brope\b|dyneema|polysteel|warp|bridle|codend|discer|hopper|bobbin|\bmesh\b|itsaskorda|\bcoil\b|trawl doors?|\bcreel/i],
  /* `treuil` is French for winch, and it is not a curiosity: Etablissements
     BOPP Treuils JEB is the FIFTH biggest supplier on this boat at £616k, and
     without it the name matched nothing and the suggestion fell through to
     "Electrical" off the words "electrical panel" in one description. Checked
     against the real 153 suppliers rather than assumed — which is the only
     reason it was found. */
  ['hydraulics',  /hydraulic|\bwinch|\btreuil|\bram\b|\bvalve|\bhose\b|danfoss|\bpump\b.*hydraul/i],
  ['filters',     /\bfilters?\b|\blube\b|lubricat|\bgrease\b|\boil\b(?!skin)/i],
  ['engine',      /engine|\bdiesel|gearbox|injector|turbo|crank|\bcaterpillar\b|finning|\bmarine power\b|propuls/i],
  ['refrig',      /refrigerat|\bice\b|chiller|\bfreon\b|refrigerant|\br4\d\d[a-c]\b|ice machine/i],
  ['electronics', /electronic|sounder|sonar|plotter|\bradar\b|scanmar|\bsensor|\bscales?\b|navigat|woodsons/i],
  ['electrical',  /electric|\bmotor\b|\bcable\b|switchgear|\blight|\balternator\b|\bbattery\b/i],
  ['shipyard',    /shipyard|slip|\bweld|fabricat|blast|\bpaint|\banode|\bsteel\b|fieldweld|drydock|\bhull\b|dive team|propeller clearance/i],
  ['safety',      /liferaft|\blsa\b|\bffa\b|extinguish|\bsurvey|marasafe|lifejacket|\bmob\b|hydrostatic release|\bepirb\b|stability|incline|\bmca\b|fishsafe|\bsolas\b/i],
  ['harbour',     /harbour|\bport\b|\bdues\b|towage|shiplift|\bpilot\b|\bberth|commissioners|waste oil|bilge.*dispos|dispos.*waste/i],
  ['freight',     /freight|courier|\bhaulage\b|\bcarriage\b|transport|fedex|logistics|sea cargo|northwards/i],
  ['vehicle',     /\btyres?\b|\bvan\b|motor body|\bcar\b|dingbro|vehicle|bodyshop|\bmot\b|caddy|transit|garage|auto ?centre|motor engineers/i],
  ['travel',      /travel|\bflight|\bhotel|\btaxi|accommodation|kinnaird/i],
  ['tools',       /\btools?\b|power tool|drill|grinder|\bfixings?\b|ironmonger|\bhardware\b/i],
  ['chandlery',   /chandler|oilskin|\bglove|welly|wellington|\bboots\b|\bsuppl(y|ies)\b|\bstores\b|cleaning|\bbarkie\b|fish ?paper|\btall(y|ies)\b|\bppe\b|galley|washing machine|\bfridge|freezer/i],
  ['office',      /accountan|accounts|tax return|insur|subscription|\bsoftware\b|\blicen[cs]e\b|solicitor|\bfees?\b/i],
]

/**
 * Suggest a category for a supplier from its name and what it has sold.
 *
 * Returns `{ key, why }` or null. NULL IS A PROPER ANSWER — a firm nothing
 * matches is left for the skipper rather than swept into "Other", because
 * "Other" chosen by a person and "Other" because a regex gave up must not read
 * alike.
 *
 * The NAME is weighed before the descriptions: a firm called Jackson Trawls is
 * a net loft whatever one invoice happens to mention, and descriptions are the
 * model's summary of a photograph and drift more.
 */
export function suggestCategory(name, descriptions = []) {
  const nm = String(name || '')
  for (const [key, re] of HINTS) {
    if (re.test(nm)) return { key, why: 'the name' }
  }
  const text = descriptions.filter(Boolean).join(' · ').slice(0, 4000)
  if (!text) return null
  for (const [key, re] of HINTS) {
    if (re.test(text)) return { key, why: 'what they have sold' }
  }
  return null
}

/** The category an invoice actually counts under: its own, else its supplier's,
 *  else nothing — and nothing stays nothing rather than becoming "Other". */
export const categoryOf = (invoice, supplierById) =>
  invoice.category || supplierById.get(invoice.supplier_id)?.category || null

/**
 * Spend by category and period — the shape the page draws as a grid.
 *
 * A MATRIX, NOT A LIST OF YEARS. Ten years of costs down a page as eleven
 * separate cards answers "what did 2023 cost" and hides the only question worth
 * asking of ten years, which is what is going UP. Categories down, years
 * across, and the trend is there to be read.
 */
export function categoryMatrix(invoices = [], suppliers = [], opts = {}) {
  const { basis = 'total', years, on = 'invoice' } = opts
  const byId = new Map(suppliers.map((s) => [s.id, s]))
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

  const cols = new Set()
  const rows = new Map()
  /* How much of each year is an APPORTIONMENT rather than a dated reading. A
     work span crossing a year boundary is divided pro rata by days, which is an
     assumption — a defensible one, but a column that is partly assumption must
     be able to say so rather than looking exactly like one that is not. */
  const spread = new Map()
  let grand = 0

  for (const inv of invoices) {
    const amt = num(inv[basis])
    /* WHICH YEARS THIS INVOICE BELONGS TO, on the basis being used. Normally
       one, with its whole value; several only where the invoice states a work
       span that crosses a year end. An invoice with no usable date returns
       none, and is kept in its category row under its own column — never
       dropped, never guessed into the current year. */
    const shares = yearShares(inv, on)
    const parts = shares.length
      ? shares.map((sh) => ({ col: sh.year, amount: amt * sh.share, spread: sh.spread }))
      : [{ col: 'undated', amount: amt, spread: false }]

    if (years && parts.every((pt) => pt.col === 'undated' || !years.includes(pt.col))) continue

    const key = categoryOf(inv, byId) || '__none__'
    let row = rows.get(key)
    if (!row) { row = { key, total: 0, count: 0, cells: new Map(), suppliers: new Map() }; rows.set(key, row) }

    const sid = inv.supplier_id || 'unfiled'
    const sup = row.suppliers.get(sid)
      || { id: inv.supplier_id, name: byId.get(inv.supplier_id)?.name || inv.supplier || 'no supplier',
           total: 0, count: 0, cells: new Map(), first: null, last: null }

    /* COUNTED ONCE, ALLOCATED IN PIECES. An invoice divided across two years is
       still one invoice; counting it twice would make the row's own tally
       disagree with the number of documents behind it. */
    row.count++
    sup.count++

    for (const pt of parts) {
      if (years && pt.col !== 'undated' && !years.includes(pt.col)) continue
      cols.add(pt.col)
      row.total += pt.amount
      row.cells.set(pt.col, (row.cells.get(pt.col) || 0) + pt.amount)
      sup.total += pt.amount
      sup.cells.set(pt.col, (sup.cells.get(pt.col) || 0) + pt.amount)
      grand += pt.amount
      if (pt.spread) spread.set(pt.col, (spread.get(pt.col) || 0) + pt.amount)
    }

    if (inv.invoice_date) {
      const d = String(inv.invoice_date).slice(0, 10)
      if (!sup.first || d < sup.first) sup.first = d
      if (!sup.last || d > sup.last) sup.last = d
    }
    row.suppliers.set(sid, sup)
  }

  const years_ = [...cols].filter((c) => c !== 'undated').sort((a, b) => b - a)
  const columns = [...years_, ...(cols.has('undated') ? ['undated'] : [])]

  const built = [...rows.values()]
    .map((r) => ({
      ...r,
      cells: Object.fromEntries(r.cells),
      suppliers: [...r.suppliers.values()]
        .map((sp) => ({ ...sp, cells: Object.fromEntries(sp.cells) }))
        .sort((a, b) => b.total - a.total),
      share: grand ? r.total / grand : 0,
    }))
    /* Unfiled last whatever it is worth: it is a job to do, not a category,
       and putting it at the top would bury the ones that were chosen. */
    .sort((a, b) => (a.key === '__none__') - (b.key === '__none__') || b.total - a.total)

  /* The column totals, worked out once here rather than by each place that
     draws the grid — the footer and the heatmap have to agree, and two passes
     over the same numbers is how the chalk sheet and the catalogue came to
     disagree about the sale order. */
  const totals = {}
  for (const c of columns) totals[c] = built.reduce((t, r) => t + (r.cells[c] || 0), 0)
  const cells = built.flatMap((r) => columns.map((c) => r.cells[c] || 0)).filter((v) => v > 0)
  const peak = Math.max(0, ...cells)
  /* WHAT THE SHADING IS SCALED AGAINST, and it is deliberately NOT the biggest
     cell. One order was £616,200 on a single day while most cells are under
     £20,000 — so against the maximum every ordinary cell renders almost white
     and the heat map shows one dark square: a picture of the outlier rather
     than of the decade. Checked by rendering it, not by reading it.

     Scaled against the 90th percentile instead, with everything above it at
     full strength. Flattening the top of the range costs nothing — the exact
     figure is written in the cell — and buys back the shape of the other 200. */
  const sorted = cells.slice().sort((a, b) => a - b)
  const scale = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0

  return { columns, grand, rows: built, totals, peak, scale, spread: Object.fromEntries(spread) }
}
