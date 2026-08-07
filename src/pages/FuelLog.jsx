import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

// Fuel and oil log, plus the fuel loop.
//
// Fuel is recorded in three places and nothing reconciles them:
//   1. this log        — litres BUNKERED, where, from whom
//   2. the Square Up worksheet — litres taken, where
//   3. the settlement  — fuel_used
//
// The third is LITRES, not pounds. It averages 74% of total_expenses across
// the twelve settlements that carry it, which cannot be a share of cost when
// fuel is about half the expense bill — and fuel_used ÷ days_at_sea lands
// between 3,900 and 7,200, which is a working day's burn for this boat.
// Getting that wrong would make every figure on this page nonsense.
//
// Bunkered and used are different quantities: you can bunker in one settlement
// period and burn it in the next. Over a long enough run they converge, and
// the gap between them is the thing worth watching.

const KINDS = [
  { id: 'fuel', label: 'Fuel', unit: 'bunkered' },
  { id: 'lube_oil', label: 'Lube oil', unit: 'bunkered' },
  { id: 'dirty_oil', label: 'Dirty oil', unit: 'discharged' },
  { id: 'waste', label: 'Oil waste', unit: 'discharged' },
]

const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')
const L = (n) => (n == null ? '—' : Number(n).toLocaleString('en-GB') + ' L')
const n0 = (n) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('en-GB'))
const blank = (kind) => ({ kind, entry_date: new Date().toISOString().slice(0, 10), litres: '', grade: '', location: '', counterparty: '', method: '', running_hours: '', consumption_l: '', recorded_by: '', notes: '' })

// "Smith & Sons", "Smith's", "Smiths &sons", "John a smith &sons" are one
// supplier typed seven ways. Normalising for comparison only — what was typed
// is what is stored, because correcting a record silently is worse.
const normalise = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '')

export default function FuelLog() {
  const { appUser } = useAuth()
  const canEdit = appUser?.role === 'skipper'

  const [rows, setRows] = useState([])
  const [settlements, setSettlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('fuel')
  const [draft, setDraft] = useState(blank('fuel'))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true); setError('')
    const [lRes, sRes] = await Promise.all([
      supabase.from('vessel_fuel_log').select('*').order('entry_date', { ascending: false }),
      supabase.from('su_settlements').select('reference, settling_date, days_at_sea, trips, fuel_used, total_expenses').not('fuel_used', 'is', null).order('settling_date'),
    ])
    if (lRes.error) setError(lRes.error.message)
    setRows(lRes.data || [])
    setSettlements(sRes.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const totals = useMemo(() => {
    const t = {}
    for (const k of KINDS) t[k.id] = { n: 0, litres: 0 }
    for (const r of rows) { if (t[r.kind]) { t[r.kind].n++; t[r.kind].litres += Number(r.litres || 0) } }
    return t
  }, [rows])

  const list = useMemo(() => rows.filter((r) => r.kind === tab), [rows, tab])

  // Consumption per day at sea, from the settlements that carry fuel_used.
  const burn = useMemo(() => {
    const withDays = settlements.filter((s) => Number(s.days_at_sea) > 0 && Number(s.fuel_used) > 0)
    if (!withDays.length) return null
    const totalL = withDays.reduce((a, s) => a + Number(s.fuel_used), 0)
    const totalDays = withDays.reduce((a, s) => a + Number(s.days_at_sea), 0)
    const perDay = withDays.map((s) => Number(s.fuel_used) / Number(s.days_at_sea)).sort((a, b) => a - b)
    return {
      n: withDays.length, totalL, totalDays,
      avg: totalL / totalDays,
      min: perDay[0], max: perDay[perDay.length - 1],
      rows: withDays,
    }
  }, [settlements])

  // The loop: bunkered here, used on the settlements, over the same window.
  const loop = useMemo(() => {
    if (!burn) return null
    const from = burn.rows[0].settling_date
    const to = burn.rows[burn.rows.length - 1].settling_date
    const bunkered = rows
      .filter((r) => r.kind === 'fuel' && r.entry_date >= from && r.entry_date <= to)
      .reduce((a, r) => a + Number(r.litres || 0), 0)
    const used = burn.totalL
    return { from, to, bunkered, used, gap: bunkered - used }
  }, [rows, burn])

  // Suppliers that differ only by spelling.
  const supplierVariants = useMemo(() => {
    const g = {}
    for (const r of rows.filter((x) => x.kind === 'fuel' && x.counterparty)) {
      const k = normalise(r.counterparty)
      ;(g[k] = g[k] || new Set()).add(r.counterparty)
    }
    return Object.values(g).filter((s) => s.size > 1).map((s) => [...s])
  }, [rows])

  async function save(e) {
    e.preventDefault()
    if (!draft.litres || !draft.entry_date) return
    setBusy(true)
    const payload = {
      kind: draft.kind,
      entry_date: draft.entry_date,
      litres: Number(draft.litres),
      grade: draft.grade.trim() || null,
      location: draft.location.trim() || null,
      counterparty: draft.counterparty.trim() || null,
      method: draft.method.trim() || null,
      running_hours: draft.running_hours === '' ? null : Number(draft.running_hours),
      consumption_l: draft.consumption_l === '' ? null : Number(draft.consumption_l),
      recorded_by: draft.recorded_by.trim() || null,
      notes: draft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = editing
      ? await supabase.from('vessel_fuel_log').update(payload).eq('id', editing)
      : await supabase.from('vessel_fuel_log').insert(payload)
    setBusy(false)
    if (error) { setError(error.message); return }
    setDraft(blank(tab)); setAdding(false); setEditing(null); load()
  }

  function startEdit(r) {
    setDraft({
      kind: r.kind, entry_date: r.entry_date || '', litres: r.litres ?? '',
      grade: r.grade || '', location: r.location || '', counterparty: r.counterparty || '',
      method: r.method || '', running_hours: r.running_hours ?? '', consumption_l: r.consumption_l ?? '',
      recorded_by: r.recorded_by || '', notes: r.notes || '',
    })
    setEditing(r.id); setAdding(true)
  }

  async function remove(r) {
    if (!confirm(`Delete the ${fmtDate(r.entry_date)} entry of ${L(r.litres)}?`)) return
    const { error } = await supabase.from('vessel_fuel_log').delete().eq('id', r.id)
    if (error) setError(error.message); else load()
  }

  const isDisposal = tab === 'dirty_oil' || tab === 'waste'
  const th = { padding: '0.45rem 0.4rem', textAlign: 'left' }

  return (
    <AppShell>
      <PageHeader title="Fuel & Oil Log" sub="Bunkering, lubes, and what goes ashore">
        {canEdit && !adding && (
          <button onClick={() => { setDraft(blank(tab)); setEditing(null); setAdding(true) }}>+ Add entry</button>
        )}
      </PageHeader>

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      <div className="card">
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {KINDS.map((k) => (
            <div key={k.id}>
              <div style={{ fontSize: '1.35rem', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--hull)' }}>
                {n0(totals[k.id].litres)}<span style={{ fontSize: '0.9rem' }}> L</span>
              </div>
              <div className="muted" style={{ fontSize: '0.78rem' }}>{k.label} {k.unit} · {totals[k.id].n} entr{totals[k.id].n === 1 ? 'y' : 'ies'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- the fuel loop ---------- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>The fuel loop</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Fuel is recorded in three places. This is what each one says.
        </p>

        {loading ? <p className="muted">Loading…</p> : (
          <div style={{ display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <Source
              n="1" title="This log — bunkered"
              value={loop ? L(loop.bunkered) : '—'}
              note={loop ? `${fmtDate(loop.from)} → ${fmtDate(loop.to)}` : 'no fuel entries'}
              ok
            />
            <Source
              n="2" title="Square Up worksheet"
              value="no data"
              note="The worksheet records litres taken and where, but there are no worksheets saved yet. This leg of the loop cannot be closed until the stage-2 worksheet rework lands."
            />
            <Source
              n="3" title="Settlement — used"
              value={burn ? L(burn.totalL) : '—'}
              note={burn ? `${burn.n} settlements carrying a fuel figure` : 'no settlement fuel figures'}
              ok={!!burn}
            />
          </div>
        )}

        {loop && (
          <div style={{ marginTop: '1rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border)' }}>
            <strong>Bunkered less used over the same window: {L(loop.gap)}</strong>
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: '0.3rem', marginBottom: 0 }}>
              These are different quantities, so a gap is expected — fuel bunkered at the end of a
              period is burned in the next one, and the tank level at each end is not recorded. What
              matters is whether the gap stays roughly steady. A gap that grows trip on trip means one
              of the three records is drifting.
            </p>
          </div>
        )}
      </div>

      {/* ---------- consumption ---------- */}
      {burn && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Consumption per day at sea</h2>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
            <Fig label="Average" value={`${n0(burn.avg)} L/day`} strong />
            <Fig label="Lowest trip" value={`${n0(burn.min)} L/day`} />
            <Fig label="Highest trip" value={`${n0(burn.max)} L/day`} />
            <Fig label="Days at sea" value={n0(burn.totalDays)} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={th}>Settled</th><th style={th}>Ref</th>
                  <th style={{ ...th, textAlign: 'right' }}>Days</th>
                  <th style={{ ...th, textAlign: 'right' }}>Fuel used</th>
                  <th style={{ ...th, textAlign: 'right' }}>L/day</th>
                </tr>
              </thead>
              <tbody>
                {burn.rows.map((s) => {
                  const pd = Number(s.fuel_used) / Number(s.days_at_sea)
                  const off = Math.abs(pd - burn.avg) / burn.avg > 0.25
                  return (
                    <tr key={s.reference} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={th}>{fmtDate(s.settling_date)}</td>
                      <td style={{ ...th, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem' }}>{s.reference}</td>
                      <td style={{ ...th, textAlign: 'right' }}>{s.days_at_sea}</td>
                      <td style={{ ...th, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{n0(s.fuel_used)}</td>
                      <td style={{ ...th, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: off ? 'var(--brass)' : 'inherit' }}>
                        {n0(pd)}{off ? ' ⚠' : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
            Flagged where a trip is more than 25% off the average. Only {burn.n} settlements carry a
            fuel figure, so treat the average as indicative until more are read in.
          </p>
        </div>
      )}

      {supplierVariants.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h2 style={{ marginTop: 0 }}>One supplier, several spellings</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            These are almost certainly the same firm typed differently, which makes "who do we buy
            most fuel from" unanswerable. Left exactly as recorded — correcting the log silently
            would be worse than showing the problem.
          </p>
          {supplierVariants.map((v, i) => (
            <div key={i} style={{ padding: '0.35rem 0', borderTop: '1px solid var(--border)', fontSize: '0.88rem' }}>
              {v.join('  ·  ')}
            </div>
          ))}
        </div>
      )}

      {/* ---------- entries ---------- */}
      <div className="card">
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={tab === k.id ? '' : 'secondary'}
              onClick={() => { setTab(k.id); setAdding(false); setEditing(null) }}
              style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
            >
              {k.label} <span style={{ opacity: 0.7 }}>({totals[k.id].n})</span>
            </button>
          ))}
        </div>

        {adding && canEdit && (
          <form onSubmit={save} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <Field label="Kind">
                <select value={draft.kind} onChange={(e) => setDraft((p) => ({ ...p, kind: e.target.value }))}>
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </Field>
              <Field label="Date"><input type="date" value={draft.entry_date} onChange={(e) => setDraft((p) => ({ ...p, entry_date: e.target.value }))} required /></Field>
              <Field label="Litres"><input type="number" min="0" step="1" value={draft.litres} onChange={(e) => setDraft((p) => ({ ...p, litres: e.target.value }))} required /></Field>
              <Field label="Grade"><input value={draft.grade} onChange={(e) => setDraft((p) => ({ ...p, grade: e.target.value }))} placeholder="MGO" /></Field>
              <Field label={isDisposal ? 'Disposal location' : 'Location'}><input value={draft.location} onChange={(e) => setDraft((p) => ({ ...p, location: e.target.value }))} placeholder="Peterhead" /></Field>
              <Field label={isDisposal ? 'Contractor' : 'Supplier'}><input value={draft.counterparty} onChange={(e) => setDraft((p) => ({ ...p, counterparty: e.target.value }))} /></Field>
              {isDisposal && <Field label="Method"><input value={draft.method} onChange={(e) => setDraft((p) => ({ ...p, method: e.target.value }))} placeholder="Shore Facility" /></Field>}
              {draft.kind === 'fuel' && <Field label="Running hours"><input type="number" min="0" value={draft.running_hours} onChange={(e) => setDraft((p) => ({ ...p, running_hours: e.target.value }))} /></Field>}
              {draft.kind === 'fuel' && <Field label="Used since last bunker"><input type="number" min="0" value={draft.consumption_l} onChange={(e) => setDraft((p) => ({ ...p, consumption_l: e.target.value }))} /></Field>}
              <Field label="Recorded by"><input value={draft.recorded_by} onChange={(e) => setDraft((p) => ({ ...p, recorded_by: e.target.value }))} /></Field>
            </div>
            <div style={{ marginTop: '0.6rem' }}>
              <Field label="Notes"><input value={draft.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} /></Field>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add entry'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setEditing(null) }}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? <p className="muted">Loading…</p> : list.length === 0 ? (
          <p className="muted">No {KINDS.find((k) => k.id === tab)?.label.toLowerCase()} entries yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={th}>Date</th>
                  <th style={{ ...th, textAlign: 'right' }}>Litres</th>
                  <th style={th}>Grade</th>
                  <th style={th}>{isDisposal ? 'Disposal location' : 'Location'}</th>
                  <th style={th}>{isDisposal ? 'Contractor' : 'Supplier'}</th>
                  {tab === 'fuel' && <th style={{ ...th, textAlign: 'right' }}>Hours</th>}
                  <th style={th}>Recorded by</th>
                  {canEdit && <th style={{ ...th, textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={th}>{fmtDate(r.entry_date)}</td>
                    <td style={{ ...th, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}>{n0(r.litres)}</td>
                    <td style={th}>{r.grade || (r.method || '—')}</td>
                    <td style={th}>{r.location || '—'}</td>
                    <td style={th}>{r.counterparty || '—'}</td>
                    {tab === 'fuel' && <td style={{ ...th, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem' }}>{r.running_hours ? n0(r.running_hours) : '—'}</td>}
                    <td style={th} className="muted">
                      {r.recorded_by || '—'}
                      {r.notes && <div style={{ fontSize: '0.75rem' }}>{r.notes}</div>}
                    </td>
                    {canEdit && (
                      <td style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="secondary" onClick={() => startEdit(r)} style={{ padding: '0.15rem 0.5rem', fontSize: '0.78rem', marginRight: '0.25rem' }}>Edit</button>
                        <button className="secondary" onClick={() => remove(r)} style={{ padding: '0.15rem 0.5rem', fontSize: '0.78rem' }}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function Source({ n, title, value, note, ok }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.7rem' }}>
      <div className="muted" style={{ fontSize: '0.72rem', fontWeight: 700 }}>{n}</div>
      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{title}</div>
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '1.1rem', fontWeight: 700, color: ok ? 'var(--hull)' : 'var(--brass)', margin: '0.25rem 0' }}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: '0.75rem' }}>{note}</div>
    </div>
  )
}

function Fig({ label, value, strong }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, fontSize: strong ? '1.3rem' : '1.05rem', color: strong ? 'var(--hull)' : 'inherit' }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.78rem' }}>{label}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.78rem', fontWeight: 600 }}>
      {label}{children}
    </label>
  )
}
