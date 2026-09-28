import { useState } from 'react'
import { api } from '../../lib/api.js'
import { useApp } from '../../lib/useApp.js'

const GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Same alphabet the Python service uses: no 0/O or 1/l/I, so a password
// survives being read to someone over the phone.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

const EMPTY = () => ({ full_name: '', email: '', role: 'teacher', grade_level: '', temp_password: generatePassword() })

export default function AddStaff() {
  const { refreshStaff, mode } = useApp()
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)

  const update = (field) => (event) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }))
    setSaved(null)
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    const email = form.email.trim().toLowerCase()

    if (!form.full_name.trim()) return setError('Enter the staff member’s name.')
    if (!EMAIL_PATTERN.test(email)) return setError('Enter a valid email address.')
    if (form.role === 'teacher' && !form.grade_level) return setError('Teachers are scoped to one grade.')
    const password = form.temp_password.trim()
    if (password && password.length < 8) {
      return setError('Use at least 8 characters, or leave it blank to auto-generate.')
    }

    setBusy(true)
    try {
      const row = await api.addStaff({
        full_name: form.full_name.trim(),
        email,
        role: form.role,
        grade_level: form.role === 'teacher' ? form.grade_level : null,
        temp_password: password || null,
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
              <option value="teacher">Teacher — one grade, read and enroll</option>
              <option value="admin">Admin — whole school, can manage staff</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="grade_level">Grade</label>
            <select
              id="grade_level"
              value={form.grade_level}
              onChange={update('grade_level')}
              disabled={form.role === 'admin'}
            >
              <option value="">{form.role === 'admin' ? 'Not needed for admins' : 'Choose a grade'}</option>
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
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
              Shown as plain text because you hand it over once. Leave blank and the Python service
              invents one instead.
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
            <li>The account appears on the Teacher Management page as <strong>pending</strong>.</li>
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
    </section>
  )
}
