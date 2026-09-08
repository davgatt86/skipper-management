import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import '../login.css'

/* Where the emailed reset link lands.
 *
 * NEITHER `PublicOnly` NOR `ProtectedRoute` MAY WRAP THIS ROUTE, and that is
 * the trap in the whole flow. Following a recovery link puts a REAL SESSION in
 * the browser — auth-js reads the token out of the URL and signs the user in —
 * so `PublicOnly` would bounce him straight to the dashboard with his password
 * still unchanged, and he would be back here tomorrow having forgotten it
 * again. `ProtectedRoute` is no better: it would work by luck, and stop
 * working the moment a link arrives after the session has already gone.
 *
 * So this is a plain route that copes with both states and says which it is
 * in. See the routing note in App.jsx.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(null)   // null = still looking
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let live = true
    /* The session arrives asynchronously: auth-js has to parse the URL and
       exchange the token. Asking once on mount can be too early, so listen as
       well and take whichever answers first. */
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (live && session) setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (live) setReady((r) => (r === true ? r : !!data.session))
    })
    return () => { live = false; subscription.unsubscribe() }
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (pw1.length < 8) { setError('Use at least 8 characters.'); return }
    /* TYPED TWICE, AND THAT IS NOT CEREMONY. Nothing shows what was typed, and
       getting it wrong here locks the man out of the app he has just recovered
       — with the link already spent. */
    if (pw1 !== pw2) { setError('The two passwords are not the same.'); return }

    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw1 })
    setBusy(false)
    if (err) { setError(err.message); return }
    setDone(true)
  }

  return (
    <div className="login">
      <div className="login-bg" />
      <div className="login-veil-a" />
      <div className="login-veil-b" />

      <div className="login-in">
        <div className="login-col">
          <div className="login-brandline">
            <span className="login-mark" aria-hidden="true" />
            <span className="login-brandtxt">Skipper Management</span>
          </div>

          {done ? (
            <>
              <h1 className="login-h1">Password<em>changed</em></h1>
              <p className="login-lede">
                You are signed in on this device. Anywhere else you were signed in stays signed in
                until it next asks — sign out there if you would rather it did not.
              </p>
              <button className="login-btn" onClick={() => navigate('/')}>
                Carry on <span aria-hidden="true">→</span>
              </button>
            </>
          ) : ready === false ? (
            /* A LINK IS GOOD FOR AN HOUR AND FOR ONE USE. Say which, rather
               than showing a form that will fail on submit. */
            <>
              <h1 className="login-h1">That link<em>has expired</em></h1>
              <p className="login-lede">
                A reset link is good for an hour and can only be used once. Ask for another from
                the sign-in page — nothing has changed on your account.
              </p>
              <button className="login-btn" onClick={() => navigate('/login')}>
                Back to sign in <span aria-hidden="true">→</span>
              </button>
            </>
          ) : ready === null ? (
            <p className="login-lede">Checking the link…</p>
          ) : (
            <>
              <p className="login-eyebrow">Reset</p>
              <h1 className="login-h1">Set a new<em>password</em></h1>

              <form className="login-form" onSubmit={submit}>
                <label className="fl" htmlFor="pw1">New password</label>
                <input
                  id="pw1" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
                  placeholder="At least 8 characters" required autoComplete="new-password" autoFocus
                />
                <label className="fl" htmlFor="pw2">Again</label>
                <input
                  id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                  placeholder="The same again" required autoComplete="new-password"
                />

                {error && <p className="login-error" role="alert">{error}</p>}

                <button type="submit" className="login-btn" disabled={busy}>
                  {busy ? 'Saving…' : 'Save the new password'}
                  <span aria-hidden="true">→</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
