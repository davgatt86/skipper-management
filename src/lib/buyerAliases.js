/* Buyer name merges, applied at ingest.
 *
 * Buyer names arrive from the note rather than a pick-list, so the same firm
 * turns up spelled several ways and splits its own record. Merging the history
 * fixes what is already there; the aliases are what stop the NEXT note
 * reintroducing the variant and undoing the work.
 *
 * It has mattered: "J Smith" against "Messrs J Smith Ltd" was hiding a THIRD
 * of that buyer's volume and understating their rate, because the split rows
 * were the strongest of the lot.
 *
 *     before   100,640 kg · 39 days · +£0.854/kg · worth  £86,000
 *     after    128,337 kg · 47 days · +£0.949/kg · worth £121,745
 *
 * PER FLEET, always. Two boats may know the same firm by different names, and
 * one fleet's merge is not evidence about another's.
 *
 * SHARED BY BOTH INGEST PATHS — the CloudMailin webhook and the browser
 * upload. It was written out twice, inline and identical, which is the exact
 * drift this repo has been bitten by four times (crew_ranks, fuel suppliers,
 * vessel labels, buyer names themselves). esbuild bundles the Netlify
 * functions, so one module serves both.
 */

/* Variants differ by case, spacing and punctuation — "G & J JACK" against
 * "G&J Jack Seafoods Ltd" — so the comparison throws all three away. */
export const squashBuyer = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/* Rows straight out of `sales_buyer_flags` → a lookup of squashed alias to
 * canonical name. */
export function buildAliasMap(flags) {
  const map = new Map()
  for (const f of flags || []) {
    if (!f?.canonical_name) continue
    for (const a of f.aliases || []) {
      const k = squashBuyer(a)
      if (k) map.set(k, f.canonical_name)
    }
    // The canonical name maps to itself, so a note that already spells it
    // correctly is not left to chance if it differs only by punctuation.
    const self = squashBuyer(f.canonical_name)
    if (self) map.set(self, f.canonical_name)
  }
  return map
}

/* An unknown buyer passes through UNCHANGED. A merge is a decision somebody
 * made; guessing at one from string similarity is how two genuinely different
 * firms get welded together, and that is not recoverable from the note. */
export function makeCanonBuyer(aliasMap) {
  return (b) => aliasMap.get(squashBuyer(b)) || b || ''
}

/* Convenience for a caller that has just read the flags. */
export const canonBuyerFrom = (flags) => makeCanonBuyer(buildAliasMap(flags))
