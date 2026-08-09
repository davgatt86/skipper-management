import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import CrewTabs from '../CrewTabs'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { keepsCrewRecords } from '../lib/roles'

// Section 3 of the crew page: the crew list.
//
// It is GENERATED from the status set in section 1 — the crew aboard are the
// crew aboard, and this page does not ask you to tick them off again. All it
// asks for is the voyage: where from, when, last port. Anything else it needs
// is on the crew record.
//
// The output aims at IMO FAL Form 5, which is what Aegir exports and what a
// port official actually expects to be handed.

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
const isExpired = (d) => !!d && new Date(String(d).slice(0, 10) + 'T00:00:00') < new Date(today() + 'T00:00:00')

const blankManual = () => ({
  full_name: '', rank: 'Master', nationality: '', date_of_birth: '',
  place_of_birth: '', passport_number: '', passport_country: '', passport_expiry: '',
})

// FAL 5 asks for each of these. Missing any of them is why a crew list gets
// handed back at the gate, so they are named plainly rather than counted.
const REQUIRED = [
  ['passport_number', 'passport number'],
  ['nationality', 'nationality'],
  ['date_of_birth', 'date of birth'],
  ['place_of_birth', 'place of birth'],
]

export default function CrewList() {
  const { appUser } = useAuth()
  const canEdit = keepsCrewRecords(appUser)

  const [vessel, setVessel] = useState(null)
  const [crew, setCrew] = useState([])
  const [ranks, setRanks] = useState(FALLBACK_RANKS)
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [voyage, setVoyage] = useState({ departure_date: today(), departure_port: '', last_port: '', next_port: '', notes: '' })
  const [sel, setSel] = useState({})        // crew_id -> { on, rank }
  const [adjusting, setAdjusting] = useState(false)
  const [manual, setManual] = useState([])
  const [draftPerson, setDraftPerson] = useState(blankManual())
  const [addingPerson, setAddingPerson] = useState(false)
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
    // Generated from status: whoever is On Boat is on the list, at the rank
    // held on their own record.
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

  const aboard = useMemo(() => crew.filter((c) => sel[c.id]?.on), [crew, sel])
  const chosenCount = aboard.length + manual.filter((m) => m.full_name.trim()).length

  // Whose papers would leave a hole in the form.
  const gaps = useMemo(() => aboard.map((c) => ({
    crew: c,
    missing: REQUIRED.filter(([k]) => !c[k]).map(([, label]) => label),
    expired: isExpired(c.passport_expiry),
  })).filter((g) => g.missing.length || g.expired), [aboard])

  // Status disagreements are worth surfacing but are NOT fixed here — status
  // is set in section 1 and nowhere else.
  const offBoatIncluded = crew.filter((c) => sel[c.id]?.on && c.status !== 'on_boat')
  const onBoatExcluded = crew.filter((c) => !sel[c.id]?.on && c.status === 'on_boat')

  function addManual() {
    if (!draftPerson.full_name.trim()) return
    setManual((p) => [...p, draftPerson])
    setDraftPerson(blankManual())
    setAddingPerson(false)
  }
  const removeManual = (i) => setManual((p) => p.filter((_, idx) => idx !== i))

  function buildMembers() {
    const rows = []
    manual.forEach((m) => m.full_name.trim() && rows.push({
      crew_id: null, full_name: m.full_name.trim(), rank: m.rank,
      nationality: m.nationality || null, date_of_birth: m.date_of_birth || null,
      place_of_birth: m.place_of_birth || null,
      passport_number: m.passport_number || null, passport_country: m.passport_country || null,
      passport_expiry: m.passport_expiry || null,
    }))
    aboard.forEach((c) => rows.push({
      crew_id: c.id, full_name: c.full_name, rank: sel[c.id]?.rank || 'Deckhand',
      nationality: c.nationality || null, date_of_birth: c.date_of_birth || null,
      place_of_birth: c.place_of_birth || null,
      passport_number: c.passport_number || null, passport_country: c.passport_country || null,
      passport_expiry: c.passport_expiry || null,
    }))
    return rows.map((r, i) => ({ ...r, position: i }))
  }

  async function saveVoyage() {
    if (!canEdit) return
    const members = buildMembers()
    if (!members.length) { setMsg('Nobody is aboard. Set who is aboard on Crew status first.'); return }
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
    makeFal5(vessel, list, members || [])
  }

  async function deleteList(list) {
    if (!confirm(`Delete the crew list for ${fmt(list.departure_date) || 'this voyage'}? This can’t be undone.`)) return
    const { error } = await supabase.from('crew_lists').delete().eq('id', list.id)
    if (error) setError(error.message)
    else setLists((p) => p.filter((l) => l.id !== list.id))
  }

  const missingVessel = !vessel || !(vessel.vessel_name || vessel.pln)
  const th = { padding: '0.5rem 0.4rem' }

  return (
    <AppShell>
      <PageHeader title="Crew List" sub="IMO FAL 5 — generated from who is aboard" />

      <CrewTabs />

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      {missingVessel && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <p style={{ margin: 0 }}>Set your vessel details first so they fill in on every crew list. <Link to="/vessel">Open Vessel page →</Link></p>
        </div>
      )}

      {loading ? (
        <div className="card"><p className="muted">Loading…</p></div>
      ) : (
        <>
          {canEdit && (
            <>
              {/* ---- who is aboard, taken from status ---- */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <h2 style={{ marginTop: 0, marginBottom: 0 }}>
                    Aboard <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>({chosenCount})</span>
                  </h2>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    From <Link to="/crew">Crew status</Link>
                  </span>
                </div>

                {aboard.length === 0 && manual.length === 0 && (
                  <p className="muted">
                    Nobody is marked On Boat. Set who is aboard on <Link to="/crew">Crew status</Link> — this list follows it.
                  </p>
                )}

                {(aboard.length > 0 || manual.length > 0) && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                          <th style={th}>#</th>
                          <th style={th}>Name</th>
                          <th style={th}>Rank</th>
                          <th style={th}>Nationality</th>
                          <th style={th}>Passport</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manual.map((m, i) => (
                          <tr key={`m${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={th}>{i + 1}</td>
                            <td style={{ ...th, fontWeight: 600 }}>
                              {m.full_name} <span className="muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}>added by hand</span>
                            </td>
                            <td style={th}>{m.rank}</td>
                            <td style={th}>{m.nationality || <span className="muted">—</span>}</td>
                            <td style={th}>
                              {m.passport_number || <span style={{ color: 'var(--brass)', fontWeight: 700 }}>missing</span>}
                              <button className="secondary" onClick={() => removeManual(i)} style={{ marginLeft: '0.5rem', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}>Remove</button>
                            </td>
                          </tr>
                        ))}
                        {aboard.map((c, i) => {
                          const miss = REQUIRED.filter(([k]) => !c[k])
                          const exp = isExpired(c.passport_expiry)
                          return (
                            <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={th}>{manual.length + i + 1}</td>
                              <td style={{ ...th, fontWeight: 600 }}>
                                {c.full_name}
                                {c.status !== 'on_boat' && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--brass)', fontWeight: 700 }}>NOT MARKED ON BOAT</span>}
                              </td>
                              <td style={th}>
                                <select value={sel[c.id]?.rank || 'Deckhand'} onChange={(e) => setRank(c.id, e.target.value)} style={{ width: '100%', padding: '0.25rem 0.4rem', fontSize: '0.85rem' }}>
                                  {ranks.map((r) => <option key={r.code}>{r.label}</option>)}
                                </select>
                              </td>
                              <td style={th}>{c.nationality || <span style={{ color: 'var(--brass)', fontWeight: 700 }}>missing</span>}</td>
                              <td style={th}>
                                {!c.passport_number
                                  ? <span style={{ color: 'var(--brass)', fontWeight: 700 }}>missing</span>
                                  : exp
                                    ? <span style={{ color: 'var(--rust)', fontWeight: 700 }}>{c.passport_number} · expired {fmt(c.passport_expiry)}</span>
                                    : <span>{c.passport_number}</span>}
                                {miss.length > 0 && (
                                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                                    also missing {miss.map(([, l]) => l).join(', ')}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="secondary" onClick={() => setAdjusting((v) => !v)} style={{ fontSize: '0.85rem' }}>
                    {adjusting ? 'Done adjusting' : 'Adjust for this voyage'}
                  </button>
                  <button className="secondary" onClick={() => setAddingPerson((v) => !v)} style={{ fontSize: '0.85rem' }}>
                    {addingPerson ? 'Cancel' : '+ Add someone not in the crew'}
                  </button>
                </div>

                {(offBoatIncluded.length > 0 || onBoatExcluded.length > 0) && (
                  <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0, marginTop: '0.6rem' }}>
                    This voyage differs from Crew status. That is fine for a one-off, but if it is the real
                    picture, change it on <Link to="/crew">Crew status</Link> so everything else agrees.
                  </p>
                )}

                {adjusting && (
                  <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border)' }}>
                    <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
                      Only for a one-off — a man who sailed this trip but is not normally aboard. Status itself is set on Crew status.
                    </p>
                    {crew.map((c) => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', fontSize: '0.9rem' }}>
                        <input type="checkbox" checked={!!sel[c.id]?.on} onChange={() => toggle(c.id)} />
                        <span style={{ fontWeight: 600 }}>{c.full_name}</span>
                        {c.status === 'on_boat' && <span style={{ fontSize: '0.7rem', color: 'var(--kelp)', fontWeight: 700 }}>● ON BOAT</span>}
                      </label>
                    ))}
                  </div>
                )}

                {addingPerson && (
                  <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end' }}>
                      <Field label="Name"><input value={draftPerson.full_name} onChange={(e) => setDraftPerson((p) => ({ ...p, full_name: e.target.value }))} placeholder="As printed in the passport" /></Field>
                      <Field label="Rank"><select value={draftPerson.rank} onChange={(e) => setDraftPerson((p) => ({ ...p, rank: e.target.value }))}>{ranks.map((r) => <option key={r.code}>{r.label}</option>)}</select></Field>
                      <Field label="Nationality"><input value={draftPerson.nationality} onChange={(e) => setDraftPerson((p) => ({ ...p, nationality: e.target.value }))} placeholder="British" /></Field>
                      <Field label="Date of birth"><input type="date" value={draftPerson.date_of_birth} onChange={(e) => setDraftPerson((p) => ({ ...p, date_of_birth: e.target.value }))} /></Field>
                      <Field label="Place of birth"><input value={draftPerson.place_of_birth} onChange={(e) => setDraftPerson((p) => ({ ...p, place_of_birth: e.target.value }))} placeholder="Banff" /></Field>
                      <Field label="Passport no."><input value={draftPerson.passport_number} onChange={(e) => setDraftPerson((p) => ({ ...p, passport_number: e.target.value }))} /></Field>
                      <Field label="Passport country"><input value={draftPerson.passport_country} onChange={(e) => setDraftPerson((p) => ({ ...p, passport_country: e.target.value }))} placeholder="United Kingdom" /></Field>
                      <Field label="Passport expiry"><input type="date" value={draftPerson.passport_expiry} onChange={(e) => setDraftPerson((p) => ({ ...p, passport_expiry: e.target.value }))} /></Field>
                      <button className="secondary" onClick={addManual} style={{ height: 'fit-content' }}>+ Add person</button>
                    </div>
                  </div>
                )}
              </div>

              {/* ---- papers that would leave a hole in the form ---- */}
              {gaps.length > 0 && (
                <div className="card" style={{ borderColor: 'var(--brass)' }}>
                  <h2 style={{ marginTop: 0 }}>Papers missing</h2>
                  <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
                    A crew list is a border document. These will print blank on the FAL 5 — fill them in on <Link to="/crew">Crew status</Link>, under Details.
                  </p>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {gaps.map((g) => (
                      <li key={g.crew.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                        <strong>{g.crew.full_name}</strong>{' '}
                        {g.expired && <span style={{ color: 'var(--rust)', fontWeight: 700, fontSize: '0.82rem' }}>passport expired {fmt(g.crew.passport_expiry)}</span>}
                        {g.expired && g.missing.length > 0 && <span className="muted"> · </span>}
                        {g.missing.length > 0 && <span className="muted" style={{ fontSize: '0.85rem' }}>no {g.missing.join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ---- the voyage: the only thing this page asks for ---- */}
              <div className="card">
                <h2 style={{ marginTop: 0 }}>The voyage</h2>
                <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                  <Field label="Date of departure"><input type="date" value={voyage.departure_date} onChange={(e) => setV('departure_date', e.target.value)} /></Field>
                  <Field label="Port of departure"><input value={voyage.departure_port} onChange={(e) => setV('departure_port', e.target.value)} placeholder="Peterhead" /></Field>
                  <Field label="Last port of call"><input value={voyage.last_port} onChange={(e) => setV('last_port', e.target.value)} placeholder="Hanstholm" /></Field>
                  <Field label="Next port (optional)"><input value={voyage.next_port} onChange={(e) => setV('next_port', e.target.value)} placeholder="" /></Field>
                </div>
                <div style={{ marginTop: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
                  <button onClick={saveVoyage} disabled={saving || chosenCount === 0}>
                    {saving ? 'Saving…' : `Save crew list (${chosenCount})`}
                  </button>
                  {msg && <span style={{ color: msg.includes('✓') ? 'var(--kelp)' : 'var(--rust)', fontWeight: 600 }}>{msg}</span>}
                </div>
              </div>
            </>
          )}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Saved crew lists</h2>
            {lists.length === 0 ? (
              <p className="muted">No crew lists yet. Save one above for the voyage.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                      <th style={th}>Departure</th>
                      <th style={th}>From → Last port</th>
                      <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lists.map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ ...th, fontWeight: 600 }}>{fmt(l.departure_date) || '—'}</td>
                        <td style={th} className="muted">{l.departure_port || '—'}{l.last_port ? ` ← ${l.last_port}` : ''}</td>
                        <td style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button onClick={() => printList(l)} style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem', marginRight: '0.3rem' }}>FAL 5 PDF</button>
                          {canEdit && <button className="secondary" onClick={() => deleteList(l)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}>Delete</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

// ---------------- IMO FAL Form 5 ----------------
// Field numbers follow the FAL 5 form so an official reading it recognises the
// shape. Anything we do not hold prints blank rather than being invented.
function makeFal5(vessel, list, members) {
  const v = vessel || {}
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 32
  let y = 42

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text('CREW LIST', W / 2, y, { align: 'center' })
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text('IMO FAL Form 5', W / 2, y + 13, { align: 'center' })
  y += 30

  // Numbered header fields, laid out in three columns.
  const cells = [
    ['1. Name of ship', v.vessel_name],
    ['2. Port registration / PLN', v.pln],
    ['3. Call sign', v.call_sign],
    ['4. Flag State of ship', v.flag_state],
    ['5. Port of departure', list.departure_port],
    ['6. Date of departure', fmt(list.departure_date)],
    ['7. Last port of call', list.last_port],
    ['8. Next port of call', list.next_port],
    ['9. Master', v.skipper_name],
  ]
  const colW = (W - M * 2) / 3
  doc.setFontSize(8)
  cells.forEach((c, i) => {
    const cx = M + (i % 3) * colW
    const cy = y + Math.floor(i / 3) * 34
    doc.setDrawColor(180); doc.rect(cx, cy, colW, 34)
    doc.setTextColor(110); doc.text(String(c[0]), cx + 5, cy + 11)
    doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text(String(c[1] || '—'), cx + 5, cy + 26)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  })
  y += Math.ceil(cells.length / 3) * 34 + 14
  doc.setTextColor(0)

  const dob = (m) => [fmt(m.date_of_birth), m.place_of_birth].filter(Boolean).join('\n') || ''
  const idDoc = (m) => {
    if (!m.passport_number) return ''
    const bits = [`Passport ${m.passport_number}`]
    if (m.passport_country) bits.push(m.passport_country)
    if (m.passport_expiry) bits.push(`exp ${fmt(m.passport_expiry)}`)
    return bits.join('\n')
  }

  autoTable(doc, {
    startY: y,
    head: [[
      '10.\nNo.',
      '11.\nFamily name, given names',
      '12.\nRank or rating',
      '13.\nNationality',
      '14.\nDate and place of birth',
      '15.\nNature and number of identity document',
    ]],
    body: members.map((m, i) => [
      i + 1, m.full_name || '', m.rank || '', m.nationality || '', dob(m), idDoc(m),
    ]),
    styles: { fontSize: 9, cellPadding: 4, valign: 'top' },
    headStyles: { fillColor: [23, 73, 168], textColor: 255, fontSize: 8 },
    columnStyles: { 0: { cellWidth: 28 } },
    margin: { left: M, right: M },
  })

  let endY = (doc.lastAutoTable?.finalY || y) + 24
  if (endY > H - 80) { doc.addPage(); endY = 60 }
  doc.setFontSize(10)
  doc.text(`Total persons on board: ${members.length}`, M, endY); endY += 28
  doc.text('Signature of Master or authorised officer: ______________________________', M, endY)
  doc.text('Date: ______________', W - M - 160, endY)

  doc.setFontSize(7); doc.setTextColor(130)
  doc.text(`Generated ${new Date().toLocaleString('en-GB')} · Skipper Management`, M, H - 20)

  const fname = `fal5-crew-list-${(v.pln || v.vessel_name || 'vessel').toString().replace(/[^\w]+/g, '-')}-${(list.departure_date || today())}.pdf`
  doc.save(fname)
}
