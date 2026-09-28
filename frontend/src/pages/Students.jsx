import { useState } from 'react'
import { FingerprintCapture } from '../components/FingerprintCapture.jsx'
import { StudentForm } from '../components/StudentForm.jsx'
import { Modal } from '../components/ui.jsx'
import { fullName } from '../lib/format.js'
import { useApp } from '../lib/useApp.js'

export default function Students() {
  const { students, access, staff, refresh } = useApp()
  const [adding, setAdding] = useState(false)
  const [capturing, setCapturing] = useState(null)

  const fixedGrade = access === 'teacher' ? staff?.grade_level : null
  const nextId = students.length
    ? Math.max(...students.map((student) => student.fingerprint_id)) + 1
    : 1

  async function saved(student) {
    await refresh()
    setAdding(false)
    setCapturing(student)
  }

  return (
    <section className="page">
      <header className="page-head page-head-row">
        <div>
          <h1>Students</h1>
          <p className="page-sub">
            {fixedGrade ? `Everyone in ${fixedGrade}` : 'Everyone enrolled so far'}. Each student needs a
            Fingerprint ID — the slot on the scanner — before they can check in.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          Add student
        </button>
      </header>

      <article className="card">
        {students.length === 0 ? (
          <p className="muted">No students yet. Use Add student to create the first one.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Grade</th>
                <th>Parent</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td className="mono">{student.fingerprint_id}</td>
                  <td>
                    <strong>{fullName(student)}</strong>
                  </td>
                  <td>{student.grade_level}</td>
                  <td className="muted">{student.parent_email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>

      {adding && (
        <Modal title="Add student" wide onClose={() => setAdding(false)}>
          <StudentForm
            bare
            fixedGrade={fixedGrade}
            students={students}
            nextId={nextId}
            onSaved={saved}
          />
        </Modal>
      )}

      {capturing && <FingerprintCapture student={capturing} onClose={() => setCapturing(null)} />}
    </section>
  )
}
