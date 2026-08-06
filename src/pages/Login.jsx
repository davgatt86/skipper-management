import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import '../login.css'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
          <h1 className="login-h1">Every landing<em>accounted for</em></h1>
          <p className="login-lede">
            Sales notes, quota position and crew shares for your vessels —
            from the wheelhouse or the pier.
          </p>

          <form className="login-form" onSubmit={handleSubmit}>
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

            {error && <p className="login-error" role="alert">{error}</p>}

            <button type="submit" className="login-btn" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
              <span aria-hidden="true">→</span>
            </button>

            <p className="login-fine">
              <span className="login-dot" aria-hidden="true" />
              Your fleet's records are visible only to your own crew and office.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
