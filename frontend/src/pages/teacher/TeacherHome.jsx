import { Avatar } from '../../components/ui.jsx'
import { rosterWithStatus, summarize } from '../../lib/attendance.js'
import { formatDateLong, formatTime, fullName } from '../../lib/format.js'
import { useApp } from '../../lib/useApp.js'

export default function TeacherHome() {
  const { students, logs, marks, staff } = useApp()
  const stats = summarize(students, logs, marks)
  const roster = rosterWithStatus(students, logs, marks)

  return (
    <section className="page">
      <header className="page-head">
        <h1>Dashboard</h1>
        <p className="page-sub">
          {staff?.full_name ? `${staff.full_name} · ` : ''}
          {staff?.grade_level ?? 'No grade assigned'} · {formatDateLong()}
        </p>
      </header>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{stats.enrolled}</span>
          <span className="stat-label">In my class</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.present}</span>
          <span className="stat-label">Present</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.late}</span>
          <span className="stat-label">Late</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.absent}</span>
          <span className="stat-label">Absent</span>
        </div>
      </div>

      <article className="card">
        <h2>Attendance today</h2>
        {roster.length === 0 ? (
          <p className="muted">
            No students are assigned to your grade yet. Use <a href="#/students">Students</a> to add
            them.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Scanned</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {roster.map(({ student, log, mark }) => {
                const status = mark?.status ?? log?.status ?? 'Absent'
                const tone = status === 'Late' ? 'late' : status === 'Absent' ? 'absent' : 'present'
                return (
                  <tr key={student.id}>
                    <td>
                      <span className="cell-person">
                        <Avatar student={student} size="sm" />
                        <strong>{fullName(student)}</strong>
                      </span>
                    </td>
                    <td className="mono">{log ? formatTime(log.scan_time) : '—'}</td>
                    <td>
                      <span className={`dot dot-${tone}`} />
                      {status}
                      {mark ? ' · marked' : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </article>
    </section>
  )
}
