import { useState } from 'react'
import { api } from '../lib/api.js'
import { verifyPassword } from '../lib/auth.js'
import { findTeacher, teacherScope } from '../lib/teaching.js'
import { useApp } from '../lib/useApp.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY = {
  student_number: '',
  fingerprint_id: '',
  first_name: '',
  last_name: '',
  teacher_id: '',
  grade_level: '',
  section: '',
  parent_email: '',
}

/**
 * The profile half of enrolling a student.
 * Flow:
 * 1. Fill out student details and click "Save student".
 * 2. The student form disappears and the password input appears.
 * 3. Entering the password confirms and commits the student to the database,
 *    then passes the created row to `onSaved`.
 *
 * `teachers` is only passed on the admin page: choosing a teacher there narrows
 * the grade and section picks to what that teacher actually teaches. `sections`
 * narrows the section pick directly, which is how a professor's own page limits
 * it to the sections they are assigned to.
 */
export function StudentForm({
  fixedGrade,
  grades,
  onGradeChange,
  teachers,
  sections,
  students,
  nextId,
  onSaved,
  bare = false,
}) {
  const { user, staff } = useApp()
  const [form, setForm] = useState(EMPTY)
  const [step, setStep] = useState('form') // 'form' | 'password'
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const scope = teacherScope(findTeacher(teachers, form.teacher_id))
  const allowedSections = scope?.sections.length ? scope.sections : sections?.length ? sections : null

  const update = (field) => (event) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }))
    setError('')
  }

  function chooseTeacher(event) {
    const teacherId = event.target.value
    const nextScope = teacherScope(findTeacher(teachers, teacherId))
    setForm((previous) => ({
      ...previous,
      teacher_id: teacherId,
      // A grade the new teacher does not teach would be saved as an orphan, so
      // clear the pair and let it be picked again from the narrower list.
      grade_level: nextScope && !nextScope.grades.includes(previous.grade_level) ? '' : previous.grade_level,
      section:
        nextScope?.sections.length && !nextScope.sections.includes(previous.section) ? '' : previous.section,
    }))
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
      setError('Fingerprint ID must be a whole number between 1 and 300.')
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
      // Security check: verify password
      const userEmail = user?.email || staff?.email
      await verifyPassword(userEmail, trimmedPassword)

      // Commit student to database
      const grade = fixedGrade ?? form.grade_level.trim()
      const student = await api.addStudent({
        fingerprint_id: Number(form.fingerprint_id),
        student_number: form.student_number.trim() || null,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        grade_level: grade,
        section: form.section.trim() || null,
        teacher_id: form.teacher_id || null,
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
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Confirm Student Enrollment</h3>
            <p className="hint" style={{ marginTop: '2px' }}>
              Saving{' '}
              <strong>
                {form.first_name.trim()} {form.last_name.trim()}
              </strong>{' '}
              (ID #{form.fingerprint_id} · {grade})
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
      <div className="field">
        <label htmlFor="student_number">Student ID</label>
        <input
          id="student_number"
          placeholder="2026-0148"
          value={form.student_number}
          onChange={update('student_number')}
          autoComplete="off"
        />
        <span className="hint">
          The number the school already uses for this student. Leave it blank if they do not have one yet.
        </span>
      </div>

      <div className="field">
        <label htmlFor="fingerprint_id">Fingerprint ID</label>
        <input
          id="fingerprint_id"
          inputMode="numeric"
          placeholder={String(nextId)}
          value={form.fingerprint_id}
          onChange={update('fingerprint_id')}
        />
        <span className="hint">
          A unique number for this student's print — the scanner matches a finger back to it.
        </span>
      </div>

      <div className="field">
        <label htmlFor="first_name">First name</label>
        <input id="first_name" value={form.first_name} onChange={update('first_name')} autoComplete="off" />
      </div>

      <div className="field">
        <label htmlFor="last_name">Last name</label>
        <input id="last_name" value={form.last_name} onChange={update('last_name')} autoComplete="off" />
      </div>

      {teachers?.length > 0 && (
        <div className="field">
          <label htmlFor="teacher_id">Teacher</label>
          <select id="teacher_id" value={form.teacher_id} onChange={chooseTeacher}>
            <option value="">No teacher assigned</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.full_name}
              </option>
            ))}
          </select>
          <span className="hint">Pick a teacher to limit grade and section to the ones they teach.</span>
        </div>
      )}

      <div className="field">
        <label htmlFor="grade_level">Grade level</label>
        {scope ? (
          <>
            <select id="grade_level" value={form.grade_level} onChange={update('grade_level')}>
              <option value="">Choose a grade</option>
              {scope.grades.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
            <span className="hint">Only the grades this teacher teaches.</span>
          </>
        ) : fixedGrade && grades?.length > 1 ? (
          <>
            <select
              id="grade_level"
              value={fixedGrade}
              onChange={(event) => onGradeChange?.(event.target.value)}
            >
              {grades.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
            <span className="hint">Only the grades you teach, and the student lands in this one.</span>
          </>
        ) : fixedGrade ? (
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
      </div>

      <div className="field">
        <label htmlFor="section">Section</label>
        {allowedSections ? (
          <>
            <select id="section" value={form.section} onChange={update('section')}>
              <option value="">Choose a section</option>
              {allowedSections.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
            <span className="hint">
              {scope
                ? 'Only the sections this teacher is assigned to.'
                : 'Only the sections you are assigned to.'}
            </span>
          </>
        ) : (
          <>
            <input
              id="section"
              placeholder="A"
              value={form.section}
              onChange={update('section')}
              list="roster-section-options"
              autoComplete="off"
            />
            <span className="hint">
              {scope
                ? 'This teacher takes any section of their grades.'
                : 'The class inside the grade. A professor limited to certain sections can only enroll students into those.'}
            </span>
          </>
        )}
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
