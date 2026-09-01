/* WHO THE INVOICE IS FROM — and why this file exists before any of the rest.
 *
 * David asked for the weekly bundle "split by supplier". That is worth nothing
 * if one firm arrives under four names, and these names come off a MODEL
 * READING A PHOTOGRAPH, so they will drift harder than anything anyone typed.
 *
 * The fuel log is the warning already in this database: SEVEN spellings of one
 * supplier — "Smith & Sons", "Smith's", "Smith", "Smith & sons", "Smiths
 * &sons", "Smith's & Sons", "John a smith &sons" — 12 entries and 559,938
 * litres split across names that are almost certainly one company, which makes
 * "who do we buy most fuel from" unanswerable. Buyer names on the sales notes
 * went the same way until BUYER_CANON, and "J Smith" against "Messrs J Smith
 * Ltd" was hiding a third of that firm's volume.
 *
 * NEAR MISSES ARE NEVER GUESSED AT. This is the rule `buyerAliases` already
 * follows and the reason it is worth stating twice: welding two genuinely
 * different firms together is not recoverable afterwards, because the invoice
 * that would tell them apart has been filed under the wrong name. So the match
 * is exact after normalisation and nothing else — no edit distance, no
 * prefixes, no "close enough". Anything unmatched comes back as unmatched and
 * goes in front of the skipper, which is also how the alias list gets built.
 */

/** Strip a company name to the part that identifies it.
 *
 *  Case, punctuation, the ampersand-versus-and split and the trailing company
 *  suffix are all noise that a scanner and a model will disagree about between
 *  one week and the next. What is left has to match exactly. */
export function normaliseSupplier(raw) {
  return String(raw || '')
    .toLowerCase()
    /* Apostrophes are removed, not turned into a word break: a scanner and a
       model disagree about them constantly, and "Smith's & Sons" and "Smiths
       &sons" are plainly the same words differently punctuated. Note this is
       NOT enough to reach "Smith & Sons" — singular against plural is a real
       difference and guessing it is exactly the near miss this file refuses. */
    .replace(/['‘’]/g, '')
    .replace(/&/g, ' and ')
    // Company suffixes, only at the END — "Ltd" inside a name is part of it.
    .replace(/[\s,.]+(ltd|limited|llp|plc|inc|co|company|a\/s|as|aps)\.?$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Index a fleet's suppliers for matching. Built once per read, not per row. */
export function supplierIndex(suppliers = []) {
  const byKey = new Map()
  for (const s of suppliers) {
    for (const n of [s.name, ...(s.aliases || [])]) {
      const k = normaliseSupplier(n)
      /* FIRST ONE WINS, deliberately. Two suppliers claiming the same alias is
         a mistake somebody made on the page, and silently letting the later one
         take it would move invoices between firms with nothing to show why.
         `duplicateAliases` reports it instead. */
      if (k && !byKey.has(k)) byKey.set(k, s)
    }
  }
  return byKey
}

/** Aliases claimed by more than one supplier — a real conflict, worth naming. */
export function duplicateAliases(suppliers = []) {
  const seen = new Map()
  const clashes = []
  for (const s of suppliers) {
    for (const n of [s.name, ...(s.aliases || [])]) {
      const k = normaliseSupplier(n)
      if (!k) continue
      if (seen.has(k) && seen.get(k).id !== s.id) {
        clashes.push({ alias: n, held: seen.get(k), also: s })
      } else if (!seen.has(k)) seen.set(k, s)
    }
  }
  return clashes
}

/**
 * Match one name the reader produced against the fleet's suppliers.
 *
 * Returns `{ supplier, matched, how }`. `matched: false` is a perfectly good
 * answer and is NOT an error — it means a firm nobody has filed yet, and the
 * page asks rather than deciding. `how` says which rung it matched on, because
 * "it matched exactly" and "it matched once the Ltd came off" are different
 * degrees of confidence and the second is worth being able to review.
 */
export function matchSupplier(raw, index) {
  const name = String(raw || '').trim()
  if (!name) return { supplier: null, matched: false, how: 'blank' }

  const exact = [...index.values()].find((s) => s.name === name)
  if (exact) return { supplier: exact, matched: true, how: 'exact' }

  const hit = index.get(normaliseSupplier(name))
  if (hit) return { supplier: hit, matched: true, how: 'normalised' }

  return { supplier: null, matched: false, how: 'unknown' }
}

/**
 * Everything the reader produced, matched in one pass, with the unmatched names
 * gathered up.
 *
 * The unmatched list is grouped and counted rather than listed row by row: the
 * skipper is filing a FIRM, and being asked the same question four times
 * because one bundle carried four of its invoices is how a filing screen stops
 * getting used. Same argument as the stores catalogue filing by cert TYPE.
 */
export function matchAll(rows = [], suppliers = []) {
  const index = supplierIndex(suppliers)
  const unknown = new Map()

  const matched = rows.map((r) => {
    const m = matchSupplier(r.supplier_raw ?? r.supplier, index)
    if (!m.matched) {
      const key = normaliseSupplier(r.supplier_raw ?? r.supplier)
      const seen = unknown.get(key)
      if (seen) { seen.count++; seen.total += Number(r.total ?? r.gross) || 0 }
      else if (key) {
        unknown.set(key, {
          key,
          name: String(r.supplier_raw ?? r.supplier).trim(),
          count: 1,
          total: Number(r.total ?? r.gross) || 0,
        })
      }
    }
    return { ...r, supplier_id: m.supplier?.id ?? null, matchedHow: m.how }
  })

  return {
    rows: matched,
    unknown: [...unknown.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    duplicates: duplicateAliases(suppliers),
  }
}

/**
 * Add a name to a supplier as an alias, without duplicating what is already
 * there under a different spelling.
 *
 * Returns the aliases to store, or null if nothing needs changing — so the page
 * does not write a row that changes nothing and stamp `updated_at` for it.
 */
export function withAlias(supplier, raw) {
  const name = String(raw || '').trim()
  if (!name) return null
  const key = normaliseSupplier(name)
  if (!key) return null
  const have = [supplier.name, ...(supplier.aliases || [])].map(normaliseSupplier)
  if (have.includes(key)) return null
  return [...(supplier.aliases || []), name]
}
