import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BackNav from '../BackNav'
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
  const [contracts, setContracts] = useState([])

  const canEdit = appUser?.role === 'skipper'

  async function loadAll() {
    setLoading(true)
    const [lRes, cRes, sRes, ctRes] = await Promise.all([
      supabase
        .from('landings')
        .select('*, landing_crew(crew_id)')
        .order('landing_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('crew')
        .select('id, full_name, status, archived_at, crew_type')
        .order('full_name'),
      supabase.from('settings').select('*').maybeSingle(),
      supabase.from('contracts').select('crew_id, start_date, end_date'),
    ])
    const firstError = lRes.error || cRes.error || sRes.error || ctRes.error
    if (firstError) setError(firstError.message)
    setLandings(lRes.data || [])
    setCrew(cRes.data || [])
    setSettings(sRes.data || null)
    setContracts(ctRes.data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const crewName = {}
  for (const c of crew) crewName[c.id] = c.full_name
  const activeCrew = crew.filter(c => !c.archived_at)

  // Contracted crew aboard on a date = crew with an agency contract
  // covering it (open-ended contracts count). Self-employed rotation
  // crew don't earn box bonus, so they're never auto-added.
  function aboardOn(date) {
    const ids = [...new Set(contracts
      .filter(ct => ct.start_date <= date && (!ct.end_date || date <= ct.end_date))
      .map(ct => ct.crew_id))]
    return ids.filter(id => {
      const c = crew.find(x => x.id === id)
      return c && !c.archived_at
    })
  }

  function openAdd() {
    setEditingId(null)
    setFDate(new Date().toISOString().slice(0, 10))
    setFBoxes('')
    setFNotes('')
    const today = new Date().toISOString().slice(0, 10)
    const fromContracts = aboardOn(today)
    setFCrew(fromContracts.length
      ? fromContracts
      : activeCrew.filter(c => c.status === 'on_boat' && c.crew_type !== 'self_employed').map(c => c.id))
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

      // Diff the crew list instead of delete-all-then-reinsert: a retry or
      // double-tap on a slow connection could land between the two steps,
      // wiping the crew and then failing on landing_crew_pkey. Removing
      // only de-ticked crew and adding only new ones is safe to repeat.
      const before = (landings.find(x => x.id === editingId)?.landing_crew || []).map(x => x.crew_id)
      const toRemove = before.filter(id => !fCrew.includes(id))
      const toAdd = fCrew.filter(id => !before.includes(id))
      if (toRemove.length) {
        const { error: delErr } = await supabase
          .from('landing_crew')
          .delete()
          .eq('landing_id', editingId)
          .in('crew_id', toRemove)
        if (delErr) { setError(delErr.message); setBusy(false); return }
      }
      if (toAdd.length) {
        // upsert = ON CONFLICT DO NOTHING: a hidden duplicate no longer
        // aborts the whole batch, and any error left is a real one we show
        const { error: lcErr } = await supabase
          .from('landing_crew')
          .upsert(toAdd.map(crew_id => ({ landing_id: editingId, crew_id })),
                  { onConflict: 'landing_id,crew_id', ignoreDuplicates: true })
        if (lcErr) { setError(`Crew not saved: ${lcErr.message}`); setBusy(false); return }
      }
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
        .upsert(fCrew.map(crew_id => ({ landing_id: data.id, crew_id })),
                { onConflict: 'landing_id,crew_id', ignoreDuplicates: true })
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

  // Landings with no crew aboard: repair adds the crew whose contract
  // covered each landing date (falls back to contracted on-boat crew if
  // no contract matches). "Remove all" clears crew from every unlocked
  // landing so a clean contract-based re-add can follow.
  const crewlessLandings = landings.filter(l => !l.locked && (l.landing_crew || []).length === 0)
  const unlockedWithCrew = landings.filter(l => !l.locked && (l.landing_crew || []).length > 0)

  async function repairCrewless() {
    const fallback = activeCrew.filter(c => c.status === 'on_boat' && c.crew_type !== 'self_employed').map(c => c.id)
    if (!confirm(`Add crew (from contract dates) to ${crewlessLandings.length} landing${crewlessLandings.length === 1 ? '' : 's'} with no crew aboard?`)) return
    setBusy(true)
    let skipped = 0
    for (const l of crewlessLandings) {
      const aboard = aboardOn(l.landing_date)
      const ids = aboard.length ? aboard : fallback
      if (!ids.length) { skipped++; continue }
      const { error: e } = await supabase.from('landing_crew')
        .upsert(ids.map(crew_id => ({ landing_id: l.id, crew_id })),
                { onConflict: 'landing_id,crew_id', ignoreDuplicates: true })
      if (e) { setError(`${fmtDate(l.landing_date)}: ${e.message}`); setBusy(false); return }
    }
    setBusy(false)
    if (skipped) setError(`${skipped} landing(s) skipped — no contract covered the date and no contracted crew marked on boat.`)
    loadAll()
  }

  async function removeAllCrew() {
    if (!confirm(`Remove ALL crew from ${unlockedWithCrew.length} unlocked landing${unlockedWithCrew.length === 1 ? '' : 's'}? Locked (closed) months are left alone. You can re-add from contract dates afterwards.`)) return
    setBusy(true)
    for (const l of unlockedWithCrew) {
      const { error: e } = await supabase.from('landing_crew').delete().eq('landing_id', l.id)
      if (e) { setError(`${fmtDate(l.landing_date)}: ${e.message}`); setBusy(false); return }
    }
    setBusy(false)
    loadAll()
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}>
        <BackNav />
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

      {canEdit && (crewlessLandings.length > 0 || unlockedWithCrew.length > 0) && (
        <details className="card" style={crewlessLandings.length ? { borderColor: '#c2410c' } : {}}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Crew tools{crewlessLandings.length > 0 && <span style={{ color: '#c2410c' }}> — {crewlessLandings.length} landing{crewlessLandings.length === 1 ? ' has' : 's have'} no crew aboard</span>}
          </summary>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.6rem 0' }}>
            Crew are matched from contract dates. Boxes don't count towards anyone's bonus until crew are aboard. Locked months are never touched.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {crewlessLandings.length > 0 && (
              <button onClick={repairCrewless} disabled={busy}>
                {busy ? 'Working…' : `Add crew from contract dates (${crewlessLandings.length})`}
              </button>
            )}
            {unlockedWithCrew.length > 0 && (
              <button className="secondary" onClick={removeAllCrew} disabled={busy} style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
                Remove all crew from unlocked landings ({unlockedWithCrew.length})
              </button>
            )}
          </div>
        </details>
      )}

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
              <input type="number" min="0.01" step="0.01" value={fBoxes} onChange={(e) => setFBoxes(e.target.value)} placeholder="e.g. 825.25" required />
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
