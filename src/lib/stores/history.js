/* WHAT THIS BOAT ORDERS, FROM WHAT SHE HAS ORDERED BEFORE.
 *
 * The catalogue is 334 items and a trip uses about 60 of them, largely the same
 * 60 every time. Scrolling the whole form to rebuild that by hand is the work
 * this removes: the lines already in the database are the record of what gets
 * bought, so the next list can start from them.
 *
 * PURE, AND SEPARATE FROM THE PAGE, because the ranking is the part worth
 * testing — `test-stores.mjs` runs it against fixtures and against the real
 * shape of a saved list.
 *
 * THE COUNT IS PART OF THE ANSWER. Same discipline as `confidence(n)` in
 * gearStats and `groundConfidence()` in the gear grounds: one previous list is
 * not a habit, and a panel headed "Regularly ordered" on the strength of a
 * single trip is a confident lie about the boat's own routine. The heading and
 * the per-item note both change with how many lists there actually are, and
 * with one it says "last trip" and nothing more.
 */

/** Lists that can serve as history: not the one being built, and not empty. */
export function historyLists(lists = [], lines = [], excludeListId = null) {
  const withLines = new Set(lines.map((l) => l.list_id))
  return lists
    .filter((l) => l.id !== excludeListId && withLines.has(l.id))
    /* Newest first, by the date the trip SAILS rather than the row's
     * created_at: a list started in advance for next month is not more recent
     * than one built yesterday for yesterday. Falls back to created_at for a
     * list with no date on it yet. */
    .sort((a, b) => key(b).localeCompare(key(a)))
}

const key = (l) => String(l.starts_on || l.created_at || '')

/** The middle value, so one heavy trip does not set the usual quantity. */
export function median(ns) {
  const xs = ns.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!xs.length) return null
  const m = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2
}

/**
 * What to offer for quick adding, best first.
 *
 * Ranked by REGULARITY first — how many past lists carried it — and only then
 * by recency. A thing bought every trip should outrank a one-off bought last
 * week, which is the whole difference between "regularly" and "recently"
 * ordered. Anything already on the current list is left out: suggesting what
 * is in front of you is noise.
 */
export function orderHistory(lists = [], lines = [], opts = {}) {
  const { excludeListId = null, excludeKeys = [], limit = 60 } = opts

  const hist = historyLists(lists, lines, excludeListId)
  const trips = hist.length
  if (!trips) return { trips: 0, total: 0, items: [], heading: null, basis: null }

  const rank = new Map(hist.map((l, i) => [l.id, i]))   // 0 = most recent
  const skip = new Set(excludeKeys)

  const byItem = new Map()
  for (const l of lines) {
    if (!rank.has(l.list_id) || skip.has(l.item_key)) continue
    let it = byItem.get(l.item_key)
    if (!it) {
      it = { key: l.item_key, name: l.name, category: l.category, unit: l.unit,
             section: l.section ?? null, packSize: l.pack_size ?? null,
             lists: new Set(), qtys: [], best: Infinity }
      byItem.set(l.item_key, it)
    }
    it.lists.add(l.list_id)
    it.qtys.push(Number(l.qty))
    const r = rank.get(l.list_id)
    /* The name, unit and pack size are taken from the MOST RECENT list that
     * carried it, not the first one found — a unit corrected last trip is the
     * one the boat means now. */
    if (r < it.best) {
      it.best = r
      it.name = l.name; it.unit = l.unit
      it.category = l.category
      it.section = l.section ?? null
      it.packSize = l.pack_size ?? null
    }
  }

  const items = [...byItem.values()]
    .map((it) => ({
      key: it.key, name: it.name, category: it.category, unit: it.unit,
      section: it.section, packSize: it.packSize,
      count: it.lists.size,
      trips,
      /* The usual amount, so one tap puts on what is normally bought rather
       * than a bare 1 that then has to be typed over. */
      typicalQty: median(it.qtys) ?? 1,
      lastListId: hist[it.best]?.id ?? null,
      lastOn: hist[it.best]?.starts_on ?? null,
      recency: it.best,
    }))
    .sort((a, b) => b.count - a.count || a.recency - b.recency
                    || String(a.name).localeCompare(String(b.name)))

  /* `total` so the page can say when it is showing part of the answer. On
   * Audacious's real data the last list carried 64 items against a limit of
   * 40, and "here is what you usually order" quietly missing a third of it is
   * the kind of gap nobody notices until the shop delivers. */
  return {
    trips, total: items.length, items: items.slice(0, limit),
    heading: heading(trips), basis: basis(trips),
  }
}

/* ONE PREVIOUS LIST IS NOT A HABIT. The wording is the guard: nothing here may
 * call itself regular until there is enough behind it to be regular about. */
export function heading(trips) {
  if (!trips) return null
  if (trips === 1) return 'Ordered last trip'
  if (trips === 2) return 'Ordered recently'
  return 'Regularly ordered'
}

export function basis(trips) {
  if (!trips) return null
  if (trips === 1) return 'from the one list kept so far — not a pattern yet'
  return `from the last ${trips} lists`
}

/** How to describe a single item's history, in the same honest register. */
export function itemNote(item) {
  if (!item || !item.trips) return ''
  if (item.trips === 1) return 'last trip'
  if (item.count === item.trips) return `every one of the last ${item.trips}`
  if (item.count === 1) return 'once'
  return `${item.count} of the last ${item.trips}`
}
