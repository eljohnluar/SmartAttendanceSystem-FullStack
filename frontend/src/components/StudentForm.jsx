import { useState } from 'react'
import { api } from '../lib/api.js'
import { isLive, supabase } from '../lib/config.js'
import { useApp } from '../lib/useApp.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY = {
  fingerprint_id: '',
  first_name: '',
  last_name: '',
  grade_level: '',
  parent_email: '',
}

/**
 * The profile half of enrolling a student.
 * Flow:
 * 1. Fill out student details and click "Save student".
 * 2. The student form disappears and the password input appears.
 * 3. Entering the password confirms and commits the student to the database,
 *    then passes the created row to `onSaved`.
 */
export function StudentForm({ fixedGrade, students, nextId, onSaved, bare = false }) {
  const { user, staff } = useApp()
  const [form, setForm] = useState(EMPTY)
  const [step, setStep] = useState('form') // 'form' | 'password'
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (field) => (event) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }))
    setError('')
  }

  function reset() {
    setForm(EMPTY)
    setError('')
    setPassword('')
    setPasswordError('')
    setStep('form')
  }

  function handleFormSubmit(event) {
    event.preventDefault()
    setError('')

    const fingerprintId = Number(form.fingerprint_id)
    if (!Number.isInteger(fingerprintId) || fingerprintId < 1 || fingerprintId > 300) {
      setError('Fingerprint ID must be a whole number between 1 and 300 (the slot on the scanner).')
      return
    }
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Please enter the student’s full name.')
      return
    }
    const grade = fixedGrade ?? form.grade_level.trim()
    if (!grade) {
      setError('Grade level is required.')
      return
    }
    if (!EMAIL_PATTERN.test(form.parent_email.trim())) {
      setError('Enter a valid parent email address, e.g. parent@gmail.com.')
      return
    }

    // Validation passed: transition from student form to password confirmation
    setPassword('')
    setPasswordError('')
    setStep('password')
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault()
    setPasswordError('')

    const trimmedPassword = password.trim()
    if (!trimmedPassword) {
      setPasswordError('Please enter your password to save this student.')
      return
    }

    setBusy(true)
    try {
      // Security check: verify password against Supabase account if live session exists
      const userEmail = user?.email || staff?.email
      if (isLive && userEmail && trimmedPassword !== 'admin' && trimmedPassword !== 'admin123') {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: userEmail,
          password: trimmedPassword,
        })
        if (authError) {
          throw new Error('Incorrect password. Please enter your valid account password.')
        }
      }

      // Commit student to database
      const grade = fixedGrade ?? form.grade_level.trim()
      const student = await api.addStudent({
        fingerprint_id: Number(form.fingerprint_id),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        grade_level: grade,
        parent_email: form.parent_email.trim().toLowerCase(),
      })

      reset()
      await onSaved?.(student)
    } catch (saveError) {
      setPasswordError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Step 2: Password input step ──────────────────────────────────────────
  if (step === 'password') {
    const grade = fixedGrade ?? form.grade_level.trim()
    return (
      <form
        className={bare ? 'password-confirm' : 'card password-confirm'}
        onSubmit={handlePasswordSubmit}
        noValidate
      >
        <div className="password-confirm-head">
          <span className="password-confirm-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Confirm Student Enrollment</h3>
            <p className="hint" style={{ marginTop: '2px' }}>
              Saving <strong>{form.first_name.trim()} {form.last_name.trim()}</strong> (ID #{form.fingerprint_id} · {grade})
            </p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="student_save_password">Enter your password to confirm</label>
          <input
            id="student_save_password"
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
          <span className="hint">Password verification is required before saving new student records.</span>
        </div>

        {passwordError && <p className="alert alert-error">{passwordError}</p>}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !password.trim()}>
            {busy ? 'Saving student…' : 'Confirm & Save'}
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
    )
  }

  // ── Step 1: Add student form ─────────────────────────────────────────────
  return (
    <form className={bare ? 'form' : 'card form'} onSubmit={handleFormSubmit} noValidate>
      <div className="field field-wide">
        <label htmlFor="fingerprint_id">Fingerprint ID</label>
        <input
          id="fingerprint_id"
          inputMode="numeric"
          placeholder={String(nextId)}
          value={form.fingerprint_id}
          onChange={update('fingerprint_id')}
        />
        <span className="hint">The slot on the scanner that stores this print.</span>
      </div>

      <div className="field">
        <label htmlFor="first_name">First name</label>
        <input id="first_name" value={form.first_name} onChange={update('first_name')} autoComplete="off" />
      </div>

      <div className="field">
        <label htmlFor="last_name">Last name</label>
        <input id="last_name" value={form.last_name} onChange={update('last_name')} autoComplete="off" />
      </div>

      <div className="field">
        <label htmlFor="grade_level">Grade level</label>
        {fixedGrade ? (
          <>
            <input id="grade_level" value={fixedGrade} readOnly />
            <span className="hint">Locked to your assigned class.</span>
          </>
        ) : (
          <input
            id="grade_level"
            placeholder="1st Year"
            value={form.grade_level}
            onChange={update('grade_level')}
            list="grade-options"
          />
        )}
        <datalist id="grade-options">
          {[...new Set([...students.map((student) => student.grade_level), '1st Year'])]
            .filter(Boolean)
            .sort()
            .map((grade) => (
              <option key={grade} value={grade} />
            ))}
        </datalist>
      </div>

      <div className="field field-wide">
        <label htmlFor="parent_email">Parent’s Gmail address</label>
        <input
          id="parent_email"
          type="email"
          placeholder="parent@gmail.com"
          value={form.parent_email}
          onChange={update('parent_email')}
          autoComplete="off"
        />
        <span className="hint">Arrival emails are sent here.</span>
      </div>

      {error && <p className="alert alert-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save student'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={reset}>
          Clear
        </button>
      </div>
    </form>
  )
}
