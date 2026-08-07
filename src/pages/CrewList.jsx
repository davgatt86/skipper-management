import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import CrewTabs from '../CrewTabs'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

// Fallback only. The real list comes from the crew_ranks lookup so the same
// rank cannot be spelled three ways — the mistake Aegir's certificate matrix
// makes by keying off a typed name.
const FALLBACK_RANKS = [
  { code: 'master', label: 'Master' }, { code: 'skipper', label: 'Skipper' },
  { code: 'mate', label: 'Mate' }, { code: 'chief_engineer', label: 'Chief Engineer' },
  { code: 'second_engineer', label: '2nd Engineer' }, { code: 'bosun', label: 'Bosun' },
  { code: 'deckhand', label: 'Deckhand' }, { code: 'cook', label: 'Cook' },
  { code: 'trainee', label: 'Trainee' }, { code: 'other', label: 'Other' },
]
const today = () => new Date().toISOString().slice(0, 10)
const fmt = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '')

const blankManual = () => ({ full_name: '', rank: 'Master', nationality: '', date_of_birth: '', passport_number: '', passport_country: '', passport_expiry: '' })

export default function CrewList() {
  const { appUser } = useAuth()
  const canEdit = appUser?.role === 'skipper'

  const [vessel, setVessel] = useState(null)
  const [crew, setCrew] = useState([])
  const [ranks, setRanks] = useState(FALLBACK_RANKS)
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // builder state
  const [voyage, setVoyage] = useState({ departure_date: today(), departure_port: '', last_port: '', next_port: '', notes: '' })
  const [sel, setSel] = useState({})        // crew_id -> { on: bool, rank }
  const [manual, setManual] = useState([])  // hand-added people (e.g. skipper)
  const [draftPerson, setDraftPerson] = useState(blankManual())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function loadAll() {
    setLoading(true); setError('')
    const [v, c, l, r] = await Promise.all([
      supabase.from('vessel_details').select('*').maybeSingle(),
      supabase.from('crew').select('*').is('archived_at', null).neq('status', 'former').order('full_name'),
      supabase.from('crew_lists').select('*').order('departure_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('crew_ranks').select('code, label').order('sort'),
    ])
    if (v.data) setVessel(v.data)
    const cr = c.data || []
    const rk = (r.data && r.data.length) ? r.data : FALLBACK_RANKS
    setCrew(cr)
    setRanks(rk)
    setLists(l.data || [])
    // Default-select everyone currently On Boat, at the rank held on their own
    // record. Only fall back to Deckhand where no rank has been set — every
    // voyage used to start as a list of deckhands regardless of who they were.
    const byCode = Object.fromEntries(rk.map((x) => [x.code, x.label]))
    const s = {}
    for (const m of cr) s[m.id] = { on: m.status === 'on_boat', rank: byCode[m.rank_code] || 'Deckhand' }
    setSel(s)
    if (c.error) setError(c.error.message)
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  const toggle = (id) => setSel((p) => ({ ...p, [id]: { ...p[id], on: !p[id]?.on } }))
  const setRank = (id, rank) => setSel((p) => ({ ...p, [id]: { ...p[id], rank } }))
  const setV = (k, val) => setVoyage((p) => ({ ...p, [k]: val }))

  const chosenCount = useMemo(
    () => crew.filter((c) => sel[c.id]?.on).length + manual.filter((m) => m.full_name.trim()).length,
    [crew, sel, manual]
  )

  function addManual() {
    if (!draftPerson.full_name.trim()) return
    setManual((p) => [...p, draftPerson])
    setDraftPerson(blankManual())
  }
  const removeManual = (i) => setManual((p) => p.filter((_, idx) => idx !== i))

  // assemble the ordered member snapshot from the current selection
  function buildMembers() {
    const rows = []
    // hand-added first (skipper usually), then selected crew alphabetically
    manual.forEach((m) => m.full_name.trim() && rows.push({
      crew_id: null, full_name: m.full_name.trim(), rank: m.rank,
      nationality: m.nationality || null, date_of_birth: m.date_of_birth || null,
      passport_number: m.passport_number || null, passport_country: m.passport_country || null,
      passport_expiry: m.passport_expiry || null,
    }))
    crew.filter((c) => sel[c.id]?.on).forEach((c) => rows.push({
      crew_id: c.id, full_name: c.full_name, rank: sel[c.id]?.rank || 'Deckhand',
      nationality: c.nationality || null, date_of_birth: c.date_of_birth || null,
      passport_number: c.passport_number || null, passport_country: c.passport_country || null,
      passport_expiry: c.passport_expiry || null,
    }))
    return rows.map((r, i) => ({ ...r, position: i }))
  }

  async function saveVoyage() {
    if (!canEdit) return
    const members = buildMembers()
    if (!members.length) { setMsg('Pick at least one person aboard.'); return }
    setSaving(true); setMsg('')
    const { data: list, error: e1 } = await supabase.from('crew_lists').insert({
      fleet_id: appUser.fleet_id,
      departure_date: voyage.departure_date || null,
      departure_port: voyage.departure_port || null,
      last_port: voyage.last_port || null,
      next_port: voyage.next_port || null,
      notes: voyage.notes || '',
    }).select().single()
    if (e1) { setSaving(false); setMsg(`Couldn’t save: ${e1.message}`); return }
    const rows = members.map((m) => ({ ...m, crew_list_id: list.id, fleet_id: appUser.fleet_id }))
    const { error: e2 } = await supabase.from('crew_list_members').insert(rows)
    setSaving(false)
    if (e2) { setMsg(`Saved voyage but members failed: ${e2.message}`); return }
    setMsg('Crew list saved ✓')
    setManual([])
    setLists((p) => [list, ...p])
    setTimeout(() => setMsg(''), 2500)
  }

  async function printList(list) {
    const { data: members, error } = await supabase
      .from('crew_list_members').select('*').eq('crew_list_id', list.id).order('position')
    if (error) { setError(error.message); return }
    makePdf(vessel, list, members || [])
  }

  async function deleteList(list) {
    if (!confirm(`Delete the crew list for ${fmt(list.departure_date) || 'this voyage'}? This can’t be undone.`)) return
    const { error } = await supabase.from('crew_lists').delete().eq('id', list.id)
    if (error) setError(error.message)
    else setLists((p) => p.filter((l) => l.id !== list.id))
  }

  const onBoatCount = crew.filter((c) => c.status === 'on_boat').length
  const missingVessel = !vessel || !(vessel.vessel_name || vessel.pln)

  return (
    <AppShell>
      <PageHeader title="Crew List" />

      <CrewTabs />

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {missingVessel && (
        <div className="card" style={{ borderColor: 'var(--amber)' }}>
          <p style={{ margin: 0 }}>Set your vessel details first so they fill in on every crew list. <Link to="/vessel">Open Vessel page →</Link></p>
        </div>
      )}

      {loading ? (
        <div className="card"><p className="muted">Loading…</p></div>
      ) : (
        <>
          {canEdit && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>New voyage</h2>
              <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <Field label="Date of departure"><input type="date" value={voyage.departure_date} onChange={(e) => setV('departure_date', e.target.value)} /></Field>
                <Field label="Port of departure"><input value={voyage.departure_port} onChange={(e) => setV('departure_port', e.target.value)} placeholder="Peterhead" /></Field>
                <Field label="Last port of call"><input value={voyage.last_port} onChange={(e) => setV('last_port', e.target.value)} placeholder="Hanstholm" /></Field>
                <Field label="Next port (optional)"><input value={voyage.next_port} onChange={(e) => setV('next_port', e.target.value)} placeholder="" /></Field>
              </div>

              <h3 style={{ marginBottom: '0.4rem' }}>Crew aboard <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>({chosenCount} selected · {onBoatCount} marked On Boat)</span></h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {crew.map((c) => {
                    const on = sel[c.id]?.on
                    const noPass = !c.passport_number
                    const passExpired = c.passport_expiry && new Date(String(c.passport_expiry).slice(0, 10) + 'T00:00:00') < new Date(today() + 'T00:00:00')
                    return (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.4rem', width: 28 }}>
                          <input type="checkbox" checked={!!on} onChange={() => toggle(c.id)} />
                        </td>
                        <td style={{ padding: '0.4rem', fontWeight: 600 }}>
                          {c.full_name}
                          {c.status === 'on_boat' && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--green)', fontWeight: 700 }}>● ON BOAT</span>}
                          {on && noPass && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--amber)', fontWeight: 700 }}>no passport on file</span>}
                          {on && !noPass && passExpired && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--red)', fontWeight: 700 }}>passport expired</span>}
                        </td>
                        <td style={{ padding: '0.4rem', width: 140 }}>
                          {on && (
                            <select value={sel[c.id]?.rank || 'Deckhand'} onChange={(e) => setRank(c.id, e.target.value)} style={{ width: '100%', padding: '0.25rem 0.4rem', fontSize: '0.85rem' }}>
                              {ranks.map((r) => <option key={r.code}>{r.label}</option>)}
                            </select>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* hand-added people (skipper or anyone not in the crew list) */}
              <h3 style={{ marginBottom: '0.4rem', marginTop: '1rem' }}>Add by hand <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>— e.g. the skipper, or a guest not in your crew</span></h3>
              {manual.map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 600 }}>{m.full_name}</span>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>{m.rank}{m.passport_number ? ` · ${m.passport_number}` : ''}</span>
                  <button className="secondary" onClick={() => removeManual(i)} style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>Remove</button>
                </div>
              ))}
              <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: '0.5rem', alignItems: 'end' }}>
                <Field label="Name"><input value={draftPerson.full_name} onChange={(e) => setDraftPerson((p) => ({ ...p, full_name: e.target.value }))} placeholder="David Gatt" /></Field>
                <Field label="Rank"><select value={draftPerson.rank} onChange={(e) => setDraftPerson((p) => ({ ...p, rank: e.target.value }))}>{ranks.map((r) => <option key={r.code}>{r.label}</option>)}</select></Field>
                <Field label="Nationality"><input value={draftPerson.nationality} onChange={(e) => setDraftPerson((p) => ({ ...p, nationality: e.target.value }))} placeholder="British" /></Field>
                <Field label="Date of birth"><input type="date" value={draftPerson.date_of_birth} onChange={(e) => setDraftPerson((p) => ({ ...p, date_of_birth: e.target.value }))} /></Field>
                <Field label="Passport no."><input value={draftPerson.passport_number} onChange={(e) => setDraftPerson((p) => ({ ...p, passport_number: e.target.value }))} /></Field>
                <Field label="Passport country"><input value={draftPerson.passport_country} onChange={(e) => setDraftPerson((p) => ({ ...p, passport_country: e.target.value }))} placeholder="United Kingdom" /></Field>
                <Field label="Passport expiry"><input type="date" value={draftPerson.passport_expiry} onChange={(e) => setDraftPerson((p) => ({ ...p, passport_expiry: e.target.value }))} /></Field>
                <button className="secondary" onClick={addManual} style={{ height: 'fit-content' }}>+ Add person</button>
              </div>

              <div style={{ marginTop: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                <button onClick={saveVoyage} disabled={saving || chosenCount === 0}>{saving ? 'Saving…' : `Save crew list (${chosenCount})`}</button>
                {msg && <span style={{ color: msg.includes('✓') ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{msg}</span>}
              </div>
            </div>
          )}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Saved crew lists</h2>
            {lists.length === 0 ? (
              <p className="muted">No crew lists yet. Build one above and save it for the voyage.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: '0.5rem 0.4rem' }}>Departure</th>
                    <th style={{ padding: '0.5rem 0.4rem' }}>From → Last port</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lists.map((l) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.5rem 0.4rem', fontWeight: 600 }}>{fmt(l.departure_date) || '—'}</td>
                      <td style={{ padding: '0.5rem 0.4rem' }} className="muted">{l.departure_port || '—'}{l.last_port ? ` ← ${l.last_port}` : ''}</td>
                      <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => printList(l)} style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem', marginRight: '0.3rem' }}>Print PDF</button>
                        {canEdit && <button className="secondary" onClick={() => deleteList(l)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}>Delete</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AppShell>
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
function makePdf(vessel, list, members) {
  const v = vessel || {}
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  let y = 46

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('VESSEL CREW LIST', W / 2, y, { align: 'center' }); y += 22

  // vessel header
  const vesselTitle = [v.vessel_name, v.pln].filter(Boolean).join('  ·  ') || '—'
  doc.setFontSize(12); doc.text(vesselTitle, W / 2, y, { align: 'center' }); y += 18

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const pair = (label, val) => `${label}: ${val || '—'}`
  const colL = M, colR = W / 2 + 10
  const rows = [
    [pair('Call sign', v.call_sign), pair('MMSI', v.mmsi)],
    [pair('Home port', v.home_port), pair('Port of departure', list.departure_port)],
    [pair('Last port of call', list.last_port), pair('Date of departure', fmt(list.departure_date))],
  ]
  if (list.next_port) rows.push([pair('Next port', list.next_port), ''])
  rows.forEach(([a, b]) => { doc.text(String(a), colL, y); if (b) doc.text(String(b), colR, y); y += 15 })
  y += 6

  autoTable(doc, {
    startY: y,
    head: [['#', 'Name', 'Rank', 'Nationality', 'Date of birth', 'Passport no.', 'Country', 'Passport expiry']],
    body: members.map((m, i) => [
      i + 1, m.full_name || '', m.rank || '', m.nationality || '',
      fmt(m.date_of_birth), m.passport_number || '', m.passport_country || '', fmt(m.passport_expiry),
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [20, 50, 80], textColor: 255 },
    margin: { left: M, right: M },
  })

  let endY = (doc.lastAutoTable?.finalY || y) + 30
  doc.setFontSize(10)
  doc.text(`Persons on board: ${members.length}`, M, endY); endY += 26
  doc.text('Skipper signature: ______________________________', M, endY)
  doc.text('Date: ______________', W - M - 150, endY)

  doc.setFontSize(8); doc.setTextColor(120)
  doc.text(`Generated ${new Date().toLocaleString('en-GB')} · Skipper Management`, M, doc.internal.pageSize.getHeight() - 24)

  const fname = `crew-list-${(v.pln || v.vessel_name || 'vessel').toString().replace(/[^\w]+/g, '-')}-${(list.departure_date || today())}.pdf`
  doc.save(fname)
}
