import { useState } from 'react'
import { supabase } from '../supabaseClient'
import BackNav from '../BackNav'

// Lets any signed-in user (skipper, viewer, crew) replace their
// temporary password with their own. Uses the live session, so no
// email round-trip is needed.
export default function Password() {
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function save(e) {
    e.preventDefault()
    setError('')
    if (pw1.length < 8) { setError('Use at least 8 characters.'); return }
    if (pw1 !== pw2) { setError("Passwords don't match."); return }
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw1 })
    setBusy(false)
    if (err) setError(err.message)
    else { setDone(true); setPw1(''); setPw2('') }
  }

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: '1rem' }}><BackNav /></div>
      <h1>Change password</h1>
      <div className="card">
        {done ? (
          <p>Password changed — use the new one from your next sign-in.</p>
        ) : (
          <form onSubmit={save}>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>New password</div>
              <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} autoComplete="new-password" required />
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Repeat new password</div>
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" required />
            </label>
            {error && <p className="error" style={{ marginBottom: '0.8rem' }}>{error}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
