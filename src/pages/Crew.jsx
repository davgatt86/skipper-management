import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BackNav from '../BackNav'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const STATUSES = ['on_boat', 'on_leave', 'former']
const STATUS_LABEL = { on_boat: 'On Boat', on_leave: 'On Leave', former: 'Former' }
const STATUS_COLOR = { on_boat: 'var(--green)', on_leave: 'var(--amber)', former: 'var(--grey-400)' }

export default function Crew() {
  const { appUser } = useAuth()
  const [crew, setCrew] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newStatus, setNewStatus] = useState('on_leave')
  const [busy, setBusy] = useState(false)

  const canEdit = appUser?.role === 'skipper'

  async function loadCrew() {
    setLoading(true)
    const { data, error } = await supabase
      .from('crew')
      .select('*')
      .is('archived_at', null)
      .order('full_name')
    if (error) setError(error.message)
    else setCrew(data || [])
    setLoading(false)
  }

  useEffect(() => { loadCrew() }, [])

  async function addCrew(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('crew').insert({
      fleet_id: appUser.fleet_id,
      full_name: newName.trim(),
      status: newStatus,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
    } else {
      setNewName('')
      setNewStatus('on_leave')
      setAdding(false)
      loadCrew()
    }
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('crew').update({ status }).eq('id', id)
    if (error) setError(error.message)
    else loadCrew()
  }

  async function archiveCrew(id, name) {
    if (!confirm(`Archive ${name}? They'll be hidden from the list but their history is kept.`)) return
    const { error } = await supabase.from('crew').update({
      archived_at: new Date().toISOString(),
      status: 'former',
    }).eq('id', id)
    if (error) setError(error.message)
    else loadCrew()
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}>
        <BackNav />
      </div>

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Crew</h1>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)}>+ Add crewman</button>
        )}
      </header>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {adding && (
        <div className="card">
          <h2>Add new crewman</h2>
          <form onSubmit={addCrew}>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Full name</div>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Lorenzo Rusiana"
                required
                autoFocus
              />
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Status</div>
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setNewName(''); setError('') }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading && <p className="muted">Loading…</p>}
        {!loading && crew.length === 0 && (
          <p className="muted">No crew yet. {canEdit && 'Click "Add crewman" above to add your first.'}</p>
        )}
        {!loading && crew.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '0.6rem 0.4rem' }}>Name</th>
                <th style={{ padding: '0.6rem 0.4rem' }}>Status</th>
                {canEdit && <th style={{ padding: '0.6rem 0.4rem', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {crew.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.6rem 0.4rem', fontWeight: 600 }}>{c.full_name}</td>
                  <td style={{ padding: '0.6rem 0.4rem' }}>
                    {canEdit ? (
                      <select
                        value={c.status}
                        onChange={(e) => updateStatus(c.id, e.target.value)}
                        style={{ width: 'auto', padding: '0.3rem 0.5rem', color: STATUS_COLOR[c.status], fontWeight: 600 }}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: STATUS_COLOR[c.status], fontWeight: 600 }}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ padding: '0.6rem 0.4rem', textAlign: 'right' }}>
                      <button
                        className="secondary"
                        onClick={() => archiveCrew(c.id, c.full_name)}
                        style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}
                      >
                        Archive
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
