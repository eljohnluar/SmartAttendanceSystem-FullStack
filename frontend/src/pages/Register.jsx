import { useState } from 'react'
import { registerOrSignIn } from '../lib/auth.js'
import { passwordError, PASSWORD_HINT } from '../lib/password.js'
import { Notice } from '../components/ui.jsx'
import { useApp } from '../lib/useApp.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Register() {
  const { registrationOpen, mode } = useApp()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

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
          The app asked Supabase whether registration is open and got no answer, so registration stays closed
          rather than guessing. This normally means
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
          Self-service sign-up is switched off, so it no longer creates accounts. Ask an admin to add you from
          the <a href="#/teachers">Professor Management</a> page.
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
    const problem = passwordError(password)
    if (problem) return setError(problem)
    if (password !== confirm) return setError('The two passwords do not match.')

    setBusy(true)
    try {
      const { needsConfirmation } = await registerOrSignIn(address, password, fullName.trim())
      // The admin row is claimed after the first verified sign-in, because
      // nothing can be written to it before the code step is done.
      setConfirmed(!needsConfirmation)
      setDone(true)
    } catch (registerError) {
      setError(registerError.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <section className="login">
        <div className="card login-card">
          <h1>{confirmed ? 'Account created' : 'Check your email'}</h1>
          <p className="page-sub">
            {confirmed
              ? 'Your account is ready.'
              : `We sent a confirmation link to ${email.trim().toLowerCase()}. Open it on this computer, then come back.`}
          </p>
          <a className="btn btn-primary" href="#/login">
            Sign in
          </a>
        </div>
      </section>
    )
  }

  return (
    <section className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Create an admin account</h1>
        <p className="page-sub">
          Registration is open while the system is still being built, so you can create as many accounts as
          you need. Each one signs in with full admin rights.
        </p>

        <div className="field">
          <label htmlFor="full_name">Your name</label>
          <input
            id="full_name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
          />
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
          <span className="hint">{PASSWORD_HINT}</span>
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
          We email a link to confirm the address first, then a 6-digit code each time you sign in.
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
