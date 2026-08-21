/* WHAT IS LEFT ABOARD — derived, never typed.
 *
 * A maintenance event consumes parts. If each event records what it used, then
 * what is left falls out of (last count + received − used since) and cannot
 * drift from the job record the way a separately maintained tally would. One
 * number, two views. There is no `on_hand` column anywhere, on purpose.
 *
 * THIS IS THE FIRST RUNNING BALANCE IN THE APP, and that changes what it owes
 * the reader. Every other figure here is a snapshot — a landing, a reading, a
 * settlement — and a wrong one is wrong on its own. A wrong movement moves
 * every later balance too, so the page has to show the WORKINGS and not just
 * the answer. `balanceOf` therefore returns how it got there, not a number.
 */

/* Ledger order: the date it happened, then the order it was entered.
 *
 * A stock take entered after a use ON THE SAME DAY supersedes it — that is what
 * counting the shelf means. Sorting by date alone would leave it to chance. */
const inOrder = (movements) =>
  [...(movements || [])].sort((a, b) =>
    String(a.moved_on || '').localeCompare(String(b.moved_on || ''))
    || String(a.created_at || '').localeCompare(String(b.created_at || '')))

// What one movement does to the balance. A count is absolute and handled by the
// caller; the rest are relative, and only `adjusted` carries its own sign.
export function effectOf(m) {
  const q = Number(m?.qty)
  if (!Number.isFinite(q)) return 0
  switch (m.kind) {
    case 'received': return Math.abs(q)
    case 'used': return -Math.abs(q)
    case 'adjusted': return q
    default: return 0
  }
}

/* The balance, and how it was reached.
 *
 * `counted` is the part that matters. A part nobody has ever counted has a
 * balance of net movements from an assumed zero, which is very likely wrong —
 * and it must not render the same as a figure resting on a real stock take. The
 * page says which it is looking at.
 */
export function balanceOf(movements, { asOf = null } = {}) {
  const all = inOrder(movements).filter(
    (m) => !asOf || String(m.moved_on || '') <= String(asOf))

  let lastCount = -1
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].kind === 'count') { lastCount = i; break }
  }

  const counted = lastCount >= 0
  const base = counted ? Math.abs(Number(all[lastCount].qty) || 0) : 0
  const since = all.slice(lastCount + 1)

  let received = 0, used = 0, adjusted = 0
  for (const m of since) {
    const e = effectOf(m)
    if (m.kind === 'received') received += e
    else if (m.kind === 'used') used += e
    else if (m.kind === 'adjusted') adjusted += e
  }

  return {
    balance: base + received + used + adjusted,
    counted,
    countedAt: counted ? all[lastCount].moved_on : null,
    countedQty: counted ? base : null,
    received,
    used,           // negative
    adjusted,
    movesSince: since.length,
    // Nothing at all is different again from "counted, and none left".
    empty: all.length === 0,
  }
}

/* The ledger a person reads, newest first, with the balance AFTER each row.
 *
 * Running the balance forward and then reversing is the only way to show what
 * each movement left behind — which is the whole point of showing the workings
 * on a figure that propagates. */
export function ledgerOf(movements) {
  const all = inOrder(movements)
  let bal = 0
  const rows = all.map((m) => {
    bal = m.kind === 'count' ? Math.abs(Number(m.qty) || 0) : bal + effectOf(m)
    return { ...m, effect: m.kind === 'count' ? null : effectOf(m), after: bal }
  })
  return rows.reverse()
}

/* Every part with its balance, for the list. `movements` is the whole fleet's
 * ledger read once — the balances are grouped here rather than asking the
 * database per part, which is the same reason the gear log fetches trip dates
 * once rather than per cell. */
export function stockOf(parts, movements) {
  const byPart = new Map()
  for (const m of movements || []) {
    if (!byPart.has(m.part_id)) byPart.set(m.part_id, [])
    byPart.get(m.part_id).push(m)
  }
  return (parts || []).map((p) => {
    const b = balanceOf(byPart.get(p.id) || [])
    const min = p.min_stock == null || p.min_stock === '' ? null : Number(p.min_stock)
    return {
      part: p,
      ...b,
      min,
      /* Low ONLY where there is something to compare against AND the figure
       * rests on a real count. Calling a part low on the strength of a balance
       * nobody has ever verified is how a reorder list stops being believed. */
      low: min != null && b.counted && b.balance < min,
      unverified: !b.counted && !b.empty,
    }
  })
}

// What a single job consumed, for the maintenance record.
export const partsUsedOn = (movements, eventId) =>
  (movements || []).filter((m) => m.event_id === eventId && m.kind === 'used')
