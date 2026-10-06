import { useState } from 'react'
import { api } from '../lib/api.js'
import { fullName } from '../lib/format.js'
import { findTeacher, teacherName, teacherScope } from '../lib/teaching.js'

/**
 * One roster row and its inline editor, shared by the admin's Student
 * Management page and the professor's Students page. The Teacher column and
 * picker only appear when the page hands over a teacher list, which is an admin
 * thing: a professor has no colleagues to assign a student to. `scope` narrows
 * the grade and section fields the way the page's own Add student form does.
 */
export function StudentRow({ student, teachers = [], scope: pageScope = null, onChanged, onCapture }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const set = (field) => (event) => setDraft((previous) => ({ ...previous, [field]: event.target.value }))
  const showTeacher = teachers.length > 0
  const scope = teacherScope(findTeacher(teachers, draft?.teacher_id)) ?? pageScope

  function chooseTeacher(event) {
    const teacherId = event.target.value
    const nextScope = teacherScope(findTeacher(teachers, teacherId))
    setDraft((previous) => ({
      ...previous,
      teacher_id: teacherId,
      // Keep the pair valid: a grade or section the new teacher does not have
      // would save as something their own login cannot reach.
      grade_level: nextScope && !nextScope.grades.includes(previous.grade_level) ? '' : previous.grade_level,
      section:
        nextScope?.sections.length && !nextScope.sections.includes(previous.section) ? '' : previous.section,
    }))
  }

  async function save() {
    setError('')
    const nextId = Number(draft.fingerprint_id)
    try {
      await api.updateStudent(student.id, {
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        student_number: draft.student_number.trim() || null,
        grade_level: draft.grade_level.trim(),
        section: draft.section.trim() || null,
        teacher_id: draft.teacher_id || null,
        parent_email: draft.parent_email.trim().toLowerCase(),
        fingerprint_id: nextId,
      })
      if (nextId !== student.fingerprint_id) {
        // The print rides on the student's row, so it now belongs to the new ID.
        // This just drops the old ID from the scanner instead of waiting for the
        // next rebuild, and is a convenience: the resync would do it anyway.
        try {
          await api.queueClear(student.fingerprint_id)
          setNote(`Moved to Fingerprint ID ${nextId}. The scanner forgets the old one within a minute.`)
        } catch {
          setNote(`Saved. The scanner picks up Fingerprint ID ${nextId} within a minute.`)
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
        `Delete ${fullName(student)}? Their attendance history and their saved fingerprint go with them; the scanner forgets the print within a minute.`,
      )
    ) {
      return
    }
    setError('')
    try {
      await api.removeStudent(student.id)
      await onChanged()
    } catch (removeError) {
      // A professor whose login has not been granted deletes yet needs to see
      // why nothing happened rather than watch the row stay put.
      setError(removeError.message)
    }
  }

  if (draft) {
    return (
      <tr>
        <td colSpan={showTeacher ? 8 : 7} className="edit-cell">
          <div className="edit-grid">
            <label>
              Student ID
              <input value={draft.student_number} onChange={set('student_number')} />
            </label>
            <label>
              First
              <input value={draft.first_name} onChange={set('first_name')} />
            </label>
            <label>
              Last
              <input value={draft.last_name} onChange={set('last_name')} />
            </label>
            {showTeacher && (
              <label>
                Teacher
                <select value={draft.teacher_id} onChange={chooseTeacher}>
                  <option value="">No teacher assigned</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.full_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Grade
              {scope ? (
                <select value={draft.grade_level} onChange={set('grade_level')}>
                  <option value="">Choose a grade</option>
                  {scope.grades.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={draft.grade_level} onChange={set('grade_level')} list="grade-options" />
              )}
            </label>
            <label>
              Section
              {scope?.sections.length ? (
                <select value={draft.section} onChange={set('section')}>
                  <option value="">Choose a section</option>
                  {scope.sections.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={draft.section} onChange={set('section')} list="roster-section-options" />
              )}
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
      <td className="mono">{student.student_number || '—'}</td>
      <td className="mono">{student.fingerprint_id}</td>
      <td>{fullName(student)}</td>
      <td>{student.grade_level}</td>
      <td className="muted">{student.section || '—'}</td>
      {showTeacher && <td className="muted">{teacherName(teachers, student.teacher_id) || '—'}</td>}
      <td className="muted">{student.parent_email}</td>
      <td className="row-actions">
        {note && <em className="hint">{note}</em>}
        {error && <span className="mark-note err">{error}</span>}
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
              student_number: student.student_number ?? '',
              teacher_id: student.teacher_id ?? '',
              grade_level: student.grade_level,
              section: student.section ?? '',
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

export function StudentHead({ showTeacher = false }) {
  return (
    <tr>
      <th>Student ID</th>
      <th>Finger ID</th>
      <th>Name</th>
      <th>Grade</th>
      <th>Section</th>
      {showTeacher && <th>Teacher</th>}
      <th>Parent</th>
      <th />
    </tr>
  )
}
