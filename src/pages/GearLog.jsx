import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { keepsLogs } from '../lib/roles'
import { supabase } from '../supabaseClient'
import { useOfflineTable } from '../lib/offline/useOfflineTable'
import SyncStatus from '../components/SyncStatus'
import {
  DEFAULT_PARTS, resolveParts, LENGTH_UNITS, toMm, fmtLength, ftInToValue, valueToFtIn,
} from '../lib/gear/parts'
import {
  buildMatrix, historyFor, measurementsFor, daysBetween, lifeDays,
} from '../lib/gear/gearAgg'
import { tripsBetween } from '../lib/gear/gearStats'
import GearStats from './GearStats'
import GearGrounds from './GearGrounds'

/* THE GEAR LOG — what was done to the nets, and when.
 *
 * The third book the boat keeps. Trawl gear is maintained continuously and
 * nothing recorded it, so "when did we last renew the codend" was answered from
 * memory.
 *
 * THE UNIT IS THE NET. Nets are named — Port net, Starboard twin, Pair hopper,
 * Pair discer — and each carries its own ground gear, headline, bridles and
 * legs. A pair tows one net between two boats, but BOTH boats carry nets, so a
 * pair team typically has four aboard, two per boat, maintained separately.
 * Nothing is shared.
 *
 * A COMPONENT IS A THING WITH A LIFE. "Add new ground gear, retire a set of
 * ground gear" describes an object being fitted and removed, so a set is a row
 * with two dates rather than two events some later query has to pair up. A
 * renewal closes one and opens the next; a measurement is an event on the one
 * that is fitted.
 */

const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

// Why the number is what it is. "69 days since measured" and "69 days since she
// came aboard" are different facts and must not render alike.
const BASIS_WORD = {
  measured: 'since measured',
  fitted: 'since fitted',
  aboard: 'since aboard',
  none: '',
}

export default function GearLog() {
  const { appUser } = useAuth()
  // Gear is deck work and a mate is an officer — the same men who keep the
  // engine and garbage books keep this one. RLS is the boundary; this only
  // decides what the page offers.
  const canEdit = keepsLogs(appUser)

  const netsT = useOfflineTable('gear_nets', { orderBy: 'sort', ascending: true, fleetId: appUser?.fleet_id })
  const compsT = useOfflineTable('gear_components', { fleetId: appUser?.fleet_id })
  const measT = useOfflineTable('gear_measurements', { fleetId: appUser?.fleet_id })
  const partsT = useOfflineTable('gear_parts', { fleetId: appUser?.fleet_id })

  const [vessels, setVessels] = useState([])
  const [openNet, setOpenNet] = useState('')
  const [msg, setMsg] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const [tripDates, setTripDates] = useState({})
  const [groundDays, setGroundDays] = useState({})
  const [tab, setTab] = useState('log')

  const parts = useMemo(() => resolveParts(partsT.rows), [partsT.rows])
  const nets = netsT.rows
  const err = netsT.error || compsT.error || measT.error || partsT.error

  useEffect(() => {
    supabase.from('vessels').select('id, label, name, active')
      .then(({ data }) => setVessels(data || []))
  }, [])

  const matrix = useMemo(() => buildMatrix({
    nets, parts, components: compsT.rows, measurements: measT.rows,
    vessels, today: today(), includeRetired: showRetired,
  }), [nets, parts, compsT.rows, measT.rows, vessels, showRetired])

  /* Trips, not just days — and fetched ONCE PER VESSEL, not once per cell.
   *
   * gear_trip_dates is SECURITY DEFINER because quota_trips is NOT in the
   * officer allow-list: read directly it returns zero rows, and "0 trips" looks
   * exactly like "no trips" rather than like a permission wall. The man keeping
   * this log would have been the one person unable to see the count in it. It
   * returns DATES ONLY — no tonnage, no ports, no captain — so it hands out the
   * minimum that answers the question.
   *
   * Counting is then a pure function, which is what makes the window
   * arithmetic testable. An earlier draft asked the database once per matrix
   * cell, which is nets x parts round trips for one screen and would have
   * multiplied again for the per-renewal counts on the stats tab.
   */
  const vesselIds = useMemo(
    () => [...new Set(nets.map((n) => n.vessel_id).filter(Boolean))].sort().join(','),
    [nets])

  useEffect(() => {
    if (!vesselIds) return
    let cancel = false
    ;(async () => {
      const out = {}
      const grounds = {}
      for (const vid of vesselIds.split(',')) {
        const [dates, gd] = await Promise.all([
          supabase.rpc('gear_trip_dates', { p_vessel_id: vid }),
          supabase.rpc('gear_ground_days', { p_vessel_id: vid }),
        ])
        // Offline: leave both unknown rather than filling in a zero, which
        // would read as "no trips" and "never fished there".
        if (dates.error || gd.error) return
        out[vid] = (dates.data || []).map((d) => String(d).slice(0, 10))
        grounds[vid] = gd.data || []
      }
      if (!cancel) { setTripDates(out); setGroundDays(grounds) }
    })()
    return () => { cancel = true }
  }, [vesselIds])

  const tripsKnown = Object.keys(tripDates).length > 0
  const groundsKnown = Object.keys(groundDays).length > 0

  // ---- writes -------------------------------------------------------------
  async function addNet(vesselId, name, cameAboard, fitAll) {
    if (!canEdit || !name.trim()) return
    const id = await netsT.insert({
      fleet_id: appUser.fleet_id, vessel_id: vesselId, name: name.trim(),
      came_aboard: cameAboard || null, sort: nets.length,
    })
    if (!id) return
    /* A net comes aboard rigged, so offer to open a set for every part dated
     * from that day. Skipping it leaves the row empty and every cell reading
     * "since aboard", which is honest but useless — and filing five sets by
     * hand for every new net is how a log stops being kept. */
    if (fitAll) {
      for (const p of parts) {
        await compsT.insert({
          fleet_id: appUser.fleet_id, net_id: id, part_key: p.key,
          fitted_on: cameAboard || null,
        })
      }
    }
    setOpenNet(id)
    setMsg(`${name.trim()} added.`)
  }

  const retireNet = (net, on) => netsT.update(net.id, { retired_on: on || today() })
  const unretireNet = (net) => netsT.update(net.id, { retired_on: null })

  // A renewal is two things at once: the old set comes off and a new one goes
  // on. Doing it in one action is what keeps the two dates flush, so a life is
  // never a gap.
  async function renew(net, partKey, on, cost, notes) {
    if (!canEdit) return
    const fitted = compsT.rows.find(
      (c) => c.net_id === net.id && c.part_key === partKey && !c.removed_on)
    if (fitted) await compsT.update(fitted.id, { removed_on: on, updated_at: new Date().toISOString() })
    await compsT.insert({
      fleet_id: appUser.fleet_id, net_id: net.id, part_key: partKey,
      fitted_on: on, cost: cost === '' || cost == null ? null : Number(cost),
      notes: notes || null,
    })
    setMsg(`${partKey.replace(/_/g, ' ')} renewed on ${fmtDate(on)}.`)
  }

  async function retireComponent(component, on) {
    if (!canEdit) return
    await compsT.update(component.id, { removed_on: on || today() })
  }

  async function addMeasurement(component, { done_on, kind, value, unit, notes }) {
    if (!canEdit) return
    await measT.insert({
      fleet_id: appUser.fleet_id, component_id: component.id,
      kind, done_on, notes: notes || null,
      value: value ?? null, unit: value == null ? null : unit,
      // Stored twice on purpose: as written, and in millimetres so a series
      // survives the unit changing partway through it.
      value_mm: value == null ? null : toMm(value, unit),
      logged_by: (await supabase.auth.getUser()).data?.user?.id ?? null,
    })
  }

  if (!canEdit && appUser?.role !== 'viewer') {
    return (
      <AppShell>
        <div className="card"><p className="muted">Not available on your login.</p></div>
      </AppShell>
    )
  }

  const open = nets.find((n) => n.id === openNet) || null

  return (
    <AppShell>
      <PageHeader title="Gear Log" sub="What was done to the nets, and when">
        {canEdit && (
          <button className="secondary" onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? 'Hide retired' : 'Show retired'}
          </button>
        )}
      </PageHeader>

      {/* Two views of the same book: what is on the nets now, and how long
          these things last. */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.8rem' }}>
        {[['log', 'Log'], ['stats', 'Life'], ['grounds', 'Grounds']].map(([k, label]) => (
          <button key={k} className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      <SyncStatus online={netsT.online} pending={netsT.pending} failed={netsT.failed}
                  onChange={() => { netsT.sync(); compsT.sync(); measT.sync(); partsT.sync() }} />

      {err && <div className="card" style={{ borderColor: 'var(--rust)' }}>
        <p className="error" style={{ margin: 0 }}>{err}</p></div>}
      {msg && <div className="card" style={{ borderColor: 'var(--kelp)' }}>
        <p style={{ margin: 0, fontSize: '0.9rem' }}>{msg}</p></div>}

      {!nets.length && !netsT.loading && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No nets on record</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Add each net the boat carries and what it is rigged with. A pair team carries four —
            two on each boat — and they are never shared, so each is logged against its own vessel.
          </p>
        </div>
      )}

      {tab === 'log' && canEdit && <AddNet vessels={vessels} parts={parts} onAdd={addNet} />}

      {/* ---- THE MATRIX: nets down, parts across ---------------------------
          Read a row for one net's whole rig, or a column for one part across
          every net. David asked for both and this is the one shape that is. */}
      {tab === 'grounds' && (
        <GearGrounds parts={parts} nets={nets} components={compsT.rows}
                     groundDays={groundDays} groundsKnown={groundsKnown} />
      )}

      {tab === 'stats' && (
        <GearStats parts={parts} nets={nets} components={compsT.rows} vessels={vessels}
                   tripDates={tripDates} today={today()} tripsKnown={tripsKnown} />
      )}

      {tab === 'log' && matrix.map((g) => (
        <div className="card" key={g.vessel.id}>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem' }}>
            {g.vessel.label || g.vessel.name}
            <span className="muted" style={{ fontWeight: 400 }}> · {g.rows.length} net{g.rows.length === 1 ? '' : 's'}</span>
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left', minWidth: 130 }}>Net</th>
                  {parts.map((p) => <th key={p.key} style={TH}>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {g.rows.map(({ net, cells }) => (
                  <tr key={net.id} style={{ opacity: net.retired_on ? 0.5 : 1 }}>
                    <td style={{ ...TD, textAlign: 'left' }}>
                      <button className="secondary" style={{ ...SM, width: '100%', textAlign: 'left' }}
                              onClick={() => setOpenNet(openNet === net.id ? '' : net.id)}>
                        {net.name}
                      </button>
                      <div className="muted" style={{ fontSize: '0.7rem', marginTop: '0.15rem' }}>
                        {net.retired_on ? `retired ${fmtDate(net.retired_on)}`
                          : net.came_aboard ? `aboard ${fmtDate(net.came_aboard)}` : 'no date aboard'}
                      </div>
                    </td>
                    {cells.map((c) => (
                      <td key={c.partKey} style={TD}>
                        <Cell cell={c} known={tripsKnown}
                              trips={c.since ? tripsBetween(tripDates[net.vessel_id] || [], c.since, today()) : null} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {tab === 'log' && open && (
        <NetDetail
          net={open} parts={parts} canEdit={canEdit}
          components={compsT.rows} measurements={measT.rows}
          onClose={() => setOpenNet('')}
          onRenew={renew} onRetireComponent={retireComponent} onMeasure={addMeasurement}
          onRetireNet={retireNet} onUnretireNet={unretireNet}
          onPatchNet={(fields) => netsT.update(open.id, fields)}
        />
      )}
    </AppShell>
  )
}

/* One cell. The BASIS is shown, always — a bare number would let a net nobody
 * has ever looked at pass for one checked ten weeks ago. */
function Cell({ cell, trips: rawTrips, known }) {
  const trips = known === false ? null : rawTrips
  if (cell.basis === 'none') return <span className="muted" style={{ fontSize: '0.78rem' }}>—</span>
  const stale = cell.basis !== 'measured'
  return (
    <div style={{ lineHeight: 1.25 }}>
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700,
                    color: stale ? 'var(--brass)' : 'var(--ink)' }}>
        {cell.days}d
        {Number.isFinite(trips) && <span className="muted" style={{ fontWeight: 400 }}> · {trips}t</span>}
      </div>
      <div className="muted" style={{ fontSize: '0.68rem' }}>{BASIS_WORD[cell.basis]}</div>
      {cell.lastMeasured?.value != null && (
        <div style={{ fontSize: '0.72rem' }}>
          {fmtLength(cell.lastMeasured.value, cell.lastMeasured.unit)}
        </div>
      )}
    </div>
  )
}

function AddNet({ vessels, parts, onAdd }) {
  const [open, setOpen] = useState(false)
  const [vesselId, setVesselId] = useState('')
  const [name, setName] = useState('')
  const [aboard, setAboard] = useState(today())
  const [fitAll, setFitAll] = useState(true)

  useEffect(() => { if (!vesselId && vessels.length) setVesselId(vessels[0].id) }, [vessels, vesselId])

  if (!open) {
    return (
      <div className="card">
        <button className="secondary" onClick={() => setOpen(true)}>Add a net</button>
      </div>
    )
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={LBL}>
          <span className="muted" style={CAP}>Boat</span>
          <select value={vesselId} onChange={(e) => setVesselId(e.target.value)}>
            {vessels.map((v) => <option key={v.id} value={v.id}>{v.label || v.name}</option>)}
          </select>
        </label>
        <label style={LBL}>
          <span className="muted" style={CAP}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="Port net, Pair hopper…" style={{ width: 180 }} />
        </label>
        <label style={LBL}>
          <span className="muted" style={CAP}>Came aboard</span>
          <input type="date" value={aboard} onChange={(e) => setAboard(e.target.value)} />
        </label>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={fitAll} onChange={(e) => setFitAll(e.target.checked)} />
          Rigged with all {parts.length} parts from that date
        </label>
        <button disabled={!name.trim() || !vesselId}
                onClick={() => { onAdd(vesselId, name, aboard, fitAll); setName(''); setOpen(false) }}>
          Add
        </button>
        <button className="secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="muted" style={{ fontSize: '0.75rem', marginBottom: 0 }}>
        A net comes aboard rigged, so the parts are opened dated from that day. Untick it and every
        cell reads “since aboard” until something is fitted — honest, but it tells you nothing.
      </p>
    </div>
  )
}

function NetDetail({ net, parts, canEdit, components, measurements, onClose,
                     onRenew, onRetireComponent, onMeasure, onRetireNet, onUnretireNet, onPatchNet }) {
  return (
    <div className="card" style={{ borderColor: 'var(--hull)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>{net.name}</h3>
          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>
            {net.came_aboard ? `Aboard ${fmtDate(net.came_aboard)} · ${daysBetween(net.came_aboard, today())} days`
                             : 'No date aboard on record'}
            {net.retired_on && ` · retired ${fmtDate(net.retired_on)}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {canEdit && (net.retired_on
            ? <button className="secondary" onClick={() => onUnretireNet(net)}>Back in use</button>
            : <button className="secondary" onClick={() => onRetireNet(net, today())}>Retire net</button>)}
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>

      {canEdit && !net.came_aboard && (
        <label style={{ ...LBL, marginTop: '0.6rem' }}>
          <span className="muted" style={CAP}>Set the date she came aboard</span>
          <input type="date" onChange={(e) => onPatchNet({ came_aboard: e.target.value })}
                 style={{ width: 170 }} />
        </label>
      )}

      {parts.map((p) => (
        <PartBlock key={p.key} net={net} part={p} canEdit={canEdit}
                   components={components} measurements={measurements}
                   onRenew={onRenew} onRetireComponent={onRetireComponent} onMeasure={onMeasure} />
      ))}
    </div>
  )
}

function PartBlock({ net, part, canEdit, components, measurements, onRenew, onRetireComponent, onMeasure }) {
  const history = historyFor(components, net.id, part.key)
  const fitted = history.find((c) => !c.removed_on) || null
  const [showRenew, setShowRenew] = useState(false)

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.6rem', marginTop: '0.6rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.9rem' }}>{part.label}</strong>
        {fitted
          ? <span className="muted" style={{ fontSize: '0.8rem' }}>
              on since {fmtDate(fitted.fitted_on)}
              {Number.isFinite(lifeDays(fitted, today())) && ` · ${lifeDays(fitted, today())} days`}
              {fitted.cost != null && ` · £${Number(fitted.cost).toLocaleString()}`}
            </span>
          : <span className="muted" style={{ fontSize: '0.8rem' }}>nothing fitted</span>}
        {canEdit && (
          <button className="secondary" style={SM} onClick={() => setShowRenew((v) => !v)}>
            {showRenew ? 'Cancel' : fitted ? 'Renew' : 'Fit a set'}
          </button>
        )}
        {canEdit && fitted && (
          <button className="secondary" style={SM}
                  onClick={() => onRetireComponent(fitted, today())}>Take off</button>
        )}
      </div>

      {showRenew && (
        <RenewForm onDone={(on, cost, notes) => { onRenew(net, part.key, on, cost, notes); setShowRenew(false) }} />
      )}

      {fitted && canEdit && <MeasureForm component={fitted} onAdd={onMeasure} />}

      {fitted && measurementsFor(measurements, fitted.id).map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.8rem', padding: '0.12rem 0' }}>
          <span className="muted" style={{ minWidth: '5.5rem' }}>{fmtDate(m.done_on)}</span>
          <span style={{ minWidth: '4.5rem' }}>{m.kind}</span>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', minWidth: '5rem' }}>
            {fmtLength(m.value, m.unit)}
          </span>
          <span className="muted">{m.notes}</span>
        </div>
      ))}

      {history.filter((c) => c.removed_on).length > 0 && (
        <details style={{ marginTop: '0.3rem' }}>
          <summary className="muted" style={{ fontSize: '0.75rem', cursor: 'pointer' }}>
            {history.filter((c) => c.removed_on).length} previous
          </summary>
          {history.filter((c) => c.removed_on).map((c) => (
            <div key={c.id} className="muted" style={{ fontSize: '0.76rem', padding: '0.1rem 0' }}>
              {fmtDate(c.fitted_on)} → {fmtDate(c.removed_on)}
              {Number.isFinite(daysBetween(c.fitted_on, c.removed_on)) && ` · ${daysBetween(c.fitted_on, c.removed_on)} days`}
              {c.cost != null && ` · £${Number(c.cost).toLocaleString()}`}
              {c.notes ? ` · ${c.notes}` : ''}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

function RenewForm({ onDone }) {
  const [on, setOn] = useState(today())
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', margin: '0.4rem 0' }}>
      <label style={LBL}><span className="muted" style={CAP}>Fitted</span>
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      {/* Often unknown, and that is fine — better null than a guessed figure. */}
      <label style={LBL}><span className="muted" style={CAP}>Cost, if known</span>
        <input type="number" min="0" step="0.01" value={cost} placeholder="—"
               onChange={(e) => setCost(e.target.value)} style={{ width: 110 }} /></label>
      <label style={LBL}><span className="muted" style={CAP}>Note</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: 200 }} /></label>
      <button onClick={() => onDone(on, cost, notes)}>Save</button>
    </div>
  )
}

function MeasureForm({ component, onAdd }) {
  const [on, setOn] = useState(today())
  const [kind, setKind] = useState('measured')
  const [unit, setUnit] = useState('fathom')
  const [val, setVal] = useState('')
  const [ft, setFt] = useState('')
  const [inch, setInch] = useState('')
  const [notes, setNotes] = useState('')

  const value = kind !== 'measured' ? null
    : unit === 'ft_in' ? ftInToValue(ft, inch)
    : (val === '' ? null : Number(val))

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', margin: '0.4rem 0' }}>
      <label style={LBL}><span className="muted" style={CAP}>Date</span>
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      <label style={LBL}><span className="muted" style={CAP}>What</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="measured">Measured</option>
          <option value="inspected">Inspected</option>
          <option value="repaired">Repaired</option>
        </select></label>
      {kind === 'measured' && (
        <>
          <label style={LBL}><span className="muted" style={CAP}>Unit</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {LENGTH_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
            </select></label>
          {unit === 'ft_in' ? (
            <>
              <label style={LBL}><span className="muted" style={CAP}>Feet</span>
                <input type="number" min="0" value={ft} onChange={(e) => setFt(e.target.value)}
                       style={{ width: 70 }} /></label>
              <label style={LBL}><span className="muted" style={CAP}>Inches</span>
                <input type="number" min="0" max="11" value={inch} onChange={(e) => setInch(e.target.value)}
                       style={{ width: 70 }} /></label>
            </>
          ) : (
            <label style={LBL}><span className="muted" style={CAP}>Length</span>
              <input type="number" min="0" step="0.01" value={val}
                     onChange={(e) => setVal(e.target.value)} style={{ width: 100 }} /></label>
          )}
        </>
      )}
      <label style={LBL}><span className="muted" style={CAP}>Note</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: 180 }} /></label>
      <button className="secondary"
              onClick={() => {
                onAdd(component, { done_on: on, kind, value, unit, notes })
                setVal(''); setFt(''); setInch(''); setNotes('')
              }}>
        Log it
      </button>
    </div>
  )
}

const TH = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em',
             color: 'var(--mute)', padding: '0.3rem 0.5rem', textAlign: 'center',
             borderBottom: '1px solid var(--border)', fontWeight: 600 }
const TD = { padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)',
             fontSize: '0.85rem', verticalAlign: 'top' }
const LBL = { display: 'flex', flexDirection: 'column', gap: '0.15rem' }
const CAP = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }
const SM = { padding: '0.05rem 0.45rem', fontSize: '0.85rem', lineHeight: 1.4 }
