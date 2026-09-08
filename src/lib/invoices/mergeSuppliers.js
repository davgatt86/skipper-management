/* TWO SPELLINGS OF ONE FIRM — SUGGESTED, NEVER APPLIED.
 *
 * David, Sep 2026, having spotted six by eye: "merge these firms."
 *
 * This is the ninth instance of the pattern the repo keeps meeting — crew
 * ranks, fuel suppliers, vessel labels, buyer names, the quantity notation,
 * stores units, pack sizes, supplier names — and the worst of them, because an
 * invoice supplier name comes off a MODEL READING A PHOTOGRAPH and drifts
 * between one Monday and the next.
 *
 * `normaliseSupplier` refuses to guess a near miss, deliberately: welding two
 * genuinely different firms together cannot be undone once the invoice that
 * would tell them apart is filed under the wrong name. That refusal is right
 * for MATCHING an incoming name. It is too strict for ASKING A PERSON, which
 * is what this file is for — so the rule here is looser, and it is loose in
 * exactly one direction with a person deciding at the end of it.
 *
 * THE RULE IS PREFIX CONTAINMENT AFTER NORMALISING, and it was chosen by
 * measurement rather than taste. Over this boat's 211 firms:
 *
 *     prefix containment            5 pairs
 *     same first word              51 pairs
 *     same first word + same trade 10 pairs
 *
 * All five of the prefix pairs are worth a person looking at. The first-word
 * rule is mostly noise — Ocean Blue Quota against Ocean Endeavour, Amazon Music
 * against Amazon Marketplace — and it matched *The* Don Fishing Company against
 * *The* Garret Home Furnishings, on the word "the". A suggester that is mostly
 * wrong stops being read, and then the one real pair hides among the refusals.
 *
 * SO IT DOES NOT FIND EVERYTHING, AND THE PAGE SAYS SO. Seaway Group against
 * Seaway Net Company is a real merge this rule cannot see, because the names
 * share only their first word. David found it by eye and that is still the way
 * that kind is found.
 */

/* Extension included on purpose: node resolves ESM specifiers literally, so
   './suppliers' would break `node test-merge-suppliers.mjs`. Vite is happy
   either way. Same note as nav.js. */
import { normaliseSupplier } from './suppliers.js'

/**
 * Pairs worth asking about.
 *
 * Returns the bigger side first as `keep` — bigger by invoice count, because
 * the surviving row should be the one most history already points at, and a
 * merge that moved 205 rows to reach 5 is the same answer done the hard way.
 * The page lets it be swapped: which NAME reads best as a firm is a judgement,
 * and only the person looking at the scans can make it.
 */
export function suggestMerges(suppliers = [], invoices = []) {
  const stats = statsBySupplier(invoices)
  const rows = suppliers
    .map((s) => ({ ...s, norm: normaliseSupplier(s.name), ...(stats.get(s.id) || EMPTY) }))
    .filter((s) => s.norm)

  const out = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]
      if (!a.norm.startsWith(b.norm) && !b.norm.startsWith(a.norm)) continue
      /* ALREADY ANSWERED. Two firms told apart once must not be asked about
         again — see the note on `not_same_as`. Checked both ways round, since
         which of the pair is found first is an accident of ordering. */
      if ((a.not_same_as || []).includes(b.id)) continue
      if ((b.not_same_as || []).includes(a.id)) continue

      const [keep, drop] = a.count >= b.count ? [a, b] : [b, a]
      out.push({
        keep,
        drop,
        /* WHAT ONLY A PERSON CAN JUDGE, put in front of them. The two pairs on
           this boat that must NOT be merged are only distinguishable by what
           each side sells — one firm, two trades. */
        sameTrade: (keep.category || null) === (drop.category || null),
        extra: onlyIn(drop.norm, keep.norm) || onlyIn(keep.norm, drop.norm),
      })
    }
  }
  /* The one carrying the most money first: a £1.3m firm split in two is worth
     deciding, two £600 chemist bills much less so. */
  return out.sort((x, y) => (y.keep.value + y.drop.value) - (x.keep.value + x.drop.value))
}

/** The words one name carries and the other does not — "macduff crane hire",
 *  "e catch", "frederikshavn". Usually the whole question in three words. */
function onlyIn(longer, shorter) {
  if (!longer.startsWith(shorter)) return ''
  /* A company suffix left in the middle is noise, not the difference. The
     shorter name had its trailing "Ltd" normalised away and the longer one did
     not, because in "Macduff Shipyards Limited (Macduff Crane Hire)" it is not
     trailing — so the remainder reads "limited macduff crane hire" when the
     thing worth showing is "macduff crane hire". */
  return longer.slice(shorter.length).trim()
    .replace(/^(ltd|limited|llp|plc|inc|co|company)\s+/, '')
}

const EMPTY = { count: 0, value: 0, first: null, last: null, kinds: [] }

function statsBySupplier(invoices) {
  const by = new Map()
  for (const inv of invoices) {
    if (!inv.supplier_id) continue
    let s = by.get(inv.supplier_id)
    if (!s) { s = { count: 0, value: 0, first: null, last: null, kinds: [] }; by.set(inv.supplier_id, s) }
    s.count++
    const v = Number(inv.total)
    if (Number.isFinite(v)) s.value += v
    const d = inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : null
    if (d) {
      if (!s.first || d < s.first) s.first = d
      if (!s.last || d > s.last) s.last = d
    }
    /* A few of the dearest things it sold. What tells a branch from a business
       is what is on the invoices, not the name — the Don Fishing pair is
       chandlery against quota and nothing in the names says so. */
    if (inv.description) s.kinds.push({ text: String(inv.description), value: Number(inv.total) || 0 })
  }
  for (const s of by.values()) {
    s.kinds = s.kinds.sort((a, b) => b.value - a.value).slice(0, 3).map((k) => k.text)
  }
  return by
}
