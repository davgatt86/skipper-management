/* THE GOING-HOME BONUS, HALF ON GOING HOME AND HALF ON RETURN.
 *
 * One function for what each half is worth and whether it is due, because three
 * pages showed it and each worked it out for itself — Contracts, Contract detail
 * and Crew status. The database has its own copy in `bonus_halves_due()`
 * (supabase/bonus_alerts_follow_the_return.sql) for the alerts, and the two have
 * to agree: the whole complaint that started this was an alert saying money was
 * due while the page beside it said "on return".
 *
 * FIVE STATES, and the last two are the ones worth keeping apart:
 *   paid        a payment of that half is on record
 *   due         owed now — he has gone home (first) or come back (second)
 *   at_end      first half, on a contract still running: due when he goes home
 *   on_return   second half, he has gone home and is not back yet
 *   forfeited   he decided not to return. David, Sep 2026: "forfeited outright."
 *
 * PAID IS THE EXISTENCE OF A PAYMENT, NOT A SUM, which is what the page has
 * always shown. Netting a part payment off the total would quietly turn "he was
 * paid £1,000 of £3,500" into "£2,500 due" and lose the fact that the half was
 * never settled.
 */

const round2 = (x) => Math.round(x * 100) / 100

/** The first-half fraction, however the setting is stored (0.5 or 50). */
export function firstHalfFraction(settings) {
  const raw = settings == null ? 0.5 : Number(settings.ghb_first_half_pct)
  if (!Number.isFinite(raw) || raw <= 0) return 0.5
  return raw > 1 ? raw / 100 : raw
}

/** What each half of a bonus is worth. The second half takes the rounding. */
export function bonusHalves(total, settings) {
  const t = Number(total)
  if (!Number.isFinite(t)) return null
  const first = round2(t * firstHalfFraction(settings))
  return { total: t, first, second: round2(t - first) }
}

/* `paid` is { first: boolean, second: boolean } — what the payments table holds
 * for this contract. A contract with no bonus set returns null: not set is not
 * a bonus of nothing, the trap this codebase has hit seven times. */
export function bonusState(contract, paid = {}, settings = null) {
  if (!contract || contract.going_home_bonus == null || contract.going_home_bonus === '') return null
  const halves = bonusHalves(contract.going_home_bonus, settings)
  if (!halves) return null

  const gone = contract.status === 'pending_return' || contract.status === 'completed'
    || contract.status === 'not_returning'
  const back = contract.status === 'completed' && !!contract.return_date

  const first = paid.first ? 'paid' : gone ? 'due' : 'at_end'
  const second = paid.second ? 'paid'
    : contract.status === 'not_returning' ? 'forfeited'
      : back ? 'due' : 'on_return'

  return {
    total: halves.total,
    first: { amount: halves.first, state: first },
    second: { amount: halves.second, state: second },
    dueNow: round2((first === 'due' ? halves.first : 0) + (second === 'due' ? halves.second : 0)),
    forfeited: second === 'forfeited' ? halves.second : 0,
  }
}

/* The words on the row. "on return" and "forfeited" are both unpaid and mean
 * opposite things — one is money still to come, the other is money that will
 * never be paid — so they never share a phrase or a colour. */
export function halfLabel(state) {
  return {
    paid: '✓ paid',
    due: 'due',
    at_end: 'on going home',
    on_return: 'on return',
    forfeited: 'forfeited — did not return',
  }[state] || state
}

export function halfColour(state) {
  return {
    paid: 'var(--kelp)',
    due: 'var(--brass)',
    at_end: 'var(--mute)',
    on_return: 'var(--mute)',
    forfeited: 'var(--rust)',
  }[state] || 'var(--mute)'
}
