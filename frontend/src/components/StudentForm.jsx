import { useState } from 'react'
import { api } from '../lib/api.js'
import { findTeacher, teacherScope } from '../lib/teaching.js'

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
 * The profile half of enrolling a student. Fill out the details and the form
 * validates them, commits the student to the database, then passes the created
 * row to `onSaved`.
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
  nextId,
  onSaved,
  bare = false,
}) {
  const [form, setForm] = useState(EMPTY)
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
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const fingerprintId = Number(form.fingerprint_id)
    if (!Number.isInteger(fingerprintId) || fingerprintId < 1 || fingerprintId > 1000) {
      setError('Fingerprint ID must be a whole number between 1 and 1000.')
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
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Add student form ───────────────────────────────────────────────────
  return (
    <form className={bare ? 'form' : 'card form'} onSubmit={handleSubmit} noValidate>
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
