import { Fragment, useEffect, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { CrewCerts, CertAlerts } from './CrewCerts'
import { CrewDetails } from './CrewDetails'

const STATUSES = ['on_boat', 'on_leave', 'former']
const STATUS_LABEL = { on_boat: 'On Boat', on_leave: 'On Leave', former: 'Former' }
const STATUS_COLOR = { on_boat: 'var(--green)', on_leave: 'var(--amber)', former: 'var(--grey-400)' }
const TYPE_LABEL = { contracted: 'Contracted (agency)', self_employed: 'Self-employed (UK)' }

export default function Crew() {
  const { appUser } = useAuth()
  const [crew, setCrew] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newStatus, setNewStatus] = useState('on_leave')
  const [newType, setNewType] = useState('contracted')
  const [busy, setBusy] = useState(false)
  const [openCerts, setOpenCerts] = useState(null)   // crew id whose cert panel is expanded
  const [openDetails, setOpenDetails] = useState(null) // crew id whose details panel is expanded

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
      crew_type: newType,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
    } else {
      setNewName('')
      setNewStatus('on_leave')
      setNewType('contracted')
      setAdding(false)
      loadCrew()
    }
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('crew').update({ status }).eq('id', id)
    if (error) setError(error.message)
    else loadCrew()
  }

  async function updateType(id, crew_type) {
    const { error } = await supabase.from('crew').update({ crew_type }).eq('id', id)
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
    <AppShell>
      <PageHeader title="Crew">
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)}>+ Add crewman</button>
        )}
      </PageHeader>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {canEdit && <CertAlerts />}

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
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Type</div>
              <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                <option value="contracted">{TYPE_LABEL.contracted}</option>
                <option value="self_employed">{TYPE_LABEL.self_employed}</option>
              </select>
              <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                Self-employed rotation crew get no contracts or box bonus — they're listed for the rota.
              </div>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setNewName(''); setError('') }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading && <div className="card"><p className="muted">Loading…</p></div>}
      {!loading && crew.length === 0 && (
        <div className="card"><p className="muted">No crew yet. {canEdit && 'Click "Add crewman" above to add your first.'}</p></div>
      )}
      {!loading && [
        ['contracted', 'Contracted crew (agency)', crew.filter(c => (c.crew_type || 'contracted') !== 'self_employed')],
        ['self_employed', 'Self-employed crew (UK rotation)', crew.filter(c => c.crew_type === 'self_employed')],
      ].map(([key, title, group]) => group.length === 0 ? null : (
      <div className="card" key={key}>
        <h2 style={{ marginTop: 0 }}>{title} <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>({group.length})</span></h2>
        {(
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '0.6rem 0.4rem' }}>Name</th>
                <th style={{ padding: '0.6rem 0.4rem' }}>Status</th>
                <th style={{ padding: '0.6rem 0.4rem' }}>Type</th>
                {canEdit && <th style={{ padding: '0.6rem 0.4rem', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {group.map(c => (
                <Fragment key={c.id}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
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
                  <td style={{ padding: '0.6rem 0.4rem' }}>
                    {canEdit ? (
                      <select
                        value={c.crew_type || 'contracted'}
                        onChange={(e) => updateType(c.id, e.target.value)}
                        style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
                      >
                        <option value="contracted">Contracted</option>
                        <option value="self_employed">Self-employed</option>
                      </select>
                    ) : (
                      <span className="muted">{(c.crew_type || 'contracted') === 'self_employed' ? 'Self-employed' : 'Contracted'}</span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ padding: '0.6rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="secondary"
                        onClick={() => setOpenDetails(openDetails === c.id ? null : c.id)}
                        style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem', marginRight: '0.3rem' }}
                      >
                        {openDetails === c.id ? 'Hide details' : 'Details'}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setOpenCerts(openCerts === c.id ? null : c.id)}
                        style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem', marginRight: '0.3rem' }}
                      >
                        {openCerts === c.id ? 'Hide certs' : 'Certificates'}
                      </button>
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
                {openDetails === c.id && (
                  <tr>
                    <td colSpan={canEdit ? 4 : 3} style={{ padding: '0 0.4rem 0.8rem', background: 'var(--bg-soft, #f8fafc)' }}>
                      <CrewDetails crew={c} canEdit={canEdit} onSaved={loadCrew} />
                    </td>
                  </tr>
                )}
                {openCerts === c.id && (
                  <tr>
                    <td colSpan={canEdit ? 4 : 3} style={{ padding: '0 0.4rem 0.8rem', background: 'var(--bg-soft, #f8fafc)' }}>
                      <CrewCerts crew={c} canEdit={canEdit} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      ))}
    </AppShell>
  )
}
