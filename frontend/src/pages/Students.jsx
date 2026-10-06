import { useState } from 'react'
import { FingerprintCapture } from '../components/FingerprintCapture.jsx'
import { RosterOptions } from '../components/RosterOptions.jsx'
import { StudentForm } from '../components/StudentForm.jsx'
import { StudentHead, StudentRow } from '../components/StudentRow.jsx'
import { Modal } from '../components/ui.jsx'
import { fullName } from '../lib/format.js'
import { useApp } from '../lib/useApp.js'

export default function Students() {
  const { students, access, staff, grades, activeGrade, setActiveGrade, refresh } = useApp()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [capturing, setCapturing] = useState(null)

  const fixedGrade = access === 'teacher' ? activeGrade : null
  const mySections = (staff?.sections ?? []).filter(Boolean)
  const nextId = students.length ? Math.max(...students.map((student) => student.fingerprint_id)) + 1 : 1

  async function saved(student) {
    await refresh()
    setAdding(false)
    setCapturing(student)
  }

  // A professor teaching several grades works one at a time, so the roster
  // follows the grade chosen in the filter rather than mixing classes together.
  const inGrade =
    fixedGrade && grades.length > 1
      ? students.filter((student) => student.grade_level === fixedGrade)
      : students

  const sectionOptions = mySections.length
    ? mySections
    : [...new Set(inGrade.map((student) => student.section).filter(Boolean))].sort()

  const filtered = sectionFilter ? inGrade.filter((student) => student.section === sectionFilter) : inGrade

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? filtered.filter((student) =>
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
    : filtered

  const plural = (n) => `${n} ${n === 1 ? 'student' : 'students'}`
  const countLabel =
    visible.length === filtered.length
      ? plural(visible.length)
      : `${visible.length} of ${plural(filtered.length)}`
  const scopeLabel = [fixedGrade, sectionFilter ? `Section ${sectionFilter}` : ''].filter(Boolean).join(' · ')

  return (
    <section className="page">
      <header className="page-head page-head-row">
        <div>
          <h1>Students</h1>
          <p className="page-sub">
            {scopeLabel ? `Everyone in ${scopeLabel}` : 'Everyone enrolled so far'}. Each student needs an
            enrolled fingerprint under their Fingerprint ID before they can check in.
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-quiet" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Add student
          </button>
        </div>
      </header>

      <article className="card">
        <div className="roster-filters">
          {grades.length > 0 && (
            <label className="roster-filter" htmlFor="filter_grade">
              Grade
              <select
                id="filter_grade"
                value={activeGrade ?? ''}
                onChange={(event) => setActiveGrade(event.target.value)}
              >
                {grades.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
            </label>
          )}
          {sectionOptions.length > 0 && (
            <label className="roster-filter" htmlFor="filter_section">
              Section
              <select
                id="filter_section"
                value={sectionFilter}
                onChange={(event) => setSectionFilter(event.target.value)}
              >
                <option value="">All sections</option>
                {sectionOptions.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="roster-tools">
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
          <span className="roster-count">{countLabel}</span>
        </div>

        <div className="print-head">
          <h2>Student records{scopeLabel ? ` — ${scopeLabel}` : ''}</h2>
          <p>
            {plural(filtered.length)} · printed {new Date().toLocaleDateString()}
          </p>
        </div>

        {visible.length === 0 ? (
          <p className="muted">
            {needle || sectionFilter
              ? 'No student matches that search.'
              : students.length
                ? `No students in ${scopeLabel || 'this class'} yet. Use Add student to create the first one.`
                : 'No students yet. Use Add student to create the first one.'}
          </p>
        ) : (
          <table>
            <thead>
              <StudentHead />
            </thead>
            <tbody>
              {visible.map((student) => (
                <StudentRow
                  key={student.id}
                  student={student}
                  scope={{ grades, sections: mySections }}
                  onChanged={refresh}
                  onCapture={setCapturing}
                />
              ))}
            </tbody>
          </table>
        )}
      </article>

      <RosterOptions students={students} />

      {adding && (
        <Modal title="Add student" wide onClose={() => setAdding(false)}>
          <StudentForm
            bare
            fixedGrade={fixedGrade}
            grades={grades}
            onGradeChange={setActiveGrade}
            sections={mySections}
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
