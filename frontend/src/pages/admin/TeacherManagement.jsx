import { useState } from 'react'
import { api } from '../../lib/api.js'
import { FingerprintCapture } from '../../components/FingerprintCapture.jsx'
import { StudentForm } from '../../components/StudentForm.jsx'
import { fullName } from '../../lib/format.js'
import { useApp } from '../../lib/useApp.js'

const GRADES = ['1st Year', '2nd Year', '3rd Year', '4th Year']

function StaffRow({ row, onChanged, isAdmin }) {
  const [copied, setCopied] = useState(false)

  async function changeGrade(event) {
    await api.updateStaff(row.id, { grade_level: event.target.value || null })
    await onChanged()
  }

  async function changeHours(event) {
    const hours = Number(event.target.value)
    if (!hours || hours <= 0) return
    await api.setMaxSessionHours(row.id, hours)
    await onChanged()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(row.temp_password)
      setCopied(true)
    } catch {
      window.alert('Clipboard blocked — read the password off the screen instead.')
    }
  }

  async function hidePassword() {
    await api.updateStaff(row.id, { temp_password: null })
    await onChanged()
  }

  async function retry() {
    await api.updateStaff(row.id, { status: 'pending', error: null })
    await onChanged()
  }

  async function remove() {
    if (!window.confirm(`Remove ${row.full_name}? Their login stops working immediately.`)) return
    await api.removeStaff(row.id)
    await onChanged()
  }

  return (
    <tr>
      <td>
        <strong>{row.full_name}</strong>
        <em>{row.email}</em>
      </td>
      <td>{row.role}</td>
      <td>
        {row.role === 'teacher' ? (
          <select value={row.grade_level ?? ''} onChange={changeGrade} aria-label={`Grade for ${row.full_name}`}>
            <option value="">Unassigned</option>
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">All grades</span>
        )}
      </td>
      <td>
        <input
          type="number"
          min="0.5"
          max="24"
          step="0.5"
          value={row.max_session_hours ?? 8}
          onChange={changeHours}
          aria-label={`Allotted hours for ${row.full_name}`}
          style={{ width: '70px' }}
        />
      </td>
      <td>
        <span className={`dot dot-${row.status === 'active' ? 'present' : 'late'}`} />
        {row.status}
        {row.status === 'failed' && row.error ? <em>{row.error}</em> : null}
      </td>
      <td className="row-actions">
        {row.temp_password ? (
          <>
            <code>{row.temp_password}</code>
            <button type="button" className="btn btn-quiet" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={hidePassword}>
              Done
            </button>
          </>
        ) : null}
        {row.status === 'failed' ? (
          <button type="button" className="btn btn-quiet" onClick={retry}>
            Retry
          </button>
        ) : null}
        {isAdmin ? (
          <button type="button" className="btn btn-quiet" onClick={remove}>
            Remove
          </button>
        ) : null}
      </td>
    </tr>
  )
}

function StudentRow({ student, onChanged, onCapture }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const set = (field) => (event) => setDraft((previous) => ({ ...previous, [field]: event.target.value }))

  async function save() {
    setError('')
    const nextId = Number(draft.fingerprint_id)
    try {
      await api.updateStudent(student.id, {
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        grade_level: draft.grade_level.trim(),
        parent_email: draft.parent_email.trim().toLowerCase(),
        fingerprint_id: nextId,
      })
      if (nextId !== student.fingerprint_id) {
        // The old template keeps matching this finger on the sensor and would
        // be handed to whoever is enrolled into that slot next, so clear it.
        try {
          await api.queueClear(student.fingerprint_id)
          setNote(`Old slot ${student.fingerprint_id} queued for clearing on the scanner.`)
        } catch (clearError) {
          setNote(`Saved, but the old slot could not be queued for clearing: ${clearError.message}`)
        }
      }
      setDraft(null)
      await onChanged()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete ${fullName(student)}? Their attendance history goes with them. The fingerprint stays on the sensor until you clear it.`,
      )
    ) {
      return
    }
    await api.removeStudent(student.id)
    await onChanged()
  }

  if (draft) {
    return (
      <tr>
        <td colSpan={5} className="edit-cell">
          <div className="edit-grid">
            <label>
              First
              <input value={draft.first_name} onChange={set('first_name')} />
            </label>
            <label>
              Last
              <input value={draft.last_name} onChange={set('last_name')} />
            </label>
            <label>
              Grade
              <input value={draft.grade_level} onChange={set('grade_level')} list="grade-options" />
            </label>
            <label>
              Finger ID
              <input value={draft.fingerprint_id} onChange={set('fingerprint_id')} inputMode="numeric" />
            </label>
            <label className="edit-wide">
              Parent email
              <input value={draft.parent_email} onChange={set('parent_email')} type="email" />
            </label>
          </div>
          {error && <p className="alert alert-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              Save
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="mono">{student.fingerprint_id}</td>
      <td>{fullName(student)}</td>
      <td>{student.grade_level}</td>
      <td className="muted">{student.parent_email}</td>
      <td className="row-actions">
        {note && <em className="hint">{note}</em>}
        <button type="button" className="btn btn-quiet" onClick={() => onCapture(student)}>
          Fingerprint
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() =>
            setDraft({
              first_name: student.first_name,
              last_name: student.last_name,
              grade_level: student.grade_level,
              parent_email: student.parent_email,
              fingerprint_id: String(student.fingerprint_id),
            })
          }
        >
          Edit
        </button>
        <button type="button" className="btn btn-quiet" onClick={remove}>
          Delete
        </button>
      </td>
    </tr>
  )
}

export default function TeacherManagement() {
  const { team, students, access, refresh, refreshStaff } = useApp()
  const [query, setQuery] = useState('')
  const [capturing, setCapturing] = useState(null)
  const isAdmin = access === 'admin'

  const needle = query.trim().toLowerCase()
  const visibleStudents = students.filter((student) =>
    [fullName(student), student.grade_level, student.parent_email, String(student.fingerprint_id)]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
  const nextId = students.length ? Math.max(...students.map((student) => student.fingerprint_id)) + 1 : 1

  return (
    <section className="page">
      <header className="page-head">
        <h1>Professor management</h1>
        <p className="page-sub">
          Assign each professor to one grade — that grade is all their login can reach — and manage the
          student roster underneath them.
        </p>
      </header>

      <article className="card">
        <h2>Teaching staff</h2>
        {team.length === 0 ? (
          <p className="muted">No staff queued yet. Use Add staff.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Grade</th>
                <th>Allotted hours</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {team.map((row) => (
                <StaffRow key={row.id} row={row} isAdmin={isAdmin} onChanged={refreshStaff} />
              ))}
            </tbody>
          </table>
        )}
      </article>

      <h2 className="section-title">Student management</h2>

      <div className="split">
        <StudentForm
          students={students}
          nextId={nextId}
          onSaved={(student) => {
            refresh()
            setCapturing(student)
          }}
        />

        <article className="card">
          <label className="search">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search students"
              aria-label="Search students"
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                ×
              </button>
            )}
          </label>

          {visibleStudents.length === 0 ? (
            <p className="muted">
              {students.length === 0 ? 'No students enrolled yet.' : 'No student matches that search.'}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Grade</th>
                  <th>Parent</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map((student) => (
                  <StudentRow key={student.id} student={student} onChanged={refresh} onCapture={setCapturing} />
                ))}
              </tbody>
            </table>
          )}
        </article>
      </div>

      {capturing && <FingerprintCapture student={capturing} onClose={() => setCapturing(null)} />}
    </section>
  )
}
