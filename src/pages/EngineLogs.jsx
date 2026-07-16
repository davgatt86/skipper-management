import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import BackNav from '../BackNav'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

// ------------------------------------------------------------------
// Parameter template — modelled on Ægir's Engine Log. Readings are
// grouped by equipment; each entry stores { group: { param: value } }
// in engine_logs.readings (jsonb), so this template can be tweaked
// without a DB migration. Units are shown next to each input.
// ------------------------------------------------------------------
const P = (label, unit = '') => ({ label, unit })

export const ENGINE_TEMPLATE = [
  {
    group: 'Main Engine 1',
    hoursParam: 'Running Hours',           // this param feeds the headline running-hours figure
    params: [
      P('RPM', 'rpm'), P('GOV'),
      P('Charge Air Pressure', 'bar'), P('Charge Air Temp', '°C'),
      P('Turbo IN Temp', '°C'), P('Turbo OUT Temp', '°C'),
      P('Unit 1 Exhaust Temp', '°C'), P('Unit 2 Exhaust Temp', '°C'),
      P('Unit 3 Exhaust Temp', '°C'), P('Unit 4 Exhaust Temp', '°C'),
      P('Unit 5 Exhaust Temp', '°C'), P('Unit 6 Exhaust Temp', '°C'),
      P('Unit 7 Exhaust Temp', '°C'), P('Unit 8 Exhaust Temp', '°C'),
      P('HT Pressure', 'bar'), P('HT IN Temp', '°C'), P('HT OUT Temp', '°C'),
      P('LT Pressure', 'bar'), P('LT IN Temp', '°C'), P('LT OUT Temp', '°C'),
      P('Lube Oil Pressure', 'bar'), P('Lube Oil IN Temp', '°C'), P('Lube Oil OUT Temp', '°C'),
      P('Fuel Pressure', 'bar'), P('Start Air Pressure', 'bar'), P('Stop Air Pressure', 'bar'),
      P('Oil added', 'L'), P('Running Hours', 'h'),
    ],
  },
  {
    group: 'Generator 1',
    params: [
      P('Oil', 'bar'), P('RPM', 'rpm'), P('Load', 'kW'),
      P('Jacket Water Temp', '°C'), P('Exhaust Temp', '°C'), P('Inst Fuel', 'L'),
      P('Fuel Pressure', 'bar'), P('Oil added', 'L'), P('Running Hours', 'h'),
    ],
  },
  {
    group: 'Generator 2',
    params: [
      P('Oil', 'bar'), P('RPM', 'rpm'), P('Load', 'kW'),
      P('Jacket Water Temp', '°C'), P('Exhaust Temp', '°C'), P('Inst Fuel', 'L'),
      P('Fuel Pressure', 'bar'), P('Oil added', 'L'), P('Running Hours', 'h'),
    ],
  },
  {
    group: 'Gearbox 1',
    params: [
      P('Oil Press', 'bar'), P('Oil Temp IN', '°C'), P('Oil Temp OUT', '°C'),
      P('Thrust Bearing Temp', '°C'), P('Clutch Pressure', 'bar'),
      P('PTO 1 Bearing Temp', '°C'), P('PTO 2 Bearing Temp', '°C'), P('PTO 3 Bearing Temp', '°C'),
      P('Pitch', '%'),
    ],
  },
]

const MAIN_HOURS = { group: 'Main Engine 1', param: 'Running Hours' }

const today = () => new Date().toISOString().slice(0, 10)
const fmt = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '')
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

const blankEntry = () => ({ log_date: today(), readings: {}, notes: '', logged_by: '', edit_reason: '' })

export default function EngineLogs() {
  const { appUser } = useAuth()
  const canEdit = appUser?.role === 'skipper'

  const [vessel, setVessel] = useState(null)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [draft, setDraft] = useState(null)     // null = form closed
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function loadAll() {
    setLoading(true); setError('')
    const [v, l] = await Promise.all([
      supabase.from('vessel_details').select('*').maybeSingle(),
      supabase.from('engine_logs').select('*').order('log_date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    if (v.data) setVessel(v.data)
    if (l.error) setError(l.error.message)
    setLogs(l.data || [])
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  const setReading = (group, param, val) =>
    setDraft((p) => ({ ...p, readings: { ...p.readings, [group]: { ...(p.readings[group] || {}), [param]: val } } }))

  function openNew() { setEditingId(null); setDraft(blankEntry()); setMsg('') }
  function openEdit(l) {
    setEditingId(l.id)
    setDraft({
      log_date: l.log_date || today(),
      readings: l.readings || {},
      notes: l.notes || '',
      logged_by: l.logged_by || '',
      edit_reason: '',
    })
    setMsg('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function cancel() { setDraft(null); setEditingId(null) }

  const summary = useMemo(() => {
    const latest = logs.find((l) => l.running_hours != null)
    return {
      running: latest?.running_hours ?? null,
      entries: logs.length,
      last: logs[0]?.log_date || null,
    }
  }, [logs])

  async function save() {
    if (!canEdit || !draft) return
    if (!draft.log_date) { setMsg('Pick a date for the entry.'); return }
    setSaving(true); setMsg('')

    // clean readings → numbers, drop empties
    const readings = {}
    for (const g of Object.keys(draft.readings || {})) {
      const params = {}
      for (const k of Object.keys(draft.readings[g] || {})) {
        const n = num(draft.readings[g][k])
        if (n !== null && !Number.isNaN(n)) params[k] = n
      }
      if (Object.keys(params).length) readings[g] = params
    }
    const running = readings[MAIN_HOURS.group]?.[MAIN_HOURS.param] ?? null

    const base = {
      fleet_id: appUser.fleet_id,
      log_date: draft.log_date,
      running_hours: running,
      readings,
      notes: draft.notes?.trim() || '',
      logged_by: draft.logged_by?.trim() || appUser.display_name || null,
      updated_at: new Date().toISOString(),
    }

    if (editingId) {
      const { data, error } = await supabase.from('engine_logs')
        .update({ ...base, edited_at: new Date().toISOString(), edit_reason: draft.edit_reason?.trim() || null })
        .eq('id', editingId).select().single()
      setSaving(false)
      if (error) { setMsg(`Couldn’t save: ${error.message}`); return }
      setLogs((p) => p.map((x) => (x.id === editingId ? data : x)))
    } else {
      const { data, error } = await supabase.from('engine_logs').insert(base).select().single()
      setSaving(false)
      if (error) { setMsg(`Couldn’t save: ${error.message}`); return }
      setLogs((p) => [data, ...p].sort((a, b) => (b.log_date || '').localeCompare(a.log_date || '')))
    }
    setDraft(null); setEditingId(null)
    setMsg('Engine log saved ✓')
    setTimeout(() => setMsg(''), 2500)
  }

  async function del(l) {
    if (!confirm(`Delete the engine log for ${fmt(l.log_date)}? This can’t be undone.`)) return
    const { error } = await supabase.from('engine_logs').delete().eq('id', l.id)
    if (error) setError(error.message)
    else setLogs((p) => p.filter((x) => x.id !== l.id))
  }

  const missingVessel = !vessel || !(vessel.vessel_name || vessel.pln)

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}><BackNav /></div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Engine Log</h1>
          <p className="muted" style={{ marginTop: '0.2rem', fontSize: '0.85rem' }}>
            Also: <Link to="/crew-list">Crew List</Link> · <Link to="/crew-certs">Crew Certificates</Link>
          </p>
        </div>
        <Link to="/">← Dashboard</Link>
      </header>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {missingVessel && (
        <div className="card" style={{ borderColor: 'var(--amber)' }}>
          <p style={{ margin: 0 }}>Set your vessel details so they print on the engine-log PDF. <Link to="/vessel">Open Vessel page →</Link></p>
        </div>
      )}

      {/* Summary strip */}
      <div className="card">
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'center' }}>
          <Stat label="Running hours" value={summary.running != null ? `${Number(summary.running).toLocaleString('en-GB')} h` : '—'} accent="var(--navy)" />
          <Stat label="Log entries" value={summary.entries} />
          <Stat label="Last entry" value={summary.last ? fmt(summary.last) : '—'} />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {logs.length > 0 && <button className="secondary" onClick={() => makePdf(vessel, logs)} style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>Export PDF</button>}
            {canEdit && !draft && <button onClick={openNew} style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>+ Record log</button>}
          </div>
        </div>
      </div>

      {/* Record / edit form */}
      {canEdit && draft && (
        <div className="card" style={{ borderColor: 'var(--navy)' }}>
          <h2 style={{ marginTop: 0 }}>{editingId ? 'Edit engine log' : 'Record engine log'}</h2>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Field label="Date"><input type="date" value={draft.log_date} onChange={(e) => setDraft((p) => ({ ...p, log_date: e.target.value }))} /></Field>
            <Field label="Logged by"><input value={draft.logged_by} onChange={(e) => setDraft((p) => ({ ...p, logged_by: e.target.value }))} placeholder={appUser?.display_name || 'Name'} /></Field>
            {editingId && <Field label="Edit reason"><input value={draft.edit_reason} onChange={(e) => setDraft((p) => ({ ...p, edit_reason: e.target.value }))} placeholder="e.g. Corrected" /></Field>}
          </div>

          {ENGINE_TEMPLATE.map((grp) => (
            <div key={grp.group} style={{ marginTop: '1.1rem' }}>
              <h3 style={{ marginBottom: '0.4rem' }}>{grp.group}</h3>
              <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                {grp.params.map((p) => (
                  <label key={p.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', fontWeight: 600 }}>
                    <span>{p.label}{p.unit ? <span className="muted" style={{ fontWeight: 400 }}> ({p.unit})</span> : null}</span>
                    <input type="number" step="any" inputMode="decimal"
                      value={draft.readings[grp.group]?.[p.label] ?? ''}
                      onChange={(e) => setReading(grp.group, p.label, e.target.value)}
                      style={{ padding: '0.4rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', fontWeight: 400 }} />
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginTop: '1rem' }}>
            <Field label="Notes"><textarea rows={2} value={draft.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} placeholder="Oil change due, minor leak, filter changed…" style={{ resize: 'vertical' }} /></Field>
          </div>

          <div style={{ marginTop: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save engine log')}</button>
            <button className="secondary" onClick={cancel} disabled={saving}>Cancel</button>
            {msg && <span style={{ color: msg.includes('✓') ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{msg}</span>}
          </div>
        </div>
      )}
      {!draft && msg && <div className="card"><span style={{ color: 'var(--green)', fontWeight: 600 }}>{msg}</span></div>}

      {/* History */}
      {loading ? (
        <div className="card"><p className="muted">Loading…</p></div>
      ) : logs.length === 0 ? (
        <div className="card"><p className="muted">No engine logs yet.{canEdit ? ' Record your first entry above.' : ''}</p></div>
      ) : (
        logs.map((l) => (
          <div key={l.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <strong style={{ fontSize: '1.05rem' }}>{fmt(l.log_date)}</strong>
                {l.running_hours != null && <span className="muted" style={{ marginLeft: '0.6rem' }}>{Number(l.running_hours).toLocaleString('en-GB')} h</span>}
                <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.15rem' }}>
                  Logged by: {l.logged_by || '—'}
                  {l.edited_at && <span> · edited {fmt(l.edited_at)}{l.edit_reason ? ` — ${l.edit_reason}` : ''}</span>}
                </div>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button className="secondary" onClick={() => openEdit(l)} style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>Edit</button>
                  <button className="secondary" onClick={() => del(l)} style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>Delete</button>
                </div>
              )}
            </div>

            <div style={{ marginTop: '0.6rem', display: 'grid', gap: '0.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {ENGINE_TEMPLATE.filter((grp) => l.readings?.[grp.group] && Object.keys(l.readings[grp.group]).length).map((grp) => (
                <div key={grp.group} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem 0.6rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.3rem' }}>{grp.group}</div>
                  <div style={{ display: 'grid', gap: '0.15rem 0.6rem', gridTemplateColumns: '1fr auto', fontSize: '0.8rem' }}>
                    {grp.params.filter((p) => l.readings[grp.group][p.label] != null).map((p) => (
                      <div key={p.label} style={{ display: 'contents' }}>
                        <span className="muted">{p.label}</span>
                        <span style={{ fontWeight: 600, textAlign: 'right' }}>{l.readings[grp.group][p.label]}{p.unit ? ` ${p.unit}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {l.notes && <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.6rem' }}><strong>Notes:</strong> {l.notes}</p>}
          </div>
        ))
      )}
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: accent || 'var(--navy)' }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600 }}>
      {label}{children}
    </label>
  )
}

// ---------------- PDF ----------------
function makePdf(vessel, logs) {
  const v = vessel || {}
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  let y = 46

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('ENGINE LOG', W / 2, y, { align: 'center' }); y += 22
  const vesselTitle = [v.vessel_name, v.pln].filter(Boolean).join('  ·  ') || '—'
  doc.setFontSize(12); doc.text(vesselTitle, W / 2, y, { align: 'center' }); y += 18

  logs.forEach((l) => {
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 46 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
    doc.text(`${fmt(l.log_date)}${l.running_hours != null ? `   ·   ${Number(l.running_hours).toLocaleString('en-GB')} h` : ''}`, M, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120)
    doc.text(`Logged by: ${l.logged_by || '—'}`, W - M, y, { align: 'right' }); doc.setTextColor(0)
    y += 8

    ENGINE_TEMPLATE.forEach((grp) => {
      const r = l.readings?.[grp.group]
      if (!r || !Object.keys(r).length) return
      const body = grp.params.filter((p) => r[p.label] != null).map((p) => [p.label, `${r[p.label]}${p.unit ? ' ' + p.unit : ''}`])
      if (!body.length) return
      autoTable(doc, {
        startY: y + 4,
        head: [[grp.group, '']],
        body,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [20, 50, 80], textColor: 255, fontSize: 8 },
        columnStyles: { 1: { halign: 'right' } },
        margin: { left: M, right: M },
        tableWidth: (W - 2 * M) / 2 - 6,
      })
      y = doc.lastAutoTable.finalY + 6
    })
    if (l.notes) { doc.setFontSize(8); doc.text(`Notes: ${l.notes}`, M, y + 4, { maxWidth: W - 2 * M }); y += 14 }
    y += 10
  })

  doc.setFontSize(8); doc.setTextColor(120)
  doc.text(`Generated ${new Date().toLocaleString('en-GB')} · Skipper Management`, M, doc.internal.pageSize.getHeight() - 20)
  doc.save(`engine-log-${(v.pln || v.vessel_name || 'vessel').toString().replace(/[^\w]+/g, '-')}-${today()}.pdf`)
}
