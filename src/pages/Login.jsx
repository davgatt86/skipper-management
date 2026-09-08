import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { fnUrl } from '../lib/apiBase'
import '../login.css'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /* Forgetting a password used to be the end of the road: there was no way
     back into the app from this screen, and no reset action anywhere behind it
     either — Change password lives inside the app, so you had to be able to
     sign in to fix not being able to sign in. */
  const [mode, setMode] = useState('in')   // 'in' | 'forgot'
  const [sent, setSent] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) {
      setError(error.message)
    } else {
      navigate('/')
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError(''); setSent('')
    setBusy(true)
    try {
      const res = await fetch(fnUrl('password-reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = await res.json().catch(() => ({}))
      /* THE ANSWER IS THE SAME WHETHER OR NOT THE ADDRESS IS ON AN ACCOUNT,
         and it is written that way on the server. Every vessel here is a
         separate business, so a screen that said "no such account" would be a
         way of asking whether a particular fisherman has one. */
      if (!res.ok) setError(body.error || 'Could not send that just now. Try again shortly.')
      else setSent(body.message || 'If that address is on an account, a reset link is on its way.')
    } catch {
      /* Offline is its own answer: a reset needs the network by definition, so
         say so rather than leaving him wondering whether it went. */
      setError(navigator.onLine
        ? 'Could not reach the office. Try again shortly.'
        : 'No signal. A reset link has to come by email, so this one needs a connection.')
    }
    setBusy(false)
  }

  const forgot = mode === 'forgot'

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

          <p className="login-eyebrow">Sales · Quota · Crew · Stores</p>
          {forgot ? (
            <>
              <h1 className="login-h1">Forgotten<em>your password</em></h1>
              <p className="login-lede">
                Put in the address you sign in with and we will send you a link to set a new one.
              </p>
            </>
          ) : (
            <>
              <h1 className="login-h1">Every landing<em>accounted for</em></h1>
              <p className="login-lede">
                Sales notes, quota position and crew shares for your vessels —
                from the wheelhouse or the pier.
              </p>
            </>
          )}

          <form className="login-form" onSubmit={forgot ? handleForgot : handleSubmit}>
            <label className="fl" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="skipper@vessel.co.uk"
              required
              autoComplete="email"
              autoFocus
            />

            {!forgot && (
              <>
                <label className="fl" htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </>
            )}

            {error && <p className="login-error" role="alert">{error}</p>}
            {sent && <p className="login-fine" role="status">
              <span className="login-dot" aria-hidden="true" />
              {sent}
            </p>}

            <button type="submit" className="login-btn" disabled={busy}>
              {busy
                ? (forgot ? 'Sending…' : 'Signing in…')
                : (forgot ? 'Send me a reset link' : 'Sign in')}
              <span aria-hidden="true">→</span>
            </button>

            <p className="login-fine">
              <span className="login-dot" aria-hidden="true" />
              {forgot ? (
                <span>
                  Remembered it?{' '}
                  <button type="button" className="login-textbtn"
                          onClick={() => { setMode('in'); setError(''); setSent('') }}>
                    Back to sign in
                  </button>
                </span>
              ) : (
                <span>
                  Your fleet's records are visible only to your own crew and office.{' '}
                  <button type="button" className="login-textbtn"
                          onClick={() => { setMode('forgot'); setError(''); setSent('') }}>
                    Forgotten your password?
                  </button>
                </span>
              )}
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
