/* WHAT THE NOTE JUST CHANGED.
 *
 * Uploading a sales note used to answer with one line of log:
 *
 *   ✓ note.pdf: AUDACIOUS BF83 13-08-2026 — 1,192 bx, £136,656.50
 *
 * which says the file was read and nothing about what it did. A skipper wants
 * to know it reconciled, whether it replaced a note he had already put in, and
 * where it lands against the year. A man being shown the app for the first time
 * wants to see that the figures on the screen came out of the paper he just
 * dropped on it.
 *
 * So this turns a parse result into that summary. It is a PURE function of the
 * parse result and the landings already on file — no queries, no rendering —
 * because the interesting part is the arithmetic and arithmetic is the part
 * worth testing.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/* A note's own figures come from its ROWS, never from its printed total. The
 * printed total is the check, not the source — the same rule the ingest works
 * to, and the reason `reconcile_diff` exists at all. */
export function noteTotals(rows = []) {
  const t = rows.reduce((a, r) => ({
    boxes: a.boxes + (Number(r.boxes) || 0),
    weight: a.weight + (Number(r.total_weight) || 0),
    value: a.value + (Number(r.total_value) || 0),
  }), { boxes: 0, weight: 0, value: 0 })
  return {
    boxes: round2(t.boxes),
    weight: round2(t.weight),
    value: round2(t.value),
    ppk: t.weight ? round2(t.value / t.weight) : null,
  }
}

/* The species that carried the note, biggest money first. Three is enough to
 * recognise the trip by; a full list is the table underneath. */
export function topSpecies(rows = [], n = 3) {
  const by = new Map()
  for (const r of rows) {
    const k = (r.species_canon || r.species || '').trim() || '—'
    const cur = by.get(k) || { species: k, value: 0, weight: 0 }
    cur.value += Number(r.total_value) || 0
    cur.weight += Number(r.total_weight) || 0
    by.set(k, cur)
  }
  const all = [...by.values()].sort((a, b) => b.value - a.value)
  const total = all.reduce((s, x) => s + x.value, 0)
  return all.slice(0, n).map((x) => ({
    species: x.species,
    value: round2(x.value),
    share: total ? Math.round((x.value / total) * 100) : 0,
    ppk: x.weight ? round2(x.value / x.weight) : null,
  }))
}

/* Buyers on this note that this fleet has not seen before.
 *
 * `known` is whatever set of buyer names the caller already holds. When it does
 * not hold one, this returns null rather than an empty list — "no new buyers"
 * and "nobody looked" must not render the same way, and an empty array would
 * quietly claim the first is true. */
export function newBuyers(rows = [], known) {
  const seen = [...new Set(rows.map((r) => (r.buyer || '').trim()).filter(Boolean))]
  if (!(known instanceof Set)) return { buyers: seen.length, fresh: null }
  const norm = (s) => s.toUpperCase().replace(/\s+/g, ' ').trim()
  const have = new Set([...known].map(norm))
  return { buyers: seen.length, fresh: seen.filter((b) => !have.has(norm(b))) }
}

/* Where the note sits against the year it belongs to.
 *
 * Deliberately the note's OWN year, not the calendar's: a January note uploaded
 * late should be read against the year it was landed in, not the one the
 * skipper happens to be standing in. */
export function yearContext(isoDate, landings = [], excludeId = null) {
  const year = String(isoDate || '').slice(0, 4)
  if (!/^\d{4}$/.test(year)) return null
  const mine = landings.filter((l) => String(l.landing_date || '').slice(0, 4) === year
    && l.id !== excludeId)
  const value = mine.reduce((s, l) => s + (Number(l.value) || 0), 0)
  return { year, landings: mine.length, value: round2(value) }
}

/* THE WHOLE SUMMARY.
 *
 * `res`      the parse result
 * `opts.isNew`      false when this note replaced one already on file
 * `opts.landings`   the fleet's landings BEFORE this upload
 * `opts.knownBuyers` a Set of buyer names already on file, or undefined
 */
export function summariseNote(res, opts = {}) {
  const rows = res?.rows || []
  const meta = res?.meta || {}
  const rec = res?.reconcile || {}
  const totals = noteTotals(rows)
  /* THE YEAR IS SHOWN AS IT STOOD, then as it stands.
   *
   * For a NEW note that is one more landing and its value added. For one that
   * REPLACED a note already on file the count does not move at all — it is the
   * same landing — and the value moves by the DIFFERENCE between the old
   * figures and the new. Counting a replacement as an extra landing was the
   * first cut and it read "1 landing → 2" for a note that added neither. */
  const all = opts.landings || []
  const before = yearContext(meta.isoDate, all)
  const replaced = opts.replacedId != null
    ? all.find((l) => l.id === opts.replacedId) : null

  return {
    file: res?.filename || '',
    market: res?.market || '',
    vessel: meta.vessel || '',
    date: meta.isoDate || null,
    saleNo: meta.saleNo || '',
    isNew: opts.isNew !== false,
    rows: rows.length,
    ...totals,
    species: new Set(rows.map((r) => r.species_canon || r.species)).size,
    top: topSpecies(rows),
    ...newBuyers(rows, opts.knownBuyers),

    /* THE RECONCILIATION IS REPORTED IN THREE STATES, NOT TWO.
     *
     * A note with no printed TOTAL is not a note that failed — it is one that
     * cannot be checked, and saying "reconciled" of it would be a claim nobody
     * made. `reconcile_ok` is nullable in the database for the same reason. */
    checked: rec.found ? (rec.ok ? 'ok' : 'differs') : 'none',
    diffs: rec.found && !rec.ok ? rec.diffs : null,
    printed: rec.found ? rec.expected : null,

    before,
    after: before ? {
      year: before.year,
      landings: before.landings + (replaced ? 0 : 1),
      value: round2(before.value - (Number(replaced?.value) || 0) + totals.value),
    } : null,
  }
}
