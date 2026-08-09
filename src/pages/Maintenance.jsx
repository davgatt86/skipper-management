import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { keepsLogs } from '../lib/roles'
import { useOfflineTable } from '../lib/offline/useOfflineTable'
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

  const [hoursNow, setHoursNow] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(blankTask())
  const [doneFor, setDoneFor] = useState(null)       // task being marked done
  const [doneDraft, setDoneDraft] = useState({ done_on: today(), running_hours: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)

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

  const historyFor = (taskId) =>
    (eventsT.rows || []).filter((e) => e.task_id === taskId)
      .sort((a, b) => String(b.done_on).localeCompare(String(a.done_on)))

  async function saveTask(e) {
    e.preventDefault()
    if (!draft.name.trim()) return
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
    await eventsT.insert({
      task_id: doneFor.id,
      done_on: doneDraft.done_on || today(),
      // Default to the hours off the latest engine log, because that is what
      // "hours since" will measure against later. He can overwrite it.
      running_hours: doneDraft.running_hours === '' ? (hoursNow ?? null) : Number(doneDraft.running_hours),
      done_by: appUser?.display_name || null,
      notes: doneDraft.notes.trim() || null,
    })
    setBusy(false)
    setDoneFor(null); setDoneDraft({ done_on: today(), running_hours: '', notes: '' })
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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy || !draft.name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setEditing(null) }}>Cancel</button>
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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record it'}</button>
              <button type="button" className="secondary" onClick={() => setDoneFor(null)}>Cancel</button>
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
