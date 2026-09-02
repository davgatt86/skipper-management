/* WHAT THE BOAT SPENT, BY PERIOD AND BY SUPPLIER.
 *
 * David: "just reporting periods. annual is most important."
 *
 * So a period is a way of LOOKING at costs, not a property of a supplier. There
 * is deliberately no "this one is annual" flag on a firm — the same supplier
 * can be a one-off this year and a standing cost the next, and a tag saying
 * otherwise would be a claim the data has to keep agreeing with.
 *
 * A YEAR IS A SETTING, NOT AN ASSUMPTION. Don Fishing run the boat's quarterly
 * accounts to 30 June, so the year these totals are read against may not be the
 * calendar one. `fyStartMonth` defaults to January because that is what a
 * skipper means by "this year" unless he says otherwise, and it is one number
 * to change rather than a rewrite if he does.
 */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const asDate = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v).slice(0, 10) + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) ? null : d
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Which period an invoice date falls in.
 *
 * Returns `{ key, label }`, or null for an invoice with no date — which is a
 * real state off a photograph and must not be quietly dropped into whichever
 * period happens to be current.
 */
export function periodOf(date, grain = 'year', fyStartMonth = 1) {
  const d = asDate(date)
  if (!d) return null

  const m = d.getUTCMonth() + 1
  const y = d.getUTCFullYear()

  /* The financial year is named by the year it STARTS in, and the label says
     so — "2026/27" rather than a bare 2026, because a year running July to June
     called "2026" is the kind of label two people read two ways. */
  const fyShift = m < fyStartMonth ? -1 : 0
  const fy = y + fyShift
  const fyLabel = fyStartMonth === 1 ? String(fy)
    : `${fy}/${String((fy + 1) % 100).padStart(2, '0')}`

  if (grain === 'year') return { key: `y${fy}`, label: fyLabel, sort: fy * 100 }

  if (grain === 'quarter') {
    // Quarters run from the year's own start month, or they do not line up
    // with the year they are supposed to add up to.
    const offset = (m - fyStartMonth + 12) % 12
    const q = Math.floor(offset / 3) + 1
    return { key: `y${fy}q${q}`, label: `${fyLabel} Q${q}`, sort: fy * 100 + q }
  }

  if (grain === 'month') {
    return { key: `${y}-${String(m).padStart(2, '0')}`,
             label: `${MONTHS[m - 1]} ${y}`, sort: y * 100 + m }
  }

  throw new Error('unknown grain: ' + grain)
}

/**
 * Total the invoices by period, and by supplier within each period.
 *
 * @param invoices  rows carrying `invoice_date`, `gross`, `supplier_id`
 * @param suppliers the fleet's suppliers, for names
 * @param opts      { grain: 'year'|'quarter'|'month', fyStartMonth, basis }
 *
 * `basis` picks which figure is totalled — `total` by default, which is what
 * the existing `su_invoices` calls the gross and is what leaves the account. Net is there because it is what a set of accounts
 * compares against, and the two differ by the VAT, which is real money and
 * should never be silently one or the other.
 */
export function totalsByPeriod(invoices = [], suppliers = [], opts = {}) {
  const { grain = 'year', fyStartMonth = 1, basis = 'total' } = opts
  const nameOf = new Map(suppliers.map((s) => [s.id, s.name]))

  const periods = new Map()
  /* AN INVOICE WITH NO DATE IS COUNTED AND NAMED, never dropped into a period
     and never silently left out of the total. A photograph read by a model will
     sometimes not give up a date, and a report that quietly excludes those
     costs is worse than one that says how much it could not place. */
  const undated = { count: 0, total: 0, rows: [] }

  for (const inv of invoices) {
    const amount = num(inv[basis])
    const p = periodOf(inv.invoice_date, grain, fyStartMonth)
    if (!p) {
      undated.count++
      undated.total += amount
      undated.rows.push(inv)
      continue
    }

    let period = periods.get(p.key)
    if (!period) {
      period = { ...p, total: 0, count: 0, suppliers: new Map() }
      periods.set(p.key, period)
    }
    period.total += amount
    period.count++

    /* An invoice matched to no supplier is grouped under its RAW name rather
       than lumped into one "unknown" bucket — the raw names are the thing the
       skipper is about to file, and three of them are three decisions. */
    /* THE NAME AS READ LIVES IN `supplier`, and this looked for `supplier_raw`.
     *
     * `su_invoices` came from outside this repo and calls that column
     * `supplier`; `supplier_raw` is a name from the shape I designed before
     * finding the table already existed. So every unfiled invoice fell through
     * to the empty case and the report said **"no supplier read"** about rows
     * whose supplier was written on them — David: "not sure what supplier it
     * relates to", against four invoices that plainly name their firm.
     *
     * WORSE THAN A BLANK, because it is a claim: it says the reader failed
     * where nothing had failed at all. `matchAll` was given the fallback when
     * the table was found; this was missed. */
    const sid = inv.supplier_id || null
    const label = sid ? (nameOf.get(sid) || 'supplier no longer on file')
                      : (String(inv.supplier_raw ?? inv.supplier ?? '').trim()
                         || 'no supplier read')
    const key = sid || 'raw:' + label

    let sup = period.suppliers.get(key)
    if (!sup) {
      sup = { key, id: sid, name: label, filed: !!sid, total: 0, count: 0 }
      period.suppliers.set(key, sup)
    }
    sup.total += amount
    sup.count++
  }

  const out = [...periods.values()]
    .map((p) => ({
      ...p,
      suppliers: [...p.suppliers.values()]
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.sort - a.sort)          // newest first, as a page reads

  return { periods: out, undated, basis, grain }
}

/**
 * One supplier across the periods — what the boat spends with them, and whether
 * it is steady or a one-off.
 *
 * NO TREND IS CLAIMED FROM ONE PERIOD. Same discipline as `confidence()` in
 * gearStats and the "ordered before" headings: a single year is an observation,
 * not a pattern, and a figure that reads like a fact on the strength of it is
 * the failure worth guarding against.
 */
export function supplierHistory(invoices = [], supplierId, opts = {}) {
  const { grain = 'year', fyStartMonth = 1, basis = 'total' } = opts
  const mine = invoices.filter((i) => i.supplier_id === supplierId)

  const byPeriod = new Map()
  for (const inv of mine) {
    const p = periodOf(inv.invoice_date, grain, fyStartMonth)
    if (!p) continue
    const cur = byPeriod.get(p.key) || { ...p, total: 0, count: 0 }
    cur.total += num(inv[basis])
    cur.count++
    byPeriod.set(p.key, cur)
  }

  const periods = [...byPeriod.values()].sort((a, b) => b.sort - a.sort)
  const totals = periods.map((p) => p.total)

  return {
    periods,
    total: totals.reduce((s, t) => s + t, 0),
    /* Null, never zero, when there is nothing to average — a mean of nought
       reads as "they cost nothing", which is the opposite of "not enough yet". */
    average: periods.length ? totals.reduce((s, t) => s + t, 0) / periods.length : null,
    confidence: periods.length === 0 ? 'nothing recorded'
      : periods.length === 1 ? 'one period only — not a pattern yet'
      : periods.length === 2 ? 'two periods — thin'
      : `${periods.length} periods`,
  }
}

/* THE MANAGER'S BALANCE, off the sentence Denise writes every week.
 *
 *   "your manager's balance is sitting at just over £413k to the good after
 *    settling on Friday"
 *   "sitting at £113k the wrong way as the £336668 scientific quota adjustment
 *    was processed on..."
 *
 * IT IS PROSE, so this reads it and keeps the sentence beside the figure rather
 * than replacing it. The direction is the part that matters and the part a
 * regex is most likely to get wrong: "to the good" and "the wrong way" are the
 * same number with opposite signs, and £113k on the wrong side of the account
 * is a quarter of a million pounds different from £113k on the right side.
 *
 * Returns null rather than a guess when the shape is not there. A missing
 * balance is honest; a wrong-signed one is not.
 */
export function readManagerBalance(text) {
  const t = String(text || '').replace(/\s+/g, ' ')
  const m = /manager'?s'? balance[^.£]*£\s?([\d,]+(?:\.\d+)?)\s?(k|m)?/i.exec(t)
  if (!m) return null

  let value = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  if (/k/i.test(m[2] || '')) value *= 1000
  if (/m/i.test(m[2] || '')) value *= 1000000

  /* The direction is looked for in the SAME sentence, not the whole email —
     "settling on Friday" and other clauses follow, and a stray "wrong" further
     down the message must not flip the sign of the balance. */
  const after = t.slice(m.index, m.index + 160)
  const wrong = /wrong way|overdrawn|in debit|against/i.test(after)
  const good = /to the good|in credit|in your favour/i.test(after)

  return {
    value: wrong ? -value : value,
    /* Direction UNSTATED is not the same as "to the good". If neither phrase is
       there, say so and let the page show the sentence instead of asserting a
       sign nobody wrote. */
    direction: wrong ? 'against' : good ? 'good' : 'unstated',
    text: t.slice(m.index, m.index + 160).trim(),
  }
}

/* NET + VAT MUST COME TO THE TOTAL, and when they do not the page SAYS SO and
 * never picks which of the three is wrong — the same rule the settlement review
 * follows by showing each total twice.
 *
 * It lives here rather than in the page because it is the rule the review screen
 * triages on, and reading thirty-four bundles at once only stays honest if the
 * doubtful rows are found FOR the reader: scrolling past two hundred correct
 * ones to find three wrong ones is not checking, it is hoping.
 *
 * A FIGURE THE READER COULD NOT MAKE OUT IS NOT A DISAGREEMENT. Flagging a blank
 * as "does not add up" would put a red mark on every row the model was honest
 * about, which is how a warning stops being read.
 */
export function addsWrong(r) {
  /* `Number(null)` is 0 and `Number('')` is 0, and BOTH are finite — so reading
   * the figures straight would turn a VAT the model could not make out into a
   * confident nought, and then report a £20 disagreement that exists only
   * because a box was empty.
   *
   * THIRD TIME THIS TRAP HAS BEEN HIT IN THIS CODEBASE. The running-hours figure
   * reported "0 hours since" for an unknown reading, which an engineer reads as
   * just done; `toMm('')` canonicalised a blank to 0 mm, which is a headline
   * that has vanished. Blank has to stay blank the whole way through. */
  const num = (v) => (v === '' || v == null ? NaN : Number(v))
  const net = num(r?.net), vat = num(r?.vat), total = num(r?.total)
  if (![net, vat, total].every(Number.isFinite)) return false
  // A crumb under a penny is rounding, not a misread, and not worth stopping for.
  return Math.abs(Math.round((net + vat - total) * 100) / 100) >= 0.01
}

/* WHAT THE READER'S FAILURE ACTUALLY MEANS.
 *
 * The edge function passes the API's own error text straight through, so a run
 * that stops for a perfectly ordinary reason arrives looking like this:
 *
 *   AI request failed: {"type":"error","error":{"type":"invalid_request_error",
 *   "message":"Your credit balance is too low to access the Anthropic API..."}}
 *
 * A skipper reading that has no idea whether the boat's books are broken or a
 * card needs topping up. The raw text is still worth keeping — it is the
 * evidence, and a message nobody recognises must never be swallowed — but the
 * page leads with what it means and what to do.
 *
 * Only failures whose SHAPE is unambiguous are translated. Guessing at an
 * unfamiliar error would be worse than showing it, so anything unrecognised is
 * passed through exactly as it came.
 */
export function explainReadError(raw) {
  const t = String(raw || '')
  const known = [
    [/credit balance is too low|insufficient.{0,20}credit|billing/i,
     'The reader has run out of credit.',
     'Top the API account up at console.anthropic.com under Plans & Billing, then read these again. Nothing is lost — the bundles are still on the Arrivals tab.'],
    [/rate.?limit|429|overloaded/i,
     'The reader is being asked for too much at once.',
     'Wait a few minutes and read the rest. The ones already checked are unaffected.'],
    [/took too long|timeout|timed out/i,
     'That bundle took too long to read.',
     'Usually a big or blurred scan. Try it on its own, or enter its invoices by hand.'],
    [/ANTHROPIC_API_KEY|isn.t switched on/i,
     'The reader is not switched on for this project.',
     'The ANTHROPIC_API_KEY secret is missing in Supabase, under Edge Functions → Secrets.'],
    [/Couldn.t read the document clearly/i,
     'The scan could not be made out.',
     'A sharper scan usually fixes it, or enter that one by hand.'],
  ]
  for (const [re, what, next] of known) {
    if (re.test(t)) return { what, next, raw: t }
  }
  return { what: t, next: null, raw: t }
}
