import { useState } from 'react'
import { api } from '../../lib/api.js'
import { verifyPassword } from '../../lib/auth.js'
import { GradeFields } from '../../components/GradeFields.jsx'
import { SectionFields, cleanSections, knownSections } from '../../components/SectionFields.jsx'
import { cleanGrades } from '../../lib/grades.js'
import { generatePassword, passwordError } from '../../lib/password.js'
import { useApp } from '../../lib/useApp.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY = () => ({ full_name: '', email: '', role: 'teacher', grades: [], sections: [], temp_password: generatePassword(), max_session_hours: 8 })

export default function AddStaff() {
  const { refreshStaff, mode, students, user, staff } = useApp()
  const [unlocked, setUnlocked] = useState(false)
  const [gatePassword, setGatePassword] = useState('')
  const [gateError, setGateError] = useState('')
  const [gateBusy, setGateBusy] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)

  const update = (field) => (event) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }))
    setSaved(null)
    setError('')
  }

  const setList = (field) => (values) => {
    setForm((previous) => ({ ...previous, [field]: values }))
    setSaved(null)
    setError('')
  }

  // Grades and sections already in the roster, so a name typed once becomes a
  // pick from then on.
  const gradesInUse = [...new Set(students.map((student) => student.grade_level).filter(Boolean))].sort()
  const sectionsInUse = knownSections(students, form.grades[0])

  async function unlock(event) {
    event.preventDefault()
    setGateError('')
    const trimmed = gatePassword.trim()
    if (!trimmed) {
      setGateError('Enter your password to open this page.')
      return
    }
    setGateBusy(true)
    try {
      await verifyPassword(user?.email || staff?.email, trimmed)
      setGatePassword('')
      setUnlocked(true)
    } catch (unlockError) {
      setGateError(unlockError.message)
    } finally {
      setGateBusy(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    const email = form.email.trim().toLowerCase()
    const isTeacher = form.role === 'teacher'
    const grades = isTeacher ? cleanGrades(form.grades) : []
    const sections = isTeacher ? cleanSections(form.sections) : []

    if (!form.full_name.trim()) return setError('Enter the staff member’s name.')
    if (!EMAIL_PATTERN.test(email)) return setError('Enter a valid email address.')
    if (isTeacher && grades.length === 0) return setError('Choose at least one grade for a professor.')
    const password = form.temp_password.trim()
    if (password) {
      const problem = passwordError(password)
      if (problem) return setError(`${problem} Or leave it blank to auto-generate.`)
    }

    setBusy(true)
    try {
      const row = await api.addStaff({
        full_name: form.full_name.trim(),
        email,
        role: form.role,
        grades,
        grade_level: grades[0] ?? null,
        sections,
        temp_password: password || null,
        max_session_hours: form.max_session_hours,
      })
      setSaved(row)
      setForm(EMPTY())
      await refreshStaff()
    } catch (addError) {
      setError(addError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>Add staff</h1>
        <p className="page-sub">
          {mode === 'demo'
            ? 'Demo mode activates accounts instantly because no Python service is running.'
            : 'This queues the account. The Python service creates the actual Supabase login with its service key, so keep it running while you onboard staff.'}
        </p>
      </header>

      {!unlocked ? (
        <form className="card password-confirm" onSubmit={unlock} noValidate>
          <div className="password-confirm-head">
            <span className="password-confirm-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Restricted area</h3>
              <p className="hint" style={{ marginTop: '2px' }}>
                Enter your own password to open staff onboarding.
              </p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="addstaff_gate_password">Your password</label>
            <input
              id="addstaff_gate_password"
              type="password"
              placeholder="Enter password"
              value={gatePassword}
              onChange={(event) => {
                setGatePassword(event.target.value)
                setGateError('')
              }}
              autoFocus
              autoComplete="current-password"
            />
            <span className="hint">Only admins who know their own password may add staff.</span>
          </div>

          {gateError && <p className="alert alert-error">{gateError}</p>}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={gateBusy || !gatePassword.trim()}>
              {gateBusy ? 'Checking…' : 'Unlock'}
            </button>
          </div>
        </form>
      ) : (
      <div className="split">
        <form className="card form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="full_name">Full name</label>
            <input id="full_name" value={form.full_name} onChange={update('full_name')} autoComplete="off" />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={form.email} onChange={update('email')} autoComplete="off" />
          </div>

          <div className="field">
            <label htmlFor="role">Role</label>
            <select id="role" value={form.role} onChange={update('role')}>
              <option value="teacher">Professor — their grades only, read and enroll</option>
              <option value="admin">Admin — whole school, can manage staff</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="grades">Grades</label>
            <GradeFields
              grades={form.grades}
              options={gradesInUse}
              onChange={setList('grades')}
              disabled={form.role === 'admin'}
              nameFor={(number) => `Grade ${number} for ${form.full_name || 'this professor'}`}
            />
            <span className="hint">
              {form.role === 'admin'
                ? 'Admins reach every grade.'
                : 'Use + to teach another grade.'}
            </span>
          </div>

          <div className="field">
            <label htmlFor="sections">Sections</label>
            <SectionFields
              sections={form.sections}
              onChange={setList('sections')}
              disabled={form.role === 'admin'}
              listId="staff-section-options"
              nameFor={(number) => `Section ${number} for ${form.full_name || 'this professor'}`}
            />
            <datalist id="staff-section-options">
              {sectionsInUse.map((section) => (
                <option key={section} value={section} />
              ))}
            </datalist>
            <span className="hint">
              {form.role === 'admin'
                ? 'Admins reach every section.'
                : 'Leave empty for every section, or list the ones they teach. Use + for another.'}
            </span>
          </div>

          <div className="field">
            <label htmlFor="max_session_hours">Allotted hours</label>
            <input
              id="max_session_hours"
              type="number"
              min="0.5"
              max="24"
              step="0.5"
              value={form.max_session_hours}
              onChange={update('max_session_hours')}
            />
            <span className="hint">Maximum hours this person can stay clocked in before auto-logout.</span>
          </div>

          <div className="field field-wide">
            <label htmlFor="temp_password">Password</label>
            <div className="password-row">
              <input
                id="temp_password"
                value={form.temp_password}
                onChange={update('temp_password')}
                autoComplete="new-password"
                spellCheck="false"
              />
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setForm((previous) => ({ ...previous, temp_password: generatePassword() }))}
              >
                Generate
              </button>
            </div>
            <span className="hint">
              Shown as plain text because you hand it over once. Use 8–14 characters with
              letters, numbers, and a special character — or leave blank and the Python
              service invents one instead.
            </span>
          </div>

          {error && <p className="alert alert-error">{error}</p>}
          {saved && (
            <p className="alert alert-ok">
              {saved.full_name} queued as{' '}
              <a href="#/teachers">{saved.role} management</a>.
            </p>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Queueing…' : 'Add staff member'}
            </button>
          </div>
        </form>

        <aside className="card">
          <h2>What happens next</h2>
          <ol className="steps">
            <li>The account appears on the Professor Management page as <strong>pending</strong>.</li>
            <li>
              The Python service picks it up within a few seconds and creates the Supabase login.
            </li>
            <li>
              Its status turns to <strong>active</strong> and the password is ready to hand over.
            </li>
            <li>The new staff member signs in and can change it from Studio if needed.</li>
          </ol>
        </aside>
      </div>
      )}
    </section>
  )
}
