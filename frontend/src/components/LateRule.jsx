import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { verifyPassword } from '../lib/auth.js'
import { studentFor } from '../lib/format.js'
import { useApp } from '../lib/useApp.js'

const SUGGESTED_START = '08:00'
const SUGGESTED_GRACE = 15

function cutoffOf(start, minutes) {
  const [hour, minute] = start.split(':').map(Number)
  const total = hour * 60 + minute + minutes
  if (!Number.isFinite(total)) return start
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Class attendance configuration (start time and late grace minutes).
 * When "Save configuration" is clicked, the configuration form disappears
 * and the password input appears to authorize the changes.
 */
export function LateRule({ students = [], logs = [] }) {
  const { user, staff, refresh } = useApp()
  const grades = useMemo(
    () => [...new Set(students.map((student) => student.grade_level).filter(Boolean))].sort(),
    [students],
  )
  const [picked, setPicked] = useState('')
  const grade = grades.includes(picked) ? picked : (grades[0] ?? '')

  const [start, setStart] = useState(SUGGESTED_START)
  const [grace, setGrace] = useState(String(SUGGESTED_GRACE))
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  // Password confirmation step state: 'form' | 'password'
  const [step, setStep] = useState('form')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    if (!grade) return undefined
    let stale = false
    api
      .getGradeSettings(grade)
      .then((row) => {
        if (stale) return
        setStart(row?.school_start ? row.school_start.slice(0, 5) : SUGGESTED_START)
        setGrace(String(row?.late_grace_minutes ?? SUGGESTED_GRACE))
        setSaved(row ?? null)
        setNote('')
        setError('')
        setStep('form')
      })
      .catch((loadError) => {
        if (!stale) setError(loadError.message)
      })
    return () => {
      stale = true
    }
  }, [grade])

  const todayCount = useMemo(
    () => logs.filter((log) => studentFor(log, students)?.grade_level === grade).length,
    [logs, students, grade],
  )

  function handleSaveClick(event) {
    event.preventDefault()
    const minutes = Number(grace)
    if (!/^\d{2}:\d{2}$/.test(start)) {
      setError('Pick a start time first.')
      return
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180) {
      setError('Grace must be a whole number of minutes between 0 and 180.')
      return
    }

    // Input is valid: transition from configuration form to password confirmation
    setError('')
    setNote('')
    setPassword('')
    setPasswordError('')
    setStep('password')
  }

  async function handlePasswordConfirm(event) {
    event.preventDefault()
    setPasswordError('')

    const trimmedPassword = password.trim()
    if (!trimmedPassword) {
      setPasswordError('Please enter your password to save configuration.')
      return
    }

    const minutes = Number(grace)
    setBusy(true)

    try {
      // Security check: verify password
      const userEmail = user?.email || staff?.email
      await verifyPassword(userEmail, trimmedPassword)

      // Save configuration to database
      await api.saveGradeSettings(grade, { school_start: start, late_grace_minutes: minutes })
      setSaved({ school_start: start, late_grace_minutes: minutes })
      setNote(`Configuration saved. ${grade} is late from ${cutoffOf(start, minutes)} onwards.`)
      setStep('form')
      setPassword('')
    } catch (saveError) {
      setPasswordError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    setConfirming(false)
    setError('')
    setNote('')
    try {
      const cleared = await api.resetAttendance(grade)
      setNote(
        cleared
          ? `Cleared ${cleared} scan${cleared === 1 ? '' : 's'} for ${grade}. They can scan again.`
          : `Nothing to clear for ${grade} today.`,
      )
      await refresh()
    } catch (resetError) {
      setError(resetError.message)
    } finally {
      setBusy(false)
    }
  }

  if (grades.length === 0) return null

  // ── Step 2: Password confirmation view ──────────────────────────────────
  if (step === 'password') {
    return (
      <section className="card rule-card">
        <h2>Confirm save configuration</h2>

        <form className="password-confirm" onSubmit={handlePasswordConfirm} noValidate>
          <div className="password-confirm-head">
            <span className="password-confirm-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Save Configuration for {grade}</h3>
              <p className="hint" style={{ marginTop: '2px' }}>
                School starts: <strong>{start}</strong> · Late grace: <strong>{grace} minutes</strong> (Late cutoff: {cutoffOf(start, Number(grace))})
              </p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="config_password">Enter your password to save configuration</label>
            <input
              id="config_password"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setPasswordError('')
              }}
              autoFocus
              autoComplete="current-password"
            />
            <span className="hint">Password authorization is required to update attendance configuration.</span>
          </div>

          {passwordError && <p className="alert alert-error">{passwordError}</p>}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !password.trim()}>
              {busy ? 'Saving configuration…' : 'Confirm & Save'}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => {
                setStep('form')
                setPassword('')
                setPasswordError('')
              }}
            >
              Back to edit
            </button>
          </div>
        </form>
      </section>
    )
  }

  // ── Step 1: Configuration form view ─────────────────────────────────────
  return (
    <section className="card rule-card">
      <h2>Late rule configuration</h2>

      <form className="rule-row" onSubmit={handleSaveClick}>
        {grades.length > 1 && (
          <div className="field">
            <label htmlFor="rule_grade">Grade</label>
            <select id="rule_grade" value={grade} onChange={(event) => setPicked(event.target.value)}>
              {grades.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="rule_start">School starts</label>
          <input
            id="rule_start"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="rule_grace">Grace (minutes)</label>
          <input
            id="rule_grace"
            type="number"
            min="0"
            max="180"
            step="1"
            value={grace}
            onChange={(event) => setGrace(event.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save configuration
        </button>
      </form>

      <p className="hint">
        {saved
          ? `Late after ${cutoffOf(saved.school_start, saved.late_grace_minutes)} for ${grade}.`
          : `No rule saved for ${grade} yet, so it falls back to ${SUGGESTED_START} plus ${SUGGESTED_GRACE} minutes. Saving sets the rule for this class.`}
      </p>

      {error && <p className="alert alert-error">{error}</p>}
      {note && !error && <p className="alert alert-ok">{note}</p>}

      <div className="rule-reset">
        {confirming ? (
          <>
            <p>
              Clear all {todayCount} scan{todayCount === 1 ? '' : 's'} recorded today for {grade}? The
              students will need to scan again.
            </p>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={reset} disabled={busy}>
              Yes, clear them
            </button>
          </>
        ) : (
          <>
            <p className="hint">
              {todayCount} scan{todayCount === 1 ? '' : 's'} recorded today for {grade}.
            </p>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setConfirming(true)}
              disabled={busy || todayCount === 0}
            >
              Reset today
            </button>
          </>
        )}
      </div>
    </section>
  )
}
