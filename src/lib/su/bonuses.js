/* ROLE BONUSES ON A SQUARE UP.
 *
 * David, Aug 2026:
 *
 *   skipper   3%
 *   engineer  0.5%
 *   mate      0.25%
 *
 *   "now those bonuses can be shared, for example landing 1 & 2, 2 different
 *    engineers. they get 0.25% each"
 *
 *   "some trips there can be 2 mates landing 1 and 1 mate landing 2. in that
 *    case it would be 2x 0.0625% and 1x 0.125%"
 *
 * THE RULE THAT PRODUCES BOTH OF THOSE, and it is one rule:
 *
 *   a role's rate is split equally across the trip's LANDINGS,
 *   and each landing's share is split equally among the men who held that role
 *   on that landing.
 *
 * Mate on a two-landing trip is 0.125% a landing. Two mates on landing one take
 * 0.0625% each; the single mate on landing two takes the whole 0.125%. Which is
 * exactly what he wrote down.
 *
 * WHAT IS NOT ASSUMED: that every landing had somebody in every role. If a
 * landing has no mate, that landing's share of the mate bonus is UNALLOCATED
 * and is reported as such. Quietly handing it to the other mate would invent a
 * payment nobody agreed, and quietly dropping it would lose it — this is money,
 * and the page can show it and let the skipper decide.
 *
 * The rates are SETTINGS, not law. The market rules and the stores units taught
 * the same lesson: anything the boat might change is the boat's to change,
 * without a deploy.
 */

export const DEFAULT_RATES = {
  skipper: 3,
  engineer: 0.5,
  mate: 0.25,
}

/* The roles that carry a bonus, and what they are called on the page. Keyed to
 * `crew_ranks` codes where one exists, so a man's rank can suggest his role
 * rather than being typed a second time. */
export const BONUS_ROLES = [
  { key: 'skipper', label: 'Skipper', ranks: ['skipper', 'master'] },
  { key: 'engineer', label: 'Engineer', ranks: ['chief_engineer', 'second_engineer'] },
  { key: 'mate', label: 'Mate', ranks: ['mate'] },
]

export const roleForRank = (rankCode) =>
  BONUS_ROLES.find((r) => r.ranks.includes(String(rankCode || '').toLowerCase()))?.key || null

export const roleLabel = (key) => BONUS_ROLES.find((r) => r.key === key)?.label || key

/** Merge a fleet's stored rates over the shipped ones — same shape as the
 *  market rules: a stored row supplies only what it changes. */
export function resolveRates(stored) {
  const out = { ...DEFAULT_RATES }
  for (const [k, v] of Object.entries(stored || {})) {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) out[k] = n
  }
  return out
}

/**
 * Work out each man's bonus.
 *
 * @param assignments [{ id, name, role, landings }]  — `landings` is the list of
 *        landing numbers he held that role on. Omitted or empty means ALL of
 *        them, which is the 99% case and should not need saying.
 * @param landings    how many landings the trip made (at least 1)
 * @param rates       resolved role rates
 */
export function computeBonuses(assignments = [], landings = 1, rates = DEFAULT_RATES) {
  const n = Math.max(1, Math.floor(Number(landings) || 1))
  const all = Array.from({ length: n }, (_, i) => i + 1)

  const held = assignments
    .filter((a) => a.role && rates[a.role] != null)
    .map((a) => ({
      ...a,
      on: (a.landings && a.landings.length ? a.landings : all)
        .map(Number).filter((x) => x >= 1 && x <= n),
    }))

  // For each role and landing, who was on it.
  const perMan = new Map(held.map((a) => [a.id, 0]))
  const unallocated = []

  for (const role of Object.keys(rates)) {
    const rate = Number(rates[role]) || 0
    if (!rate) continue
    const share = rate / n                       // this landing's worth of it
    for (const landing of all) {
      const men = held.filter((a) => a.role === role && a.on.includes(landing))
      if (!men.length) {
        /* NOBODY HELD IT. Reported, never redistributed — handing it to the
           other man would invent a payment nobody agreed. */
        unallocated.push({ role, landing, pct: share })
        continue
      }
      const each = share / men.length
      for (const m of men) perMan.set(m.id, (perMan.get(m.id) || 0) + each)
    }
  }

  const rows = held.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    landings: a.on,
    pct: round(perMan.get(a.id) || 0),
  }))

  return {
    landings: n,
    rows,
    unallocated: unallocated.map((u) => ({ ...u, pct: round(u.pct) })),
    /* What the trip actually pays out, and what it would pay if every landing
       had somebody in every role. The page shows both when they differ. */
    total: round(rows.reduce((s, r) => s + r.pct, 0)),
    expected: round(Object.values(rates).reduce((s, r) => s + (Number(r) || 0), 0)),
  }
}

/* Percentages here go to four places. 0.0625 is a real figure on a real trip —
 * a mate's quarter share of a two-landing trip — so rounding to two would turn
 * it into 0.06 and lose money on every one. */
const round = (v) => Math.round(v * 10000) / 10000

/** How a share reads on the page. Trailing zeros dropped: 0.25%, not 0.2500%. */
export const fmtPct = (v) =>
  (Number(v) || 0).toFixed(4).replace(/\.?0+$/, '') + '%'
