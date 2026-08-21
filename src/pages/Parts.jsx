import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { keepsLogs } from '../lib/roles'
import { supabase } from '../supabaseClient'
import { useOfflineTable } from '../lib/offline/useOfflineTable'
import SyncStatus from '../components/SyncStatus'
import { stockOf, ledgerOf, balanceOf } from '../lib/maintenance/parts'

/* PARTS INVENTORY — what a job used, and what is left aboard.
 *
 * THE STOCK FIGURE IS DERIVED, NEVER TYPED. There is no "on hand" field to
 * edit anywhere on this page. A maintenance event consumes parts; what is left
 * falls out of (last count + received − used since), so it cannot drift from
 * the job record the way a separately kept tally would.
 *
 * THIS IS THE FIRST RUNNING BALANCE IN THE APP, and that changes what the page
 * owes the reader. Every other figure here is a snapshot — a landing, a
 * reading — and a wrong one is wrong on its own. A wrong movement moves every
 * later balance too. So the workings are on the page, not behind it: each part
 * says what it was counted at, what has moved since, and every row of the
 * ledger shows the balance it left behind.
 *
 * And three states that must never render alike:
 *   counted, and the figure rests on a real stock take
 *   never counted — net movements from an assumed zero, very likely wrong
 *   nothing recorded at all
 */

const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

const KIND_WORD = {
  count: 'counted', received: 'came aboard', used: 'used on a job', adjusted: 'adjusted',
}

export default function Parts() {
  const { appUser } = useAuth()
  // The officer holds the part, so he corrects the count. If that needed a
  // skipper login the miscount would simply stay.
  const canEdit = keepsLogs(appUser)

  const partsT = useOfflineTable('parts', { orderBy: 'name', ascending: true, fleetId: appUser?.fleet_id })
  const movesT = useOfflineTable('parts_movements', { fleetId: appUser?.fleet_id })
  const [tasks, setTasks] = useState([])
  const [events, setEvents] = useState([])
  const [open, setOpen] = useState('')
  const [q, setQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [msg, setMsg] = useState('')

  const err = partsT.error || movesT.error

  useEffect(() => {
    supabase.from('maintenance_tasks').select('id, name, component').then(({ data }) => setTasks(data || []))
    supabase.from('maintenance_events').select('id, task_id, done_on')
      .order('done_on', { ascending: false }).limit(50)
      .then(({ data }) => setEvents(data || []))
  }, [])

  const stock = useMemo(
    () => stockOf(partsT.rows, movesT.rows), [partsT.rows, movesT.rows])

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => stock.filter((s) =>
    !needle
    || s.part.name.toLowerCase().includes(needle)
    || (s.part.part_number || '').toLowerCase().includes(needle)
    || (s.part.component || '').toLowerCase().includes(needle)), [stock, needle])

  const low = stock.filter((s) => s.low)
  const unverified = stock.filter((s) => s.unverified)

  async function addPart(fields) {
    if (!canEdit) return
    const id = await partsT.insert({ fleet_id: appUser.fleet_id, ...fields })
    if (id) { setOpen(id); setShowAdd(false); setMsg(`${fields.name} added.`) }
  }

  async function move(part, kind, qty, movedOn, notes, eventId) {
    if (!canEdit) return
    const n = Number(qty)
    if (!Number.isFinite(n) || (kind !== 'adjusted' && n <= 0) || (kind === 'adjusted' && n === 0)) return
    await movesT.insert({
      fleet_id: appUser.fleet_id, part_id: part.id, kind,
      qty: kind === 'adjusted' ? n : Math.abs(n),
      moved_on: movedOn || today(),
      event_id: eventId || null,
      notes: notes?.trim() || null,
      moved_by: (await supabase.auth.getUser()).data?.user?.id ?? null,
    })
    setMsg(`${part.name}: ${KIND_WORD[kind]}.`)
  }

  if (!canEdit && appUser?.role !== 'viewer' && appUser?.role !== 'skipper') {
    return <AppShell><div className="card"><p className="muted">Not available on your login.</p></div></AppShell>
  }

  const openPart = stock.find((s) => s.part.id === open) || null

  return (
    <AppShell>
      <PageHeader title="Parts" sub="What a job used, and what is left aboard">
        <Link to="/maintenance"><button className="secondary">Maintenance</button></Link>
        {canEdit && <button onClick={() => setShowAdd((v) => !v)}>{showAdd ? 'Cancel' : 'Add a part'}</button>}
      </PageHeader>

      <SyncStatus online={partsT.online} pending={partsT.pending} failed={partsT.failed}
                  onChange={() => { partsT.sync(); movesT.sync() }} />

      {err && <div className="card" style={{ borderColor: 'var(--rust)' }}>
        <p className="error" style={{ margin: 0 }}>{err}</p></div>}
      {msg && <div className="card" style={{ borderColor: 'var(--kelp)' }}>
        <p style={{ margin: 0, fontSize: '0.9rem' }}>{msg}</p></div>}

      {showAdd && canEdit && <AddPart tasks={tasks} onAdd={addPart} />}

      {!partsT.rows.length && !partsT.loading && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No parts on record</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
            Add the spares this engine room carries. There is no starting list on purpose —
            impellers and injectors are for <em>this</em> engine in <em>this</em> boat&rsquo;s part
            numbers, and a guessed list would look like a starting point and be wrong.
          </p>
        </div>
      )}

      {/* What needs doing about it, before the list of everything. */}
      {(low.length > 0 || unverified.length > 0) && (
        <div className="card" style={{ borderColor: low.length ? 'var(--rust)' : 'var(--brass)' }}>
          {low.length > 0 && (
            <p style={{ margin: '0 0 0.3rem', fontSize: '0.9rem' }}>
              <strong>{low.length} below what you want aboard:</strong>{' '}
              {low.map((s) => `${s.part.name} (${s.balance} of ${s.min})`).join(' · ')}
            </p>
          )}
          {unverified.length > 0 && (
            /* Never counted is NOT the same as low, and must not be dressed up
               as it. A balance nobody has verified is a guess with a number on
               it — calling those parts short is how a reorder list stops being
               believed. */
            <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
              {unverified.length} {unverified.length === 1 ? 'part has' : 'parts have'} never been
              counted, so {unverified.length === 1 ? 'its figure is' : 'their figures are'} movements
              from an assumed nought and may be wrong: {unverified.map((s) => s.part.name).join(' · ')}.
              Count {unverified.length === 1 ? 'it' : 'them'} once and the balance stands on something.
            </p>
          )}
        </div>
      )}

      {partsT.rows.length > 0 && (
        <div className="card">
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Search by part, number or component…" style={{ width: '100%', marginBottom: '0.6rem' }} />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>Part</th>
                  <th style={{ ...TH, textAlign: 'left' }}>Component</th>
                  <th style={TH}>Aboard</th>
                  <th style={TH}>Want</th>
                  <th style={{ ...TH, textAlign: 'left' }}>Resting on</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.part.id} style={{ opacity: s.part.active === false ? 0.5 : 1 }}>
                    <td style={{ ...TD, textAlign: 'left' }}>
                      <button className="secondary" style={{ ...SM, textAlign: 'left' }}
                              onClick={() => setOpen(open === s.part.id ? '' : s.part.id)}>
                        {s.part.name}
                      </button>
                      {s.part.part_number && (
                        <div className="muted" style={{ fontSize: '0.7rem' }}>{s.part.part_number}</div>
                      )}
                    </td>
                    <td style={{ ...TD, textAlign: 'left' }} className="muted">{s.part.component || '—'}</td>
                    <td style={{ ...TD, ...MONO,
                                 color: s.low ? 'var(--rust)' : s.unverified ? 'var(--brass)' : 'var(--ink)' }}>
                      {s.empty ? '—' : s.balance}
                    </td>
                    <td style={{ ...TD, ...MONO }} className="muted">{s.min ?? '—'}</td>
                    {/* THE BASIS, on every row. A figure resting on a stock take
                        and one resting on nothing must not look alike. */}
                    <td style={{ ...TD, textAlign: 'left', fontSize: '0.76rem' }} className="muted">
                      {s.empty ? 'nothing recorded'
                        : s.counted
                          ? `counted ${s.countedQty} on ${fmtDate(s.countedAt)}${s.movesSince ? `, ${s.movesSince} since` : ''}`
                          : 'never counted'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openPart && (
        <PartDetail
          stock={openPart} movements={movesT.rows.filter((m) => m.part_id === openPart.part.id)}
          tasks={tasks} events={events} canEdit={canEdit}
          onClose={() => setOpen('')}
          onMove={move}
          onPatch={(fields) => partsT.update(openPart.part.id, { ...fields, updated_at: new Date().toISOString() })}
        />
      )}
    </AppShell>
  )
}

function AddPart({ tasks, onAdd }) {
  const [f, setF] = useState({ name: '', part_number: '', component: '', unit: 'each', min_stock: '' })
  const components = [...new Set(tasks.map((t) => t.component).filter(Boolean))].sort()
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={LBL}><span className="muted" style={CAP}>Part</span>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
                 placeholder="Impeller, fuel filter…" style={{ width: 190 }} /></label>
        <label style={LBL}><span className="muted" style={CAP}>Part number</span>
          <input value={f.part_number} onChange={(e) => setF({ ...f, part_number: e.target.value })}
                 style={{ width: 140 }} /></label>
        <label style={LBL}><span className="muted" style={CAP}>Component</span>
          {/* Offered from the maintenance tasks, so the two books use the same
              words rather than drifting into "Main Engine" and "ME1". */}
          <input list="parts-components" value={f.component}
                 onChange={(e) => setF({ ...f, component: e.target.value })} style={{ width: 160 }} />
          <datalist id="parts-components">
            {components.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label style={LBL}><span className="muted" style={CAP}>Unit</span>
          <input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}
                 style={{ width: 90 }} /></label>
        <label style={LBL}><span className="muted" style={CAP}>Want aboard</span>
          <input type="number" min="0" value={f.min_stock} placeholder="—"
                 onChange={(e) => setF({ ...f, min_stock: e.target.value })} style={{ width: 100 }} /></label>
        <button disabled={!f.name.trim()}
                onClick={() => onAdd({
                  ...f, name: f.name.trim(),
                  part_number: f.part_number.trim() || null,
                  component: f.component.trim() || null,
                  min_stock: f.min_stock === '' ? null : Number(f.min_stock),
                })}>Add</button>
      </div>
    </div>
  )
}

function PartDetail({ stock, movements, tasks, events, canEdit, onClose, onMove, onPatch }) {
  const { part } = stock
  const rows = ledgerOf(movements)
  const taskName = (id) => tasks.find((t) => t.id === id)?.name || 'a job'
  const eventLabel = (id) => {
    const e = events.find((x) => x.id === id)
    return e ? `${taskName(e.task_id)}, ${fmtDate(e.done_on)}` : 'a job'
  }

  return (
    <div className="card" style={{ borderColor: 'var(--hull)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>{part.name}</h3>
          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>
            {[part.part_number, part.component].filter(Boolean).join(' · ') || 'no part number on file'}
          </p>
        </div>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>

      {/* THE WORKINGS, spelt out. On a running balance the answer alone is not
          enough — the reader has to be able to see where it came from. */}
      <div style={{ margin: '0.8rem 0', padding: '0.6rem', background: 'var(--paper, #ECEFEE)', borderRadius: 4 }}>
        <div style={{ ...MONO, fontSize: '1.4rem' }}>
          {stock.empty ? '—' : stock.balance} <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 400 }}>{part.unit}</span>
        </div>
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          {stock.empty ? 'Nothing recorded yet.'
            : stock.counted
              ? <>counted <strong>{stock.countedQty}</strong> on {fmtDate(stock.countedAt)}
                  {stock.received ? <> · <strong>+{stock.received}</strong> came aboard</> : null}
                  {stock.used ? <> · <strong>{stock.used}</strong> used</> : null}
                  {stock.adjusted ? <> · <strong>{stock.adjusted > 0 ? '+' : ''}{stock.adjusted}</strong> adjusted</> : null}
                </>
              : <>never counted — this is {stock.received ? `+${stock.received} in` : 'movements'}
                  {stock.used ? `, ${stock.used} out` : ''} from an assumed nought, so it may well be wrong.
                  Count it once and it will stand on something.</>}
        </div>
      </div>

      {canEdit && <MoveForm part={part} events={events} eventLabel={eventLabel} onMove={onMove} />}

      {canEdit && (
        <label style={{ ...LBL, marginTop: '0.6rem' }}>
          <span className="muted" style={CAP}>Want aboard</span>
          <input type="number" min="0" defaultValue={part.min_stock ?? ''} placeholder="—"
                 onBlur={(e) => onPatch({ min_stock: e.target.value === '' ? null : Number(e.target.value) })}
                 style={{ width: 100 }} />
        </label>
      )}

      <h4 style={{ margin: '0.9rem 0 0.3rem', fontSize: '0.85rem' }}>Every movement</h4>
      {!rows.length && <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>Nothing yet.</p>}
      {rows.map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap',
                                 fontSize: '0.83rem', padding: '0.25rem 0', borderTop: '1px solid var(--border)' }}>
          <span className="muted" style={{ minWidth: '5.5rem' }}>{fmtDate(m.moved_on)}</span>
          <span style={{ minWidth: '7rem' }}>{KIND_WORD[m.kind]}</span>
          <span style={{ ...MONO, minWidth: '3.5rem', textAlign: 'right',
                         color: m.kind === 'count' ? 'var(--hull)'
                              : m.effect < 0 ? 'var(--rust)' : 'var(--kelp)' }}>
            {m.kind === 'count' ? `= ${Math.abs(Number(m.qty))}` : `${m.effect > 0 ? '+' : ''}${m.effect}`}
          </span>
          {/* The balance each movement LEFT BEHIND — the whole reason for
              showing a ledger rather than a total. */}
          <span className="muted" style={{ ...MONO, minWidth: '3rem', textAlign: 'right', fontWeight: 400 }}>
            {m.after}
          </span>
          {m.event_id && <span className="muted" style={{ fontSize: '0.76rem' }}>{eventLabel(m.event_id)}</span>}
          {m.notes && <span className="muted" style={{ fontSize: '0.76rem' }}>{m.notes}</span>}
        </div>
      ))}
    </div>
  )
}

function MoveForm({ part, events, eventLabel, onMove }) {
  const [kind, setKind] = useState('used')
  const [qty, setQty] = useState('')
  const [on, setOn] = useState(today())
  const [eventId, setEventId] = useState('')
  const [notes, setNotes] = useState('')

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={LBL}><span className="muted" style={CAP}>What happened</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="used">Used on a job</option>
          <option value="received">Came aboard</option>
          <option value="count">Counted the shelf</option>
          <option value="adjusted">Adjusted</option>
        </select></label>
      <label style={LBL}>
        <span className="muted" style={CAP}>{kind === 'count' ? 'There are' : 'How many'}</span>
        <input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
               style={{ width: 90, textAlign: 'right' }} /></label>
      <label style={LBL}><span className="muted" style={CAP}>Date</span>
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      {kind === 'used' && (
        <label style={LBL}><span className="muted" style={CAP}>On which job</span>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ maxWidth: 220 }}>
            {/* Allowed to be blank on purpose: a part used off the books is
                still a part gone, and refusing to record it would leave the
                balance wrong — which is worse than an unattributed line. */}
            <option value="">— not tied to a job —</option>
            {events.map((e) => <option key={e.id} value={e.id}>{eventLabel(e.id)}</option>)}
          </select></label>
      )}
      <label style={LBL}><span className="muted" style={CAP}>Note</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: 170 }} /></label>
      <button onClick={() => { onMove(part, kind, qty, on, notes, eventId); setQty(''); setNotes('') }}
              disabled={qty === ''}>Record</button>
      {kind === 'count' && (
        <p className="muted" style={{ fontSize: '0.75rem', flexBasis: '100%', margin: 0 }}>
          A count is the shelf as it stands. Everything before it stops mattering, which is how a
          balance gets put right without editing history.
        </p>
      )}
    </div>
  )
}

const TH = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em',
             color: 'var(--mute)', padding: '0.3rem 0.5rem', textAlign: 'right',
             borderBottom: '1px solid var(--border)', fontWeight: 600 }
const TD = { padding: '0.4rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--border)',
             fontSize: '0.85rem', verticalAlign: 'top' }
const MONO = { fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }
const LBL = { display: 'flex', flexDirection: 'column', gap: '0.15rem' }
const CAP = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }
const SM = { padding: '0.05rem 0.45rem', fontSize: '0.85rem', lineHeight: 1.4 }
