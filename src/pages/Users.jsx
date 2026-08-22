import { useEffect, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { fnUrl } from '../lib/apiBase'
import { useAuth } from '../AuthContext'

const labelStyle = { display: 'block', marginBottom: '1rem' }
const capStyle = { marginBottom: '0.3rem', fontWeight: 600 }
const hintStyle = { fontSize: '0.8rem', color: 'var(--grey-400)', marginTop: '0.25rem' }
const ROLE_LABEL = { skipper: 'Skipper', office: 'Office', crew: 'Crew', viewer: 'Viewer', officer: 'Officer', engineer: 'Officer', cook: 'Cook' }

export default function Users() {
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  /* The database refuses anyone but the platform owner, so this is a button
   * and not a boundary. The message it returns is the row counts, which is
   * worth showing: a reset that says nothing looks like one that did nothing. */
  async function resetDemo() {
    setResetBusy(true); setResetMsg('')
    const { data, error: e } = await supabase.rpc('reset_demo_fleet')
    setResetBusy(false); setConfirmReset(false)
    setResetMsg(e ? 'Could not reset: ' + e.message : 'Demo fleet reset — ' + data)
  }
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

  // edit form
  const [editing, setEditing] = useState(null)     // user id being edited
  const [editRole, setEditRole] = useState('')
  const [editName, setEditName] = useState('')
  const [editCrewId, setEditCrewId] = useState('')

  async function api(payload) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Your session expired — sign in again.')
    const res = await fetch(fnUrl('manage-users'), {
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
    if (role === 'crew' && !crewId) return setError('Pick which crewman this login belongs to. A Crew login has to be tied to a crew record.')
    setBusy(true)
    try {
      const data = await api({
        action: 'create',
        email: email.trim(), displayName: displayName.trim(), role,
        crewId: role === 'crew' && crewId ? crewId : undefined,
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
  // You cannot change your own role — that is how you lock yourself out of this
  // page — nor the owner's. Everything else is fair game.
  const canEdit = (u) => u.id !== meId && !u.is_owner

  async function saveEdit(u) {
    setError(''); setResult(null); setBusy(true)
    try {
      await api({
        action: 'update', userId: u.id,
        role: editRole || undefined,
        displayName: editName.trim() || undefined,
        crewId: editRole === 'crew' && editCrewId ? editCrewId : undefined,
      })
      setEditing(null)
      await loadUsers()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

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
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {canEdit(u) && (
                    <button className="secondary" disabled={busy}
                            onClick={() => {
                              setEditing(editing === u.id ? null : u.id)
                              setEditRole(u.role); setEditName(u.display_name || ''); setEditCrewId(u.crew_id || '')
                            }}>
                      {editing === u.id ? 'Close' : 'Edit'}
                    </button>
                  )}
                  {canDelete(u)
                    ? <button className="secondary" disabled={busy} onClick={() => removeUser(u)}>Delete</button>
                    : <span className="muted" style={{ fontSize: '0.75rem', alignSelf: 'center' }}>protected</span>}
                </div>

                {editing === u.id && (
                  <div style={{ flexBasis: '100%', marginTop: '0.6rem', padding: '0.75rem', background: 'var(--grey-50)', borderRadius: 6 }}>
                    <label style={labelStyle}>
                      <div style={capStyle}>Display name</div>
                      <input type="text" value={editName} onChange={e => setEditName(e.target.value)} />
                    </label>
                    <label style={labelStyle}>
                      <div style={capStyle}>Role</div>
                      <select value={editRole} onChange={e => setEditRole(e.target.value)}>
                        <option value="crew">Crew (sees own data)</option>
                        <option value="officer">Officer — engineer or mate (logs, maintenance, crew papers. No money.)</option>
                        <option value="cook">Cook — the stores list only (no money, no crew, no logs)</option>
                        <option value="office">Office (payments and contracts, no sales)</option>
                        <option value="viewer">Viewer (read-only)</option>
                        {/* Only the site owner may hand out a skipper login. An
                            ordinary skipper minting more skippers is how one
                            compromised account becomes several. */}
                        {appUser?.is_owner && <option value="skipper">Skipper — full access</option>}
                      </select>
                      {!appUser?.is_owner && (
                        <div style={hintStyle}>Only the site owner can make someone a skipper.</div>
                      )}
                    </label>
                    {editRole === 'crew' && (
                      <label style={labelStyle}>
                        <div style={capStyle}>Which crewman is this?</div>
                        <select value={editCrewId} onChange={e => setEditCrewId(e.target.value)}>
                          <option value="">— choose —</option>
                          {crew.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                        </select>
                        <div style={hintStyle}>Required for a Crew login. Every other role is a login only.</div>
                      </label>
                    )}
                    <button disabled={busy} onClick={() => saveEdit(u)}>{busy ? 'Saving…' : 'Save changes'}</button>
                  </div>
                )}
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
                <option value="officer">Officer — engineer or mate (logs, maintenance, crew papers. No money.)</option>
                <option value="cook">Cook — the stores list only (no money, no crew, no logs)</option>
                <option value="office">Office (full except settings/crew)</option>
                <option value="viewer">Viewer (read-only)</option>
              </select>
            </label>
            {/* NOT optional, whatever the old label said. `check_crew_id_role`
                on app_users requires a crew_id for role 'crew' and forbids one
                for every other role, so leaving this blank used to fail with a
                raw constraint name in front of the skipper. */}
            {role === 'crew' && (
              <label style={labelStyle}>
                <div style={capStyle}>Which crewman is this?</div>
                {crew.length > 0 ? (
                  <select value={crewId} onChange={e => setCrewId(e.target.value)}>
                    <option value="">— choose —</option>
                    {crew.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                  </select>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    No crew on record yet. Add the man under Crew first, then come back.
                  </p>
                )}
                <div style={hintStyle}>
                  Required for a Crew login — it is what lets him see his own bonus and nobody else&rsquo;s.
                  Every other role is a login only and is never linked to a crew record.
                </div>
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

      {/* ---- THE DEMONSTRATION FLEET -------------------------------------
          Platform owner only, and the database says so too: the guard lives
          inside `reset_demo_fleet()`, so hiding this card hides a button and
          nothing else. A visitor calling the function from a console is
          refused by name.

          It runs nightly at 03:30 as well. This is for the other case — the
          last visitor made a mess and the next one is due in ten minutes. */}
      {appUser?.is_owner && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h2 style={{ marginTop: 0 }}>Demonstration fleet</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
            Puts <strong>NORTH WIND BCK500</strong> back exactly as she ships — 25 landings,
            10 crew, the certificates, the logs — and empties her audit book. Anything a
            visitor typed is discarded. It runs on its own every night at 03:30;
            this is for when you need her clean now.
          </p>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            No other fleet is touched: the fleet id is a constant inside the function and
            it takes no argument, so there is nothing to point at the wrong boat.
          </p>

          {/* Two clicks. It destroys a visitor's work, which is the point, but
              a single click beside "Add user" is too easy to hit by accident. */}
          {!confirmReset ? (
            <button onClick={() => setConfirmReset(true)} disabled={resetBusy}>
              Reset the demo fleet…
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.88rem' }}>Discard everything on the demo boat?</strong>
              <button onClick={resetDemo} disabled={resetBusy}
                      style={{ background: 'var(--rust)', color: '#fff', border: 'none' }}>
                {resetBusy ? 'Resetting…' : 'Yes, reset her'}
              </button>
              <button onClick={() => setConfirmReset(false)} disabled={resetBusy}>Cancel</button>
            </div>
          )}
          {resetMsg && (
            <p style={{ fontSize: '0.82rem', marginBottom: 0, color: 'var(--kelp)' }}>{resetMsg}</p>
          )}
        </div>
      )}
    </AppShell>
  )
}
