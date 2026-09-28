import { useState } from 'react'
import { api } from '../lib/api.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY = {
  fingerprint_id: '',
  first_name: '',
  last_name: '',
  grade_level: '',
  parent_email: '',
}

/**
 * The profile half of enrolling a student. `fixedGrade` locks the grade for
 * teachers. Handing the saved row to `onSaved` lets the caller decide when the
 * fingerprint is captured, so a failed print still leaves a usable student.
 * `bare` drops the card box for callers that host the form in a modal.
 */
export function StudentForm({ fixedGrade, students, nextId, onSaved, bare = false }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (field) => (event) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }))
    setError('')
  }

  function reset() {
    setForm(EMPTY)
    setError('')
  }

  async function submit(event) {
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

    setBusy(true)
    try {
      const student = await api.addStudent({
        fingerprint_id: fingerprintId,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        grade_level: grade,
        parent_email: form.parent_email.trim().toLowerCase(),
      })
      reset()
      await onSaved?.(student)
    } catch (addError) {
      setError(addError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={bare ? 'form' : 'card form'} onSubmit={submit} noValidate>
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
            placeholder="Grade 5"
            value={form.grade_level}
            onChange={update('grade_level')}
            list="grade-options"
          />
        )}
        <datalist id="grade-options">
          {[...new Set([...students.map((student) => student.grade_level), 'Grade 5'])]
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
          {busy ? 'Saving…' : 'Add student'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={reset}>
          Clear
        </button>
      </div>
    </form>
  )
}
