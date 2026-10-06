import { useApp } from '../../lib/useApp.js'

const ROLE_LABEL = { teacher: 'Professor', admin: 'Admin' }
const STATUS_LABEL = { active: 'Active', pending: 'Waiting for approval', failed: 'Login not created' }

/**
 * The signed-in professor's own record: what their login says about them, and
 * which classes it lets them reach. Read-only — an admin edits staff from the
 * Professor Management page.
 */
export default function MyProfile() {
  const { staff, user, students, grades } = useApp()

  const perGrade = grades.length ? grades : [...new Set(students.map((s) => s.grade_level))].sort()
  const classes = perGrade.map((grade) => {
    const roster = students.filter((student) => student.grade_level === grade)
    const inRoster = [...new Set(roster.map((student) => student.section).filter(Boolean))].sort()
    const sections = (staff?.sections ?? []).filter(Boolean)
    return {
      grade,
      sections: sections.length ? sections : inRoster,
      students: roster.length,
    }
  })

  return (
    <section className="page">
      <header className="page-head">
        <h1>My profile</h1>
        <p className="page-sub">
          The account you sign in with, and the classes it lets you reach. An admin changes any of it from
          Professor Management.
        </p>
      </header>

      <article className="card">
        <h2>Your account</h2>
        <dl className="profile-list">
          <div>
            <dt>Name</dt>
            <dd>{staff?.full_name || user?.email || '—'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{staff?.email || user?.email || '—'}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{ROLE_LABEL[staff?.role] ?? staff?.role ?? '—'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{STATUS_LABEL[staff?.status] ?? staff?.status ?? '—'}</dd>
          </div>
          <div>
            <dt>Session time</dt>
            <dd>
              {staff?.max_session_hours ?? '—'} hours
              <span className="hint">
                You are signed out automatically after this. Set it on the Attendance page.
              </span>
            </dd>
          </div>
        </dl>
      </article>

      <article className="card">
        <h2>Classes you teach</h2>
        {classes.length === 0 ? (
          <p className="muted">
            No grade is assigned to your account yet, so no students are reachable. An admin sets this from
            Professor Management.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Grade</th>
                <th>Sections</th>
                <th>Students</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((entry) => (
                <tr key={entry.grade}>
                  <td>{entry.grade}</td>
                  <td className="muted">
                    {entry.sections.length ? entry.sections.join(', ') : 'Every section'}
                  </td>
                  <td className="mono">{entry.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  )
}
