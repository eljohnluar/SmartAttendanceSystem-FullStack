import { useState } from 'react'
import { api } from '../lib/api.js'
import { signIn } from '../lib/auth.js'
import { useApp } from '../lib/useApp.js'

/** Supabase's emailed sign-in codes are six digits. */
const CODE_LENGTH = 6

export default function Login({ onSignedIn }) {
  const { registrationOpen, needsOtp, user, refreshStaff } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [askedForCode, setAskedForCode] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Landing here with a session that has not proved its code yet — a reload, or
  // a tab left open past the deadline — resumes at the code step.
  const atCode = needsOtp || askedForCode

  // What was typed a moment ago, or the signed-in account's own address when a
  // reload landed here without the form having been filled in.
  const targetEmail = (email.trim() || user?.email || '').toLowerCase()

  async function sendCode() {
    setError('')
    setNote('')
    setBusy(true)
    try {
      await api.requestLoginOtp(targetEmail)
      setSentTo(targetEmail || 'your address')
      setNote(
        `A ${CODE_LENGTH}-digit code is on its way to ${targetEmail}. It can only be used once.`,
      )
      setCode('')
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setBusy(false)
    }
  }

  /** Signed in and verified. The store claims a just-registered admin's staff
   *  row as it reads, so this only has to send them in. */
  async function finish() {
    await refreshStaff()
    window.location.hash = '#/home'
    onSignedIn?.()
  }

  async function submitPassword(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      setPassword('')
      // Leave a sign-in trail for the admin audit log; never blocks login.
      api.logAudit('sign_in', 'session', `Signed in ${email.trim()}`).catch(() => {})

      if (!(await api.loginVerified().catch(() => true))) {
        setAskedForCode(true)
        setBusy(false)
        await sendCode()
        return
      }
      await finish()
    } catch (signInError) {
      setError(signInError.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(event) {
    event.preventDefault()
    setError('')
    if (code.trim().length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH} digits from the email.`)
      return
    }

    setBusy(true)
    try {
      if (!(await api.verifyLoginOtp(targetEmail, code))) {
        setError('That code is not right, or it has expired. Ask for a new one.')
        return
      }
      await finish()
    } catch (verifyError) {
      setError(verifyError.message)
    } finally {
      setBusy(false)
    }
  }

  if (atCode) {
    return (
      <section className="login">
        <form className="card login-card" onSubmit={submitCode}>
          <h1>Check your email</h1>
          <p className="page-sub">
            {user?.email ? `Sign in for ${user.email} needs a code.` : 'Sign in needs a code.'}{' '}
            {note && <strong>{note}</strong>}
          </p>

          <div className="field">
            <label htmlFor="code">{CODE_LENGTH}-digit code</label>
            <input
              id="code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
                setError('')
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={'0'.repeat(CODE_LENGTH)}
              className="otp-input"
              autoFocus
            />
            <span className="hint">
              Codes come from the school&apos;s sign-in mailbox. Check the spam folder if none arrives,
              and ask for a new one after a minute or two.
            </span>
          </div>

          {error && <p className="alert alert-error">{error}</p>}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || code.length !== CODE_LENGTH}
          >
            {busy ? 'Checking…' : 'Confirm code'}
          </button>

          <button type="button" className="btn btn-quiet" onClick={sendCode} disabled={busy}>
            {sentTo ? `Send a new code to ${sentTo}` : 'Send me a code'}
          </button>

          <a className="login-kiosk" href="#/kiosk">
            Back to the Scan Station
          </a>
        </form>
      </section>
    )
  }

  return (
    <section className="login">
      <form className="card login-card" onSubmit={submitPassword}>
        <h1>Staff sign in</h1>
        <p className="page-sub">
          Staff sign in to see the kiosk, attendance and enrollment. An admin adds professors from the Staff
          page, or sign up to create the first admin.
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
          <span className="hint">Then we email a {CODE_LENGTH}-digit code to the same address.</span>
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

        <a className="login-kiosk" href="#/kiosk">
          Back to the Scan Station
        </a>
      </form>
    </section>
  )
}
