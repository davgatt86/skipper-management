import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { keepsLogs } from '../lib/roles'
import { useOfflineTable } from '../lib/offline/useOfflineTable'
import { Link } from 'react-router-dom'
import { stockOf, partsUsedOn } from '../lib/maintenance/parts'
import { readCache, cacheTable, isOnline, withTimeout } from '../lib/offline/queue'
import SyncStatus from '../components/SyncStatus'
import { maintenanceBoard, SUGGESTED_TASKS } from '../lib/maintenance'

/* The maintenance record.
 *
 * Two things happen here and they are deliberately not the same screen area:
 *   — logging that a job was DONE, which is the daily action and is one tap;
 *   — setting up WHAT this boat tracks, which is done once and then rarely.
 *
 * The list is per fleet and entirely the engineer's: every engine room is
 * different and a fixed list would be wrong on the second boat. Nothing is
 * seeded, but an empty page offers the common items so the first run is one tap
 * rather than twenty.
 *
 * Writes go through the outbox like the other log pages — this gets filled in
 * standing next to the engine, not at a desk.
 */

const today = () => new Date().toISOString().slice(0, 10)
const fmt = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')
const n0 = (v) => (v == null ? '—' : Math.round(Number(v)).toLocaleString('en-GB'))
const blankTask = () => ({ name: '', component: '', interval_days: '', interval_hours: '', notes: '' })

export default function Maintenance() {
  const { appUser } = useAuth()
  const canEdit = keepsLogs(appUser)

  const tasksT = useOfflineTable('maintenance_tasks', { orderBy: 'sort_order', ascending: true, fleetId: appUser?.fleet_id })
  const eventsT = useOfflineTable('maintenance_events', { orderBy: 'done_on', ascending: false, fleetId: appUser?.fleet_id })
  /* THE LAST MILE OF "ONE NUMBER, TWO VIEWS".
   *
   * What a job used is recorded WHERE THE WORK IS RECORDED, in the same action,
   * rather than being entered against the part afterwards. A second trip to a
   * second page is how a ledger goes stale — and a stale ledger is worse than
   * none, because the balance still looks like an answer. */
  const partsT = useOfflineTable('parts', { orderBy: 'name', ascending: true, fleetId: appUser?.fleet_id })
  const movesT = useOfflineTable('parts_movements', { fleetId: appUser?.fleet_id })

  const [hoursNow, setHoursNow] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(blankTask())
  const [doneFor, setDoneFor] = useState(null)       // task being marked done
  const [doneDraft, setDoneDraft] = useState({ done_on: today(), running_hours: '', notes: '' })
  const [used, setUsed] = useState([])          // [{ part_id, qty }] for this job
  const [busy, setBusy] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)
  const [formError, setFormError] = useState('')

  // Running hours from the latest engine log — the second clock on every task.
  useEffect(() => {
    let live = true
    ;(async () => {
      const cached = await readCache('engine_logs')
      let rows = cached.rows
      if (isOnline()) {
        const { data, error } = await withTimeout(
          supabase.from('engine_logs').select('log_date, running_hours').order('log_date', { ascending: false })
        ).catch((e) => ({ data: null, error: e }))
        if (!error && data) { rows = data; cacheTable('engine_logs', data) }
      }
      if (!live) return
      const h = (rows || []).filter((r) => r.running_hours != null)
        .sort((a, b) => String(b.log_date).localeCompare(String(a.log_date)))[0]
      setHoursNow(h ? Number(h.running_hours) : null)
    })()
    return () => { live = false }
  }, [])

  const board = useMemo(
    () => maintenanceBoard(tasksT.rows, eventsT.rows, hoursNow, today()),
    [tasksT.rows, eventsT.rows, hoursNow]
  )

  // Balances read once for the whole fleet, so the picker can show what is
  // actually aboard beside each part rather than asking per row.
  const stock = useMemo(() => stockOf(partsT.rows, movesT.rows), [partsT.rows, movesT.rows])
  const stockFor = (id) => stock.find((s) => s.part.id === id) || null

  const historyFor = (taskId) =>
    (eventsT.rows || []).filter((e) => e.task_id === taskId)
      .sort((a, b) => String(b.done_on).localeCompare(String(a.done_on)))

  async function saveTask(e) {
    e.preventDefault()
    if (!draft.name.trim()) return
    // The table has `check (interval_days > 0)` and the same on hours. Without
    // this a typed 0 would be QUEUED and then refused for good, turning up as a
    // stranded failed entry in the sync strip long after he moved on. Say it
    // here, while he is still looking at the field.
    const bad = (v) => v !== '' && (!Number.isFinite(Number(v)) || Number(v) <= 0)
    if (bad(draft.interval_hours) || bad(draft.interval_days)) {
      setFormError('An interval has to be more than zero. Leave it blank to just track this one without a due date.')
      return
    }
    setFormError('')
    setBusy(true)
    const payload = {
      name: draft.name.trim(),
      component: draft.component.trim() || null,
      interval_days: draft.interval_days === '' ? null : Number(draft.interval_days),
      interval_hours: draft.interval_hours === '' ? null : Number(draft.interval_hours),
      notes: draft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    if (editing) await tasksT.update(editing, payload)
    else await tasksT.insert({ ...payload, sort_order: (tasksT.rows?.length || 0) })
    setBusy(false); setDraft(blankTask()); setAdding(false); setEditing(null)
  }

  async function addSuggested(list) {
    setBusy(true)
    let i = tasksT.rows?.length || 0
    for (const s of list) {
      await tasksT.insert({
        name: s.name, component: s.component || null,
        interval_days: s.interval_days ?? null, interval_hours: s.interval_hours ?? null,
        sort_order: i++,
      })
    }
    setBusy(false); setShowSuggest(false)
  }

  async function markDone(e) {
    e.preventDefault()
    if (!doneFor) return
    setBusy(true)
    /* The event goes in FIRST and its id comes back before it has synced,
     * because the outbox generates ids client-side. That is what makes this
     * work at sea: the movements can name a job that does not exist on the
     * server yet, and replay is strictly in order, so the event always lands
     * before the lines that reference it. */
    const eventId = await eventsT.insert({
      task_id: doneFor.id,
      done_on: doneDraft.done_on || today(),
      // Default to the hours off the latest engine log, because that is what
      // "hours since" will measure against later. He can overwrite it.
      running_hours: doneDraft.running_hours === '' ? (hoursNow ?? null) : Number(doneDraft.running_hours),
      done_by: appUser?.display_name || null,
      notes: doneDraft.notes.trim() || null,
    })

    if (eventId) {
      for (const u of used) {
        const qty = Number(u.qty)
        if (!u.part_id || !Number.isFinite(qty) || qty <= 0) continue
        await movesT.insert({
          fleet_id: appUser.fleet_id,
          part_id: u.part_id,
          kind: 'used',
          qty,
          moved_on: doneDraft.done_on || today(),
          event_id: eventId,
        })
      }
    }

    setBusy(false)
    setDoneFor(null); setUsed([])
    setDoneDraft({ done_on: today(), running_hours: '', notes: '' })
  }

  async function retire(t) {
    if (!confirm(`Stop tracking "${t.name}"? Its history stays on the record.`)) return
    await tasksT.update(t.id, { active: false, updated_at: new Date().toISOString() })
  }

  const label = { display: 'block', marginBottom: '0.6rem' }
  const cap = { fontWeight: 600, marginBottom: '0.2rem', fontSize: '0.85rem' }

  return (
    <AppShell maxWidth={1000}>
      <PageHeader title="Maintenance Record" sub="What this boat services, and when it last was">
        {canEdit && !adding && (
          <button onClick={() => { setDraft(blankTask()); setEditing(null); setAdding(true) }}>+ Add item</button>
        )}
      </PageHeader>

      <SyncStatus
        online={tasksT.online}
        pending={tasksT.pending + eventsT.pending}
        failed={tasksT.failed + eventsT.failed}
        onChange={() => { tasksT.sync(); eventsT.sync() }}
      />

      {(tasksT.error || eventsT.error) && (
        <div className="card" style={{ borderColor: 'var(--rust)' }}>
          <p className="error">{tasksT.error || eventsT.error}</p>
        </div>
      )}

      {/* ---- add / edit an item ---- */}
      {canEdit && adding && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{editing ? 'Edit item' : 'New item'}</h2>
          <form onSubmit={saveTask}>
            <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label style={label}>
                <div style={cap}>What is it</div>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                       placeholder="Fuel filters — primary" />
              </label>
              <label style={label}>
                <div style={cap}>Where (optional)</div>
                <input value={draft.component} onChange={(e) => setDraft({ ...draft, component: e.target.value })}
                       placeholder="Main Engine" />
              </label>
              <label style={label}>
                <div style={cap}>Every … running hours</div>
                <input type="number" min="1" step="1" value={draft.interval_hours}
                       onChange={(e) => setDraft({ ...draft, interval_hours: e.target.value })} placeholder="250" />
              </label>
              <label style={label}>
                <div style={cap}>Every … days</div>
                <input type="number" min="1" step="1" value={draft.interval_days}
                       onChange={(e) => setDraft({ ...draft, interval_days: e.target.value })} placeholder="365" />
              </label>
            </div>
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
              Set either, both or neither. With both, whichever falls due first wins — the way a service
              schedule actually works. With neither, it is simply tracked and you will see the days since.
            </p>
            <label style={label}>
              <div style={cap}>Notes (optional)</div>
              <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                     placeholder="Part number, where they're stowed…" />
            </label>
            {formError && <p className="error" style={{ marginTop: 0 }}>{formError}</p>}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy || !draft.name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setEditing(null); setFormError('') }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ---- mark a job done ---- */}
      {canEdit && doneFor && (
        <div className="card" style={{ borderColor: 'var(--kelp)' }}>
          <h2 style={{ marginTop: 0 }}>{doneFor.name} — done</h2>
          <form onSubmit={markDone}>
            <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label style={label}>
                <div style={cap}>When</div>
                <input type="date" value={doneDraft.done_on}
                       onChange={(e) => setDoneDraft({ ...doneDraft, done_on: e.target.value })} />
              </label>
              <label style={label}>
                <div style={cap}>Running hours</div>
                <input type="number" step="0.1" value={doneDraft.running_hours}
                       onChange={(e) => setDoneDraft({ ...doneDraft, running_hours: e.target.value })}
                       placeholder={hoursNow != null ? String(hoursNow) : 'unknown'} />
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  {hoursNow != null
                    ? `Leave blank to use ${n0(hoursNow)} from the latest engine log.`
                    : 'No hours in the engine log yet — leave blank if you do not know.'}
                </div>
              </label>
            </div>
            <label style={label}>
              <div style={cap}>Notes (optional)</div>
              <input value={doneDraft.notes} onChange={(e) => setDoneDraft({ ...doneDraft, notes: e.target.value })}
                     placeholder="What was fitted, anything found…" />
            </label>
            <UsedParts
              parts={partsT.rows} stockFor={stockFor}
              used={used} setUsed={setUsed}
              component={doneFor.component}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record it'}</button>
              <button type="button" className="secondary" onClick={() => { setDoneFor(null); setUsed([]) }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ---- empty state: offer the common items ---- */}
      {!tasksT.loading && board.length === 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Nothing tracked yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Add what this boat services — oil changes, filters, impellers, anodes — and every one will show
            how long since it was last done, in days and in running hours.
          </p>
          {canEdit && (
            <>
              <button className="secondary" onClick={() => setShowSuggest((s) => !s)}>
                {showSuggest ? 'Hide the common list' : 'Start from a common list'}
              </button>
              {showSuggest && (
                <div style={{ marginTop: '0.75rem' }}>
                  <p className="muted" style={{ fontSize: '0.85rem' }}>
                    A starting point, not a rule — the intervals are the usual ones and are meant to be
                    edited. Add the lot and delete what does not apply, or add your own instead.
                  </p>
                  <ul style={{ margin: '0 0 0.75rem 1rem', fontSize: '0.88rem' }}>
                    {SUGGESTED_TASKS.map((s) => (
                      <li key={s.name}>
                        {s.name}
                        <span className="muted">
                          {s.interval_hours ? ` · every ${s.interval_hours} h` : ''}
                          {s.interval_days ? ` · every ${s.interval_days} days` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button disabled={busy} onClick={() => addSuggested(SUGGESTED_TASKS)}>
                    {busy ? 'Adding…' : `Add all ${SUGGESTED_TASKS.length}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---- the record ---- */}
      {board.map((b) => {
        const hist = historyFor(b.task.id)
        return (
          <div key={b.task.id} className="card" style={{ borderLeft: `3px solid ${b.status.color}` }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem', flex: '1 1 12rem' }}>
                {b.task.name}
                {b.task._pending && <span style={{ color: 'var(--brass)', fontSize: '0.7rem' }}> not sent</span>}
              </h2>
              <span style={{ color: b.status.color, fontWeight: 700, fontSize: '0.85rem' }}>{b.status.label}</span>
            </div>

            {b.task.component && <div className="muted" style={{ fontSize: '0.8rem' }}>{b.task.component}</div>}

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', margin: '0.6rem 0' }}>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Days since</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                  {b.days == null ? '—' : b.days}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Hours since</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                  {b.hours == null ? '—' : n0(b.hours)}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Interval</div>
                <div style={{ fontSize: '0.95rem', paddingTop: '0.3rem' }}>
                  {b.task.interval_hours ? `${n0(b.task.interval_hours)} h` : ''}
                  {b.task.interval_hours && b.task.interval_days ? ' or ' : ''}
                  {b.task.interval_days ? `${b.task.interval_days} days` : ''}
                  {!b.task.interval_hours && !b.task.interval_days && <span className="muted">tracked only</span>}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Last done</div>
                <div style={{ fontSize: '0.95rem', paddingTop: '0.3rem' }}>{fmt(b.lastEvent?.done_on)}</div>
              </div>
            </div>

            {b.task.notes && <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>{b.task.notes}</p>}

            {canEdit && (
              <div className="no-print" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button onClick={() => { setDoneFor(b.task); setDoneDraft({ done_on: today(), running_hours: '', notes: '' }) }}>
                  Mark done
                </button>
                <button className="secondary" style={{ fontSize: '0.8rem' }}
                        onClick={() => {
                          setEditing(b.task.id)
                          setDraft({
                            name: b.task.name || '', component: b.task.component || '',
                            interval_days: b.task.interval_days ?? '', interval_hours: b.task.interval_hours ?? '',
                            notes: b.task.notes || '',
                          })
                          setAdding(true)
                        }}>Edit</button>
                <button className="secondary" style={{ fontSize: '0.8rem' }} onClick={() => retire(b.task)}>Stop tracking</button>
              </div>
            )}

            {hist.length > 0 && (
              <details style={{ marginTop: '0.6rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                  History — {hist.length} {hist.length === 1 ? 'entry' : 'entries'}
                </summary>
                <div style={{ marginTop: '0.4rem' }}>
                  {hist.map((h) => (
                    <div key={h.id} style={{ fontSize: '0.85rem', padding: '0.3rem 0', borderTop: '1px solid var(--border)' }}>
                      <strong style={{ fontFamily: 'var(--font-mono, monospace)' }}>{fmt(h.done_on)}</strong>
                      {h.running_hours != null && <span className="muted"> · {n0(h.running_hours)} h</span>}
                      {h.done_by && <span className="muted"> · {h.done_by}</span>}
                      {h._pending && <span style={{ color: 'var(--brass)' }}> · not sent</span>}
                      {h.notes && <div className="muted">{h.notes}</div>}
                      {/* What the job consumed, read back from the same ledger
                          the balance comes from — not a second copy. */}
                      {partsUsedOn(movesT.rows, h.id).length > 0 && (
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          used:{' '}
                          {partsUsedOn(movesT.rows, h.id).map((m) => {
                            const st = stockFor(m.part_id)
                            return `${Number(m.qty)} × ${st?.part.name || 'part'}`
                          }).join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )
      })}
    </AppShell>
  )
}

/* WHAT THE JOB USED.
 *
 * Recorded here, with the job, in the same action — not entered against the
 * part on another page afterwards. That second trip is how a ledger goes stale,
 * and a stale ledger is worse than none because the balance still looks like an
 * answer.
 *
 * Each row shows what is ABOARD beside the part, because the man filling this
 * in is deciding whether he has enough, and telling him afterwards is too late.
 */
function UsedParts({ parts, stockFor, used, setUsed, component }) {
  const live = (parts || []).filter((p) => p.active !== false)

  // The job's own component first — an impeller change wants the impellers, not
  // an alphabetical list of everything the boat carries.
  const ordered = [...live].sort((a, b) => {
    const am = component && a.component === component ? 0 : 1
    const bm = component && b.component === component ? 0 : 1
    return am - bm || String(a.name).localeCompare(String(b.name))
  })

  const setRow = (i, patch) =>
    setUsed(used.map((u, n) => (n === i ? { ...u, ...patch } : u)))

  if (!live.length) {
    return (
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        No parts on record yet — add them on <Link to="/parts">Parts</Link> and they can be
        booked out against a job from here.
      </p>
    )
  }

  return (
    <div style={{ margin: '0.6rem 0' }}>
      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: 'var(--mute)', marginBottom: '0.3rem' }}>
        Parts used (optional)
      </div>

      {used.map((u, i) => {
        const st = u.part_id ? stockFor(u.part_id) : null
        const qty = Number(u.qty)
        // Information, never a block. Recording what actually happened matters
        // more than keeping the balance tidy — if it goes negative, the count
        // was wrong, and that is worth knowing rather than hiding.
        const over = st && st.counted && Number.isFinite(qty) && qty > st.balance
        return (
          <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center',
                                flexWrap: 'wrap', padding: '0.15rem 0' }}>
            <select value={u.part_id} onChange={(e) => setRow(i, { part_id: e.target.value })}
                    style={{ flex: '1 1 12rem', maxWidth: 280 }}>
              <option value="">— pick a part —</option>
              {ordered.map((p) => {
                const s = stockFor(p.id)
                const aboard = s?.empty ? 'none recorded' : s?.counted ? `${s.balance} aboard` : `${s?.balance} unverified`
                return <option key={p.id} value={p.id}>{p.name} — {aboard}</option>
              })}
            </select>
            <input type="number" min="0" step="any" value={u.qty} placeholder="qty"
                   onChange={(e) => setRow(i, { qty: e.target.value })}
                   style={{ width: 80, textAlign: 'right' }} />
            {st && !st.empty && (
              <span className="muted" style={{ fontSize: '0.76rem' }}>
                {st.counted ? `${st.balance} aboard` : `${st.balance}, never counted`}
                {over && <strong style={{ color: 'var(--brass)' }}> — more than the books show</strong>}
              </span>
            )}
            <button type="button" className="secondary"
                    style={{ padding: '0.05rem 0.45rem', color: 'var(--rust)' }}
                    onClick={() => setUsed(used.filter((_, n) => n !== i))}>×</button>
          </div>
        )
      })}

      <button type="button" className="secondary"
              style={{ padding: '0.1rem 0.5rem', fontSize: '0.85rem' }}
              onClick={() => setUsed([...used, { part_id: '', qty: '' }])}>
        {used.length ? 'Another part' : 'Add a part used'}
      </button>
    </div>
  )
}
