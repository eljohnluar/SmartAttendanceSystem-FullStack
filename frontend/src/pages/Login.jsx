import { useState } from 'react'
import { signIn } from '../lib/auth.js'
import { useApp } from '../lib/useApp.js'

export default function Login({ onSignedIn }) {
  const { registrationOpen } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      setPassword('')
      window.location.hash = '#/home'
      onSignedIn?.()
    } catch (signInError) {
      setError(signInError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Staff sign in</h1>
        <p className="page-sub">
          Staff sign in to see the kiosk, attendance and enrollment. An admin adds teachers from the
          Staff page, or sign up to create the first admin.
        </p>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error && <p className="alert alert-error">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="login-alt">
          <span className="hint">
            {registrationOpen ? 'Sign up to create an account.' : 'Sign-up is closed right now.'}
          </span>
          <a className="btn btn-quiet" href="#/register">
            Sign up
          </a>
        </div>
      </form>
    </section>
  )
}
