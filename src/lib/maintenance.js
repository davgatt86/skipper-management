/* Working out what is due, and how overdue.
 *
 * Kept pure and separate from the page because this is the arithmetic the
 * engineer actually acts on — "the filters are 40 hours past due" is a decision
 * to stop and change them. A quiet mistake here is worse than a wrong figure on
 * a sales page.
 *
 * TWO CLOCKS, AND EITHER CAN RING FIRST. Marine service intervals are quoted in
 * running hours OR in months, and practice is whichever comes first. So a task
 * may carry both, either, or neither, and the status is the worse of the two.
 * A task with neither interval is TRACKED, not chased — that is the right
 * default for something a man wants to keep an eye on without being nagged.
 */

export const DAY = 86400000

export function daysBetween(a, b) {
  if (!a || !b) return null
  const d1 = new Date(String(a).slice(0, 10) + 'T00:00:00')
  const d2 = new Date(String(b).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d1) || Number.isNaN(d2)) return null
  return Math.round((d2 - d1) / DAY)
}

export const STATUS = {
  overdue: { key: 'overdue', label: 'Overdue', color: 'var(--rust)', rank: 0 },
  due: { key: 'due', label: 'Due soon', color: 'var(--brass)', rank: 1 },
  ok: { key: 'ok', label: 'In date', color: 'var(--kelp)', rank: 2 },
  tracked: { key: 'tracked', label: 'Tracked', color: 'var(--mute, var(--grey-400))', rank: 3 },
  never: { key: 'never', label: 'Never recorded', color: 'var(--brass)', rank: 1 },
}

/* One task, with its last event and the current running hours, worked out.
 *
 * `hoursNow` comes from the latest engine log. It is often missing — a boat
 * that has not logged hours recently, or a task on gear with no hour meter —
 * and when it is, the hours clock is simply not reported rather than guessed
 * at. Reporting "0 hours since" for an unknown would be a lie the engineer
 * might act on. */
// `Number(null)` is 0 and `Number.isFinite(0)` is true, so a plain Number()
// check treats "we don't know the running hours" as "zero hours". That reported
// 0 HOURS SINCE against a task nobody had touched — which an engineer would
// read as just done. Blank must stay blank all the way through.
const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))

export function taskStatus(task, lastEvent, hoursNow, today = new Date().toISOString().slice(0, 10)) {
  const days = lastEvent ? daysBetween(lastEvent.done_on, today) : null
  const then = lastEvent ? numOrNull(lastEvent.running_hours) : null
  const now = numOrNull(hoursNow)
  const hours = then != null && now != null ? Math.max(0, now - then) : null

  const out = {
    task, lastEvent, days, hours,
    daysLeft: null, hoursLeft: null,
    status: lastEvent ? STATUS.tracked : STATUS.never,
  }
  if (!lastEvent) return out

  const clocks = []
  if (task.interval_days && days != null) {
    out.daysLeft = task.interval_days - days
    clocks.push(out.daysLeft / task.interval_days)
  }
  if (task.interval_hours && hours != null) {
    out.hoursLeft = Number(task.interval_hours) - hours
    clocks.push(out.hoursLeft / Number(task.interval_hours))
  }
  if (!clocks.length) return out                 // tracked only, no interval

  // The worse of the two clocks wins — whichever comes first, as in practice.
  const worst = Math.min(...clocks)
  out.status = worst < 0 ? STATUS.overdue : worst <= 0.15 ? STATUS.due : STATUS.ok
  return out
}

/* Every task, worst first. The engineer opens this page to find out what needs
 * doing, so what needs doing has to be at the top — not in date order. */
export function maintenanceBoard(tasks, events, hoursNow, today) {
  const lastByTask = {}
  for (const e of events || []) {
    const cur = lastByTask[e.task_id]
    if (!cur || String(e.done_on) > String(cur.done_on)) lastByTask[e.task_id] = e
  }
  return (tasks || [])
    .filter((t) => t.active !== false)
    .map((t) => taskStatus(t, lastByTask[t.id] || null, hoursNow, today))
    .sort((a, b) =>
      a.status.rank - b.status.rank ||
      (b.days ?? -1) - (a.days ?? -1) ||
      String(a.task.name).localeCompare(String(b.task.name))
    )
}

/* Common engine-room jobs, offered on an empty page so the first run is one tap
 * rather than twenty. Deliberately a SUGGESTION and not a seed: every engine
 * room differs, and a fixed list would be wrong on the second boat. Intervals
 * are the usual starting points, meant to be edited. */
export const SUGGESTED_TASKS = [
  { name: 'Main engine lube oil change', component: 'Main Engine', interval_hours: 500 },
  { name: 'Main engine oil filters', component: 'Main Engine', interval_hours: 500 },
  { name: 'Fuel filters — primary', component: 'Main Engine', interval_hours: 250 },
  { name: 'Fuel filters — secondary', component: 'Main Engine', interval_hours: 500 },
  { name: 'Air filters', component: 'Main Engine', interval_hours: 1000 },
  { name: 'Sea water pump impeller', component: 'Cooling', interval_days: 365 },
  { name: 'Fresh water pump service', component: 'Cooling', interval_hours: 2000 },
  { name: 'Coolant change', component: 'Cooling', interval_days: 730 },
  { name: 'Generator 1 oil and filters', component: 'Generator 1', interval_hours: 250 },
  { name: 'Generator 2 oil and filters', component: 'Generator 2', interval_hours: 250 },
  { name: 'Gearbox oil change', component: 'Gearbox', interval_hours: 2000 },
  { name: 'Hydraulic oil filter', component: 'Hydraulics', interval_hours: 1000 },
  { name: 'Anodes checked', component: 'Hull', interval_days: 180 },
  { name: 'Stern gland / seal', component: 'Shaft', interval_days: 365 },
]
