/* WHAT THIS ENGINE ACTUALLY DOES, and what is merely unusual.
 *
 * TWO CHECKS, AND THEY ARE NOT THE SAME THING.
 *
 *   RANGE — the reading is outside what this engine does. Stated by the man who
 *           knows it. Either a mis-key or a genuine fault, and both want
 *           looking at before the entry is saved.
 *   DRIFT — the reading is well off its own recent average but still inside the
 *           range. Nothing is wrong; something is moving. Worth saying, worth
 *           never blocking on.
 *
 * WHY HISTORY CANNOT BE THE AUTHORITY, which is the whole reason this file
 * exists. The page used to check drift alone. Gearbox 1 Oil Press read
 * 28, 28, 2.8, 2.8, 38, 25, 38 — two of seven entries on the wrong scale — and
 * the median was 28, so the drift check called the CORRECT readings outliers.
 * An engineer trusting it would have "fixed" the good data into the bad.
 * David settled it 21-08-2026: the gauge runs 25–38.
 *
 * So the range is stated and the average only ever comments.
 */

export const DRIFT_PCT = 0.6      // how far off its own mean before drift is worth a word
export const MIN_HISTORY = 3      // below this there is no meaningful average

export const limitKey = (group, param) => `${group}||${param}`

export const limitFor = (limits, group, param) =>
  (limits || []).find((l) => l.group_key === group && l.param_key === param) || null

/* Is this reading outside the stated range?
 *
 * A limit with neither bound, or one that is disabled, or one on a counter,
 * checks nothing — and returns null rather than a passing verdict, so the
 * caller can tell "inside the range" from "there is no range".
 */
export function checkRange(value, limit) {
  /* BLANK IS NOT ZERO. Number('') is 0 and Number.isFinite(0) is true, so
   * without this an empty box reports as a reading of nought and breaches every
   * floor on the form — an engineer would be warned about pressures he simply
   * had not written down yet. Third time this exact trap has bitten in this
   * codebase, after the maintenance running hours and the gear measurements. */
  if (value === null || value === undefined || String(value).trim() === '') return null
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  if (!limit || !limit.enabled || limit.is_counter) return null
  const min = limit.min_val == null ? null : Number(limit.min_val)
  const max = limit.max_val == null ? null : Number(limit.max_val)
  if (min == null && max == null) return null
  if (min != null && v < min) return { side: 'under', value: v, min, max, limit }
  if (max != null && v > max) return { side: 'over', value: v, min, max, limit }
  return { side: 'in', value: v, min, max, limit }
}

/* Everything worth saying about one set of readings, worst first.
 *
 * A range breach outranks a drift note on the same parameter, and the drift
 * note is dropped in that case — telling a man his reading is both out of range
 * AND unusual is one fact wearing two hats.
 */
export function checkReadings(readings, limits, priorLogs) {
  const found = []
  for (const group of Object.keys(readings || {})) {
    for (const param of Object.keys(readings[group] || {})) {
      const v = Number(readings[group][param])
      if (!Number.isFinite(v)) continue

      const range = checkRange(v, limitFor(limits, group, param))
      if (range && range.side !== 'in') {
        found.push({ kind: 'range', group, param, ...range })
        continue
      }

      // Drift, only where there is no range breach to report.
      const hist = (priorLogs || [])
        .map((l) => Number(l.readings?.[group]?.[param]))
        .filter((n) => Number.isFinite(n))
      if (hist.length < MIN_HISTORY) continue
      const avg = hist.reduce((a, b) => a + b, 0) / hist.length
      if (!avg) continue
      // A counter climbs by design; drift on it is not information.
      const lim = limitFor(limits, group, param)
      if (lim?.is_counter) continue
      const off = Math.abs(v - avg) / Math.abs(avg)
      if (off > DRIFT_PCT) {
        found.push({
          kind: 'drift', group, param, value: v,
          avg: Math.round(avg * 100) / 100,
          times: Math.round((v / avg) * 10) / 10,
          // A range that has been CONFIRMED and which this reading sits inside
          // makes the drift note weaker still — it is unusual but allowed.
          insideStatedRange: !!(lim && lim.confirmed && checkRange(v, lim)?.side === 'in'),
        })
      }
    }
  }
  return found.sort((a, b) => (a.kind === 'range' ? -1 : 1) - (b.kind === 'range' ? -1 : 1))
}

/* A COUNTER, detected from the data rather than guessed from the name.
 *
 * Running hours and oil added only ever climb, so a range on them means
 * nothing. Reading that off the series is honest; matching on the word "hours"
 * would be another guess of the kind this file exists to stop.
 */
export function isCounter(values) {
  const v = (values || []).filter((n) => Number.isFinite(n))
  if (v.length < 4) return false
  const rise = v[v.length - 1] - v[0]
  if (rise <= 0) return false

  /* A COUNTER COUNTS, so it rarely reads the same twice. Gearbox PTO 3 bearing
   * temperature sat at 54 for fourteen readings and happened to finish at 58 —
   * net progress, hardly any dips, and obviously not a counter. Running hours
   * are all but perfectly distinct. This is the cheapest thing that separates
   * them, and it does the work no amount of tuning the dip rules could. */
  if (new Set(v).size / v.length < 0.7) return false

  let back = 0, backSum = 0
  for (let i = 1; i < v.length; i++) {
    if (v[i] < v[i - 1]) { back++; backSum += v[i - 1] - v[i] }
  }
  if (back === 0) return true

  /* A MINORITY OF BACKWARD STEPS IS A BAD ENTRY, NOT A DIFFERENT KIND OF
   * PARAMETER — but the tolerance has to be earned, and getting this wrong
   * cost two goes.
   *
   * Demanding a perfect climb, Main Engine 1 running hours came back "not a
   * counter" over 19 readings because ONE (30-07-2026) was a duplicate of an
   * earlier day. It got a numeric range instead, so the reversal check never
   * ran on it — the bad entry was hiding the one test that proves it wrong.
   *
   * Allowing a flat fifth of backward steps then went too far the other way:
   * gearbox oil pressure, jacket water temperature and start air pressure all
   * passed as counters on seven readings with one dip each.
   *
   * WHAT ACTUALLY SEPARATES THEM is that a counter makes net progress its dips
   * cannot account for. Running hours climb 1,948 with one 872 dip. Gearbox oil
   * pressure climbs 10 across its whole history and dips 13 — it is wandering,
   * not counting. And a reversal is only dismissible on a decent run: with four
   * readings you cannot tell a mis-key from the shape of the thing. */
  if (v.length < 6) return false
  if (back / (v.length - 1) > 0.2) return false
  return backSum < rise
}

/* A COUNTER THAT WENT BACKWARDS.
 *
 * The most reliable signal in the whole log, and it needs no limit at all:
 * running hours only climb, so a reading below the one before it is wrong, full
 * stop. No range to argue about and no average to be fooled by.
 *
 * It found a real one immediately. Main Engine 1 running hours read 66,796 on
 * 17-07-2026, then 65,924 on 30-07, then 67,105 on 31-07 — and the whole 30-07
 * block is an exact copy of 09-06's, down to the exhaust temperatures. A range
 * check would never have caught it: every individual figure is perfectly
 * ordinary, and it is only wrong in relation to the one before.
 */
export function counterReversals(logs, limits) {
  const ordered = [...(logs || [])].sort(
    (a, b) => String(a.log_date || '').localeCompare(String(b.log_date || '')))
  const last = new Map()
  const out = []

  for (const l of ordered) {
    for (const group of Object.keys(l.readings || {})) {
      for (const param of Object.keys(l.readings[group] || {})) {
        const lim = limitFor(limits, group, param)
        if (!lim?.is_counter) continue
        const v = Number(l.readings[group][param])
        if (!Number.isFinite(v)) continue
        const k = limitKey(group, param)
        const prev = last.get(k)
        if (prev && v < prev.value) {
          out.push({
            kind: 'reversal', group, param,
            value: v, previous: prev.value,
            on: l.log_date, previousOn: prev.on,
            back: Math.round((prev.value - v) * 100) / 100,
          })
        }
        // Only advance on a forward step, so one bad entry does not make every
        // good reading after it look like a second reversal.
        if (!prev || v >= prev.value) last.set(k, { value: v, on: l.log_date })
      }
    }
  }
  return out
}

/* SEED A SUGGESTION FROM THE HISTORY — and it is a suggestion, not an answer.
 *
 * The range is the observed span with a margin, because an engine that has run
 * between 4.2 and 5.0 bar will one day run at 4.1 without anything being wrong,
 * and a limit that cries at the first ordinary reading gets switched off.
 *
 * Everything seeded comes back `confirmed: false`. The page shows what is still
 * only a suggestion, and an engineer confirming a range is what turns it into
 * the authority. Same shape as the stores units.
 */
export function seedLimits(logs, { minReadings = 5, margin = 0.15 } = {}) {
  const series = new Map()
  const ordered = [...(logs || [])].sort(
    (a, b) => String(a.log_date || '').localeCompare(String(b.log_date || '')))

  for (const l of ordered) {
    for (const group of Object.keys(l.readings || {})) {
      for (const param of Object.keys(l.readings[group] || {})) {
        const n = Number(l.readings[group][param])
        if (!Number.isFinite(n)) continue
        const k = limitKey(group, param)
        if (!series.has(k)) series.set(k, { group, param, values: [] })
        series.get(k).values.push(n)
      }
    }
  }

  const out = []
  for (const { group, param, values } of series.values()) {
    if (values.length < minReadings) continue
    const counter = isCounter(values)
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const span = hi - lo
    // A parameter that has never moved gets its margin off the value itself,
    // or the range would be a single point that the next reading breaks.
    const pad = (span || Math.abs(hi) || 1) * margin
    out.push({
      group_key: group,
      param_key: param,
      min_val: counter ? null : round2(lo - pad),
      max_val: counter ? null : round2(hi + pad),
      is_counter: counter,
      enabled: !counter,
      confirmed: false,
      source: 'seeded',
      n: values.length,
      observed: [round2(lo), round2(hi)],
    })
  }
  return out.sort((a, b) => a.group_key.localeCompare(b.group_key)
    || a.param_key.localeCompare(b.param_key))
}

const round2 = (n) => Math.round(n * 100) / 100
