import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

function money(n, currency) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n)
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(num)
    } catch { /* fall through */ }
  }
  return `${currency || ''}${num.toFixed(2)}`
}

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

export default function Landings() {
  const { appUser } = useAuth()
  const [landings, setLandings] = useState([])
  const [crew, setCrew] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [fDate, setFDate] = useState('')
  const [fBoxes, setFBoxes] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [fCrew, setFCrew] = useState([])
  const [busy, setBusy] = useState(false)

  const canEdit = appUser?.role === 'skipper'

  async function loadAll() {
    setLoading(true)
    const [lRes, cRes, sRes] = await Promise.all([
      supabase
        .from('landings')
        .select('*, landing_crew(crew_id)')
        .order('landing_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('crew')
        .select('id, full_name, status, archived_at')
        .order('full_name'),
      supabase.from('settings').select('*').maybeSingle(),
    ])
    const firstError = lRes.error || cRes.error || sRes.error
    if (firstError) setError(firstError.message)
    setLandings(lRes.data || [])
    setCrew(cRes.data || [])
    setSettings(sRes.data || null)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const crewName = {}
  for (const c of crew) crewName[c.id] = c.full_name
  const activeCrew = crew.filter(c => !c.archived_at)

  function openAdd() {
    setEditingId(null)
    setFDate(new Date().toISOString().slice(0, 10))
    setFBoxes('')
    setFNotes('')
    setFCrew(activeCrew.filter(c => c.status === 'on_boat').map(c => c.id))
    setError('')
    setFormOpen(true)
  }

  function openEdit(l) {
    setEditingId(l.id)
    setFDate(l.landing_date)
    setFBoxes(String(l.boxes))
    setFNotes(l.notes || '')
    setFCrew((l.landing_crew || []).map(x => x.crew_id))
    setError('')
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setError('')
  }

  function toggleCrew(id) {
    setFCrew(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function saveLanding(e) {
    e.preventDefault()
    if (!fDate || fBoxes === '') return
    if (fCrew.length === 0) {
      setError('Tick at least one crewman aboard.')
      return
    }
    setBusy(true)
    setError('')

    if (editingId) {
      const { error: upErr } = await supabase
        .from('landings')
        .update({ landing_date: fDate, boxes: Number(fBoxes), notes: fNotes.trim() || null })
        .eq('id', editingId)
      if (upErr) { setError(upErr.message); setBusy(false); return }

      const { error: delErr } = await supabase
        .from('landing_crew')
        .delete()
        .eq('landing_id', editingId)
      if (delErr) { setError(delErr.message); setBusy(false); return }

      const { error: lcErr } = await supabase
        .from('landing_crew')
        .insert(fCrew.map(crew_id => ({ landing_id: editingId, crew_id })))
      if (lcErr) { setError(lcErr.message); setBusy(false); return }
    } else {
      const { data, error: insErr } = await supabase
        .from('landings')
        .insert({
          fleet_id: appUser.fleet_id,
          landing_date: fDate,
          boxes: Number(fBoxes),
          notes: fNotes.trim() || null,
          locked: false,
          created_by: appUser.id,
        })
        .select('id')
        .single()
      if (insErr) { setError(insErr.message); setBusy(false); return }

      const { error: lcErr } = await supabase
        .from('landing_crew')
        .insert(fCrew.map(crew_id => ({ landing_id: data.id, crew_id })))
      if (lcErr) {
        setError(`Landing saved but crew list failed: ${lcErr.message}. Edit the landing to fix the crew.`)
        setBusy(false)
        loadAll()
        return
      }
    }

    setBusy(false)
    closeForm()
    loadAll()
  }

  async function deleteLanding(l) {
    if (!confirm(`Delete the landing of ${l.boxes} boxes on ${fmtDate(l.landing_date)}? This can't be undone.`)) return
    const { error: lcErr } = await supabase.from('landing_crew').delete().eq('landing_id', l.id)
    if (lcErr) { setError(lcErr.message); return }
    const { error: lErr } = await supabase.from('landings').delete().eq('id', l.id)
    if (lErr) setError(lErr.message)
    else loadAll()
  }

  function crewCell(l) {
    const ids = (l.landing_crew || []).map(x => x.crew_id)
    const names = ids.map(id => crewName[id]).filter(Boolean)
    const unknown = ids.length - names.length
    return (
      <span>
        <span style={{ fontWeight: 600 }}>{ids.length}</span>
        {names.length > 0 && (
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {names.join(', ')}{unknown > 0 ? ` +${unknown} more` : ''}
          </div>
        )}
      </span>
    )
  }

  const thisMonth = new Date().toISOString().slice(0, 7)
  const monthLandings = landings.filter(l => (l.landing_date || '').startsWith(thisMonth))
  const monthBoxes = monthLandings.reduce((s, l) => s + (l.boxes || 0), 0)
  const boxRate = settings ? Number(settings.box_rate) : null
  const cur = settings?.currency || ''

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/" style={{ fontSize: '0.9rem' }}>← Back to Dashboard</Link>
      </div>

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Landings</h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            This month: {monthLandings.length} landing{monthLandings.length === 1 ? '' : 's'}, {monthBoxes} boxes
          </p>
        </div>
        {canEdit && !formOpen && (
          <button onClick={openAdd}>+ Add landing</button>
        )}
      </header>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {formOpen && (
        <div className="card">
          <h2>{editingId ? 'Edit landing' : 'Add landing'}</h2>
          <form onSubmit={saveLanding}>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Landing date</div>
              <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} required autoFocus />
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Boxes</div>
              <input type="number" min="1" step="1" value={fBoxes} onChange={(e) => setFBoxes(e.target.value)} placeholder="e.g. 250" required />
              {fBoxes !== '' && boxRate !== null && (
                <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
                  Bonus per man: {money(Number(fBoxes) * boxRate, cur)} ({money(boxRate, cur)}/box)
                </div>
              )}
            </label>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Crew aboard</div>
              {activeCrew.length === 0 && <p className="muted">No crew available.</p>}
              {activeCrew.map(m => (
                <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <input
                    type="checkbox"
                    checked={fCrew.includes(m.id)}
                    onChange={() => toggleCrew(m.id)}
                    style={{ width: 'auto' }}
                  />
                  <span>{m.full_name}</span>
                  {m.status === 'on_boat' && <span style={{ color: 'var(--green)', fontSize: '0.8rem' }}>on boat</span>}
                </label>
              ))}
            </div>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Notes — optional</div>
              <input type="text" value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="e.g. Hanstholm, pair trip" />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : (editingId ? 'Save changes' : 'Add')}</button>
              <button type="button" className="secondary" onClick={closeForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading && <p className="muted">Loading…</p>}
        {!loading && landings.length === 0 && (
          <p className="muted">No landings yet. {canEdit && 'Click "Add landing" above to enter the first.'}</p>
        )}
        {!loading && landings.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Date</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Boxes</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Crew aboard</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Bonus/man</th>
                  {canEdit && <th style={{ padding: '0.6rem 0.4rem', textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {landings.map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 0.4rem', fontWeight: 600 }}>
                      {fmtDate(l.landing_date)}
                      {l.notes && <div className="muted" style={{ fontSize: '0.8rem', fontWeight: 400 }}>{l.notes}</div>}
                    </td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>{l.boxes}</td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>{crewCell(l)}</td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>
                      {boxRate !== null ? money(l.boxes * boxRate, cur) : '—'}
                    </td>
                    {canEdit && (
                      <td style={{ padding: '0.6rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {l.locked ? (
                          <span className="muted" style={{ fontSize: '0.85rem' }}>🔒 Locked</span>
                        ) : (
                          <>
                            <button
                              className="secondary"
                              onClick={() => openEdit(l)}
                              style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem', marginLeft: '0.3rem' }}
                            >
                              Edit
                            </button>
                            <button
                              className="secondary"
                              onClick={() => deleteLanding(l)}
                              style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem', marginLeft: '0.3rem' }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
