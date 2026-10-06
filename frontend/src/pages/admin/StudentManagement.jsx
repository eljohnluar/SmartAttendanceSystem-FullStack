import { useState } from 'react'
import { FingerprintCapture } from '../../components/FingerprintCapture.jsx'
import { RosterOptions } from '../../components/RosterOptions.jsx'
import { StudentForm } from '../../components/StudentForm.jsx'
import { StudentHead, StudentRow } from '../../components/StudentRow.jsx'
import { Modal } from '../../components/ui.jsx'
import { fullName } from '../../lib/format.js'
import { useApp } from '../../lib/useApp.js'

export default function StudentManagement() {
  const { students, team, refresh } = useApp()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [capturing, setCapturing] = useState(null)

  const teachers = team.filter((row) => row.role === 'teacher')
  const nextId = students.length ? Math.max(...students.map((student) => student.fingerprint_id)) + 1 : 1

  const needle = query.trim().toLowerCase()
  const visible = students.filter((student) =>
    [
      fullName(student),
      student.student_number,
      student.grade_level,
      student.section,
      student.parent_email,
      String(student.fingerprint_id),
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )

  async function saved(student) {
    await refresh()
    setAdding(false)
    setCapturing(student)
  }

  return (
    <section className="page">
      <header className="page-head page-head-row">
        <div>
          <h1>Student management</h1>
          <p className="page-sub">
            The whole roster: enroll someone, correct a name or a parent address, move a student between
            grades and sections, or remove them.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          Add student
        </button>
      </header>

      <article className="card">
        <label className="search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search students"
            aria-label="Search students"
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </label>

        {visible.length === 0 ? (
          <p className="muted">
            {students.length === 0
              ? 'No students enrolled yet. Use Add student to create the first one.'
              : 'No student matches that search.'}
          </p>
        ) : (
          <table>
            <thead>
              <StudentHead showTeacher />
            </thead>
            <tbody>
              {visible.map((student) => (
                <StudentRow
                  key={student.id}
                  student={student}
                  teachers={teachers}
                  onChanged={refresh}
                  onCapture={setCapturing}
                />
              ))}
            </tbody>
          </table>
        )}
      </article>

      {adding && (
        <Modal title="Add student" wide onClose={() => setAdding(false)}>
          <StudentForm bare students={students} teachers={teachers} nextId={nextId} onSaved={saved} />
        </Modal>
      )}

      <RosterOptions students={students} />

      {capturing && <FingerprintCapture student={capturing} onClose={() => setCapturing(null)} />}
    </section>
  )
}
