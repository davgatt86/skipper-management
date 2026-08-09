import { useEffect, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const labelStyle = { display: 'block', marginBottom: '1rem' }
const capStyle = { marginBottom: '0.3rem', fontWeight: 600 }
const hintStyle = { fontSize: '0.8rem', color: 'var(--grey-400)', marginTop: '0.25rem' }
const ROLE_LABEL = { skipper: 'Skipper', office: 'Office', crew: 'Crew', viewer: 'Viewer', engineer: 'Engineer' }

export default function Users() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'

  const [users, setUsers] = useState([])
  const [meId, setMeId] = useState(null)
  const [crew, setCrew] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  // add form
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('crew')
  const [crewId, setCrewId] = useState('')
  const [tempPassword, setTempPassword] = useState('')

  async function api(payload) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Your session expired — sign in again.')
    const res = await fetch('/.netlify/functions/manage-users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Request failed.')
    return data
  }

  async function loadUsers() {
    setError('')
    try {
      const data = await api({ action: 'list' })
      setUsers(data.users || [])
      setMeId(data.me || null)
    } catch (err) { setError(err.message) }
  }

  useEffect(() => {
    if (!isSkipper) { setLoading(false); return }
    (async () => {
      await loadUsers()
      const { data } = await supabase.from('crew').select('id, full_name').is('archived_at', null).order('full_name')
      setCrew(data || [])
      setLoading(false)
    })()
  }, [isSkipper])

  if (!isSkipper) {
    return (
      <AppShell>
        <div className="card"><p className="muted">Only the skipper can manage users.</p></div>
      </AppShell>
    )
  }

  async function addUser(e) {
    e.preventDefault()
    setError(''); setResult(null)
    if (!email.trim() || !displayName.trim()) return setError('Email and display name are required.')
    setBusy(true)
    try {
      const data = await api({
        action: 'create',
        email: email.trim(), displayName: displayName.trim(), role,
        crewId: ['crew', 'engineer'].includes(role) && crewId ? crewId : undefined,
        tempPassword: tempPassword.trim() || undefined,
      })
      setResult(data)
      setEmail(''); setDisplayName(''); setRole('crew'); setCrewId(''); setTempPassword('')
      await loadUsers()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function removeUser(u) {
    if (!window.confirm(`Delete ${u.display_name || u.email}? Their login is removed. Any crew/bonus record they're linked to stays.`)) return
    setError(''); setResult(null); setBusy(true)
    try { await api({ action: 'delete', userId: u.id }); await loadUsers() }
    catch (err) { setError(err.message) }
    setBusy(false)
  }

  const canDelete = (u) => u.id !== meId && !u.is_owner && u.role !== 'skipper'

  return (
    <AppShell>

      <div className="card" style={{ maxWidth: 640 }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Manage Users</h1>
        <p className="muted" style={{ marginBottom: '1.25rem' }}>
          Logins for this boat. Add office, crew or viewer accounts and remove ones no longer needed —
          no Supabase dashboard required.
        </p>

        <h2 style={{ fontSize: '1.05rem' }}>Current users</h2>
        {loading ? <p className="muted">Loading…</p> : error && !users.length ? <p className="error">Error: {error}</p> : (
          <ul style={{ listStyle: 'none', marginBottom: '1.5rem' }}>
            {users.map(u => (
              <li key={u.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{u.display_name || '—'}</strong>
                  {u.is_owner && <span className="muted" style={{ fontSize: '0.75rem' }}> · owner</span>}
                  {u.id === meId && <span className="muted" style={{ fontSize: '0.75rem' }}> · you</span>}
                  <div className="muted" style={{ fontSize: '0.85rem' }}>{u.email} · {ROLE_LABEL[u.role] || u.role}</div>
                </div>
                {canDelete(u)
                  ? <button className="secondary" disabled={busy} onClick={() => removeUser(u)}>Delete</button>
                  : <span className="muted" style={{ fontSize: '0.75rem' }}>protected</span>}
              </li>
            ))}
            {!users.length && <li className="muted">No users yet.</li>}
          </ul>
        )}

        <h2 style={{ fontSize: '1.05rem' }}>Add a user</h2>
        {result ? (
          <div className="card" style={{ background: 'var(--grey-50)' }}>
            <p style={{ color: 'var(--success, #197b30)', fontWeight: 600 }}>User added.</p>
            <div><strong>Email:</strong> {result.email}</div>
            <div><strong>Temporary password:</strong> <code>{result.tempPassword}</code></div>
            <p style={hintStyle}>Hand these over; they change the password under Change password. Won't be shown again.</p>
            <button className="secondary" style={{ marginTop: '0.75rem' }} onClick={() => setResult(null)}>Add another</button>
          </div>
        ) : (
          <form onSubmit={addUser}>
            <label style={labelStyle}>
              <div style={capStyle}>Email</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@bf83.crew or a real email" />
              <div style={hintStyle}>Crew with no email can use a name@…crew style address — it's only a login.</div>
            </label>
            <label style={labelStyle}>
              <div style={capStyle}>Display name</div>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </label>
            <label style={labelStyle}>
              <div style={capStyle}>Role</div>
              <select value={role} onChange={e => setRole(e.target.value)}>
                <option value="crew">Crew (sees own data)</option>
                <option value="engineer">Engineer (engine, fuel and garbage logs only)</option>
                <option value="office">Office (full except settings/crew)</option>
                <option value="viewer">Viewer (read-only)</option>
              </select>
            </label>
            {['crew', 'engineer'].includes(role) && crew.length > 0 && (
              <label style={labelStyle}>
                <div style={capStyle}>Link to crew record (optional)</div>
                <select value={crewId} onChange={e => setCrewId(e.target.value)}>
                  <option value="">— not linked —</option>
                  {crew.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
                <div style={hintStyle}>Links this login to a crewman so they see their own bonus.</div>
              </label>
            )}
            <label style={labelStyle}>
              <div style={capStyle}>Temporary password (optional)</div>
              <input type="text" value={tempPassword} onChange={e => setTempPassword(e.target.value)} placeholder="leave blank to auto-generate" />
            </label>

            {error && <p style={{ color: 'var(--danger, #b00020)', marginBottom: '0.75rem' }}>{error}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add user'}</button>
          </form>
        )}
      </div>
    </AppShell>
  )
}
