import { useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { keepsLogs } from '../lib/roles'
import { useOfflineTable } from '../lib/offline/useOfflineTable'
import SyncStatus from '../components/SyncStatus'

// MARPOL Annex V Garbage Record Book.
//
// The categories and the permitted dispositions are set by the regulation, so
// they are pickable lists rather than free text — a Record Book that says
// "rubbish, ashore" is not a Record Book. Position and reason are required for
// a discharge to sea or an accidental loss, and the form asks for them only
// then, because demanding a position for a skip on the quay is how a log stops
// being filled in.

const CATEGORIES = [
  'A Plastics', 'B Food wastes', 'C Domestic wastes', 'D Cooking oil',
  'E Incinerator ashes', 'F Operational wastes', 'G Animal carcasses',
  'H Fishing gear', 'I E-waste', 'J Cargo residues (non-HME)', 'K Cargo residues (HME)',
]
const DISPOSITIONS = ['To reception facility', 'Discharged to sea', 'Incinerated', 'Accidental loss']
const NEEDS_POSITION = ['Discharged to sea', 'Accidental loss']

const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')
const blank = () => ({
  entry_date: new Date().toISOString().slice(0, 10), category: CATEGORIES[0],
  disposition: DISPOSITIONS[0], quantity_m3: '', quantity_kg: '', port: '',
  receipt_ref: '', position_text: '', reason: '', recorded_by: '', notes: '',
})

export default function GarbageLog() {
  const { appUser } = useAuth()
  const canEdit = keepsLogs(appUser)

  // A Garbage Record Book gets filled in where the rubbish is handled, which is
  // not where the signal is. Writes go to the outbox and sync when they can —
  // see src/lib/offline/queue.js.
  const {
    rows, loading, error, setError, online, pending, failed,
    insert, update, remove: removeRow, reload, sync,
  } = useOfflineTable('garbage_log', { orderBy: 'entry_date', ascending: false })

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(blank())
  const [busy, setBusy] = useState(false)

  const totals = useMemo(() => {
    const t = { entries: rows.length, m3: 0, toShore: 0, toSea: 0 }
    for (const r of rows) {
      t.m3 += Number(r.quantity_m3 || 0)
      if (r.disposition === 'To reception facility') t.toShore++
      if (r.disposition === 'Discharged to sea' || r.disposition === 'Accidental loss') t.toSea++
    }
    t.m3 = Math.round(t.m3 * 100) / 100
    return t
  }, [rows])

  const needsPosition = NEEDS_POSITION.includes(draft.disposition)

  async function save(e) {
    e.preventDefault()
    if (needsPosition && !draft.position_text.trim()) {
      setError('A discharge to sea or an accidental loss needs a position — Annex V asks for it.')
      return
    }
    setBusy(true); setError('')
    const payload = {
      entry_date: draft.entry_date,
      category: draft.category,
      disposition: draft.disposition,
      quantity_m3: draft.quantity_m3 === '' ? null : Number(draft.quantity_m3),
      quantity_kg: draft.quantity_kg === '' ? null : Number(draft.quantity_kg),
      port: draft.port.trim() || null,
      receipt_ref: draft.receipt_ref.trim() || null,
      position_text: draft.position_text.trim() || null,
      reason: draft.reason.trim() || null,
      recorded_by: draft.recorded_by.trim() || null,
      notes: draft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    // No error to check: the write is durable on this device the moment it is
    // queued, and the outbox reports anything the server later refuses.
    if (editing) await update(editing, payload)
    else await insert({ ...payload, fleet_id: appUser?.fleet_id })
    setBusy(false)
    setDraft(blank()); setAdding(false); setEditing(null)
  }

  function startEdit(r) {
    setDraft({
      entry_date: r.entry_date || '', category: r.category, disposition: r.disposition,
      quantity_m3: r.quantity_m3 ?? '', quantity_kg: r.quantity_kg ?? '',
      port: r.port || '', receipt_ref: r.receipt_ref || '',
      position_text: r.position_text || '', reason: r.reason || '',
      recorded_by: r.recorded_by || '', notes: r.notes || '',
    })
    setEditing(r.id); setAdding(true)
  }

  async function remove(r) {
    if (!confirm(`Delete the ${fmtDate(r.entry_date)} entry? A Garbage Record Book is a legal record — only do this if it was entered in error.`)) return
    await removeRow(r.id)
  }

  const th = { padding: '0.45rem 0.4rem', textAlign: 'left' }

  return (
    <AppShell>
      <PageHeader title="Garbage Record Book" sub="MARPOL Annex V">
        {canEdit && !adding && <button onClick={() => { setDraft(blank()); setEditing(null); setAdding(true) }}>+ Add entry</button>}
      </PageHeader>

      <SyncStatus online={online} pending={pending} failed={failed} onChange={sync} />

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      <div className="card">
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <Fig label="Entries" value={totals.entries} />
          <Fig label="Total m³ recorded" value={totals.m3} />
          <Fig label="To reception facility" value={totals.toShore} />
          <Fig label="To sea / lost" value={totals.toSea} accent={totals.toSea ? 'var(--brass)' : undefined} />
        </div>
      </div>

      {adding && canEdit && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{editing ? 'Edit entry' : 'New entry'}</h2>
          <form onSubmit={save}>
            <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              <Field label="Date"><input type="date" value={draft.entry_date} onChange={(e) => setDraft((p) => ({ ...p, entry_date: e.target.value }))} required /></Field>
              <Field label="Category">
                <select value={draft.category} onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Disposition">
                <select value={draft.disposition} onChange={(e) => setDraft((p) => ({ ...p, disposition: e.target.value }))}>
                  {DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Quantity (m³)"><input type="number" min="0" step="0.1" value={draft.quantity_m3} onChange={(e) => setDraft((p) => ({ ...p, quantity_m3: e.target.value }))} /></Field>
              <Field label="Quantity (kg, optional)"><input type="number" min="0" step="1" value={draft.quantity_kg} onChange={(e) => setDraft((p) => ({ ...p, quantity_kg: e.target.value }))} /></Field>
              <Field label="Port / facility"><input value={draft.port} onChange={(e) => setDraft((p) => ({ ...p, port: e.target.value }))} placeholder="Peterhead" /></Field>
              <Field label="Receipt reference"><input value={draft.receipt_ref} onChange={(e) => setDraft((p) => ({ ...p, receipt_ref: e.target.value }))} /></Field>
              <Field label="Recorded by"><input value={draft.recorded_by} onChange={(e) => setDraft((p) => ({ ...p, recorded_by: e.target.value }))} /></Field>
            </div>

            {needsPosition && (
              <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginTop: '0.7rem', paddingTop: '0.7rem', borderTop: '1px solid var(--border)' }}>
                <Field label="Position (required)"><input value={draft.position_text} onChange={(e) => setDraft((p) => ({ ...p, position_text: e.target.value }))} placeholder="57°30'N 001°20'W" required /></Field>
                <Field label="Reason"><input value={draft.reason} onChange={(e) => setDraft((p) => ({ ...p, reason: e.target.value }))} placeholder="Gear parted in heavy weather" /></Field>
              </div>
            )}

            <div style={{ marginTop: '0.7rem' }}>
              <Field label="Notes"><input value={draft.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} /></Field>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add entry'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setEditing(null); setError('') }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? <p className="muted">Loading…</p> : rows.length === 0 ? (
          <p className="muted">
            No entries yet. A Garbage Record Book is required under MARPOL Annex V — if one is being
            kept elsewhere, this is where it lives from now on.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={th}>Date</th>
                  <th style={th}>Category</th>
                  <th style={th}>Disposition</th>
                  <th style={{ ...th, textAlign: 'right' }}>m³</th>
                  <th style={th}>Port / position</th>
                  <th style={th}>Receipt</th>
                  {canEdit && <th style={{ ...th, textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={th}>
                      {fmtDate(r.entry_date)}
                      {r._pending && (
                        <span title="Saved on this device, not yet sent" style={{ color: 'var(--brass)', fontSize: '0.72rem', display: 'block' }}>
                          not sent
                        </span>
                      )}
                    </td>
                    <td style={th}>{r.category}</td>
                    <td style={th}>
                      {r.disposition}
                      {NEEDS_POSITION.includes(r.disposition) && <span style={{ color: 'var(--brass)', fontWeight: 700 }}> ●</span>}
                    </td>
                    <td style={{ ...th, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{r.quantity_m3 ?? '—'}</td>
                    <td style={th} className="muted">
                      {r.port || r.position_text || '—'}
                      {r.reason && <div style={{ fontSize: '0.75rem' }}>{r.reason}</div>}
                    </td>
                    <td style={th} className="muted">{r.receipt_ref || '—'}</td>
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

function Fig({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, fontSize: '1.3rem', color: accent || 'var(--hull)' }}>{value}</div>
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
