import { useState } from 'react'
import { api } from '../lib/api.js'
import { registerOrSignIn } from '../lib/auth.js'
import { Notice } from '../components/ui.jsx'
import { useApp } from '../lib/useApp.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Register() {
  const { registrationOpen, mode, refreshStaff } = useApp()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (mode === 'demo') {
    return (
      <Notice title="Registration runs on Supabase">
        <p>
          Demo mode has no auth server, so an admin already exists here. Add the Supabase keys to
          <code>frontend/.env</code> to use this screen for real.
        </p>
      </Notice>
    )
  }

  if (registrationOpen === null) {
    return (
      <Notice title="Cannot check registration status">
        <p>
          The app asked Supabase whether registration is open and got no answer, so registration
          stays closed rather than guessing. This normally means
          <code>backend/schema.sql</code> has not been re-run since the <code>registration_open()</code>{' '}
          function was added.
        </p>
      </Notice>
    )
  }

  if (!registrationOpen) {
    return (
      <Notice title="Registration is closed">
        <p>
          Self-service sign-up is switched off, so it no longer creates accounts. Ask an admin to
          add you from the <a href="#/teachers">Teacher Management</a> page.
        </p>
        <p>
          <a href="#/home">Sign in instead</a>
        </p>
      </Notice>
    )
  }

  async function submit(event) {
    event.preventDefault()
    setError('')

    const address = email.trim().toLowerCase()
    if (!fullName.trim()) return setError('Enter your name.')
    if (!EMAIL_PATTERN.test(address)) return setError('Enter a valid email address.')
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError('The two passwords do not match.')

    setBusy(true)
    try {
      const user = await registerOrSignIn(address, password)
      if (!user) {
        setError('Confirm your email address, then sign in.')
        return
      }
      await api.claimAdminProfile(fullName.trim())
      await refreshStaff()
      window.location.hash = '#/home'
    } catch (registerError) {
      setError(registerError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Create an admin account</h1>
        <p className="page-sub">
          Registration is open while the system is still being built, so you can create as many
          accounts as you need. Each one signs in with full admin rights.
        </p>

        <div className="field">
          <label htmlFor="full_name">Your name</label>
          <input id="full_name" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div className="field">
          <label htmlFor="confirm">Repeat password</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </div>

        {error && <p className="alert alert-error">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Register admin'}
        </button>

        <p className="hint">
          Email confirmation is switched off for now, so this signs you straight in.
        </p>

        <div className="login-alt">
          <span className="hint">Already have an account?</span>
          <a className="btn btn-quiet" href="#/home">
            Sign in
          </a>
        </div>
      </form>
    </section>
  )
}
