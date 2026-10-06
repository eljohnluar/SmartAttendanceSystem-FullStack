import { useState } from 'react'
import { api } from '../../lib/api.js'
import { GradeFields } from '../../components/GradeFields.jsx'
import { SectionFields, cleanSections, knownSections } from '../../components/SectionFields.jsx'
import { cleanGrades, gradesOf } from '../../lib/grades.js'
import { useApp } from '../../lib/useApp.js'

function StaffRow({ row, onChanged, isAdmin, gradesInUse }) {
  const [copied, setCopied] = useState(false)

  async function changeGrades(grades) {
    const list = cleanGrades(grades)
    await api.updateStaff(row.id, { grades, grade_level: list[0] ?? null })
    await onChanged()
  }

  async function changeSections(sections) {
    await api.updateStaff(row.id, { sections: cleanSections(sections) })
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
          <div className="staff-scope">
            <GradeFields
              grades={gradesOf(row)}
              options={gradesInUse}
              onChange={changeGrades}
              nameFor={(number) => `Grade ${number} for ${row.full_name}`}
            />
            <SectionFields
              sections={row.sections ?? []}
              onChange={changeSections}
              listId="managed-section-options"
              nameFor={(number) => `Section ${number} for ${row.full_name}`}
            />
          </div>
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

export default function TeacherManagement() {
  const { team, students, access, refreshStaff } = useApp()
  const isAdmin = access === 'admin'
  // The roster is read here only to offer grades and sections that already exist;
  // the students themselves are managed on their own page.
  const gradesInUse = [...new Set(students.map((student) => student.grade_level).filter(Boolean))].sort()

  return (
    <section className="page">
      <header className="page-head">
        <h1>Professor management</h1>
        <p className="page-sub">
          Assign each professor their grades, optionally narrowed to sections. That scope is what their login
          can reach; the roster itself lives on the Student Management page.
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
                <th>Grades and sections</th>
                <th>Allotted hours</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {team.map((row) => (
                <StaffRow
                  key={row.id}
                  row={row}
                  isAdmin={isAdmin}
                  gradesInUse={gradesInUse}
                  onChanged={refreshStaff}
                />
              ))}
            </tbody>
          </table>
        )}
      </article>

      <datalist id="managed-section-options">
        {knownSections(students).map((section) => (
          <option key={section} value={section} />
        ))}
      </datalist>
    </section>
  )
}
