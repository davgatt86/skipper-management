import { useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { fnUrl } from '../lib/apiBase'
import { useAuth } from '../AuthContext'

const labelStyle = { display: 'block', marginBottom: '1.1rem' }
const capStyle = { marginBottom: '0.3rem', fontWeight: 600 }
const hintStyle = { fontSize: '0.8rem', color: 'var(--grey-400)', marginTop: '0.25rem' }

export default function AddBoat() {
  const { appUser } = useAuth()
  const isOwner = appUser?.is_owner === true

  const [vessel, setVessel] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [tempPassword, setTempPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  if (!isOwner) {
    return (
      <AppShell>
        <div className="card"><p className="muted">Only the site owner can add a boat.</p></div>
      </AppShell>
    )
  }

  async function submit(e) {
    e.preventDefault()
    setError(''); setResult(null)
    if (!vessel.trim() || !email.trim() || !displayName.trim()) {
      return setError('Vessel, skipper email and display name are all required.')
    }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setBusy(false); return setError('Your session expired — sign in again.') }
      const res = await fetch(fnUrl('create-fleet'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vessel: vessel.trim(), email: email.trim(), displayName: displayName.trim(),
          tempPassword: tempPassword.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not create the boat.'); }
      else { setResult(data); setVessel(''); setEmail(''); setDisplayName(''); setTempPassword('') }
    } catch (err) {
      setError(err.message || 'Network error.')
    }
    setBusy(false)
  }

  return (
    <AppShell>

      <div className="card" style={{ maxWidth: 520 }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Add a boat</h1>
        <p className="muted" style={{ marginBottom: '1.25rem' }}>
          Creates a new fleet with its own skipper login and its own private data — they won't see your
          boat or anyone else's. Rates start as a copy of yours; they can change them under Crew → Bonus Settings.
        </p>

        {result ? (
          <div>
            <p style={{ color: 'var(--success, #197b30)', fontWeight: 600 }}>{result.vessel} created.</p>
            <p style={{ marginTop: '0.75rem' }}>Hand these to the skipper:</p>
            <div className="card" style={{ background: 'var(--grey-50)', marginTop: '0.5rem' }}>
              <div><strong>Email:</strong> {result.email}</div>
              <div><strong>Temporary password:</strong> <code>{result.tempPassword}</code></div>
            </div>
            <p style={hintStyle}>They sign in, then change it under Dashboard → Change password. This password won't be shown again.</p>
            <button className="secondary" style={{ marginTop: '1rem' }} onClick={() => setResult(null)}>Add another boat</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={labelStyle}>
              <div style={capStyle}>Vessel name</div>
              <input type="text" value={vessel} placeholder="e.g. BOY ANDREW WK170"
                     onChange={e => setVessel(e.target.value)} />
              <div style={hintStyle}>This is the fleet name shown in the app.</div>
            </label>

            <label style={labelStyle}>
              <div style={capStyle}>Skipper email</div>
              <input type="email" value={email} placeholder="skipper@example.com"
                     onChange={e => setEmail(e.target.value)} />
              <div style={hintStyle}>The email they'll sign in with.</div>
            </label>

            <label style={labelStyle}>
              <div style={capStyle}>Skipper display name</div>
              <input type="text" value={displayName} placeholder="Skipper name"
                     onChange={e => setDisplayName(e.target.value)} />
            </label>

            <label style={labelStyle}>
              <div style={capStyle}>Temporary password (optional)</div>
              <input type="text" value={tempPassword} placeholder="leave blank to auto-generate"
                     onChange={e => setTempPassword(e.target.value)} />
              <div style={hintStyle}>Leave blank and one is generated for you to pass on.</div>
            </label>

            {error && <p style={{ color: 'var(--danger, #b00020)', marginBottom: '0.75rem' }}>{error}</p>}

            <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create boat'}</button>
          </form>
        )}
      </div>
    </AppShell>
  )
}
