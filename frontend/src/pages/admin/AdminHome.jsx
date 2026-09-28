import { Avatar } from '../../components/ui.jsx'
import { byGrade, recentScans, summarize } from '../../lib/attendance.js'
import { formatDateLong, formatTime, fullName } from '../../lib/format.js'
import { useApp } from '../../lib/useApp.js'

export default function AdminHome() {
  const { students, logs, team } = useApp()
  const stats = summarize(students, logs)
  const grades = byGrade(students, logs)
  const recent = recentScans(logs, students)
  const pending = team.filter((row) => row.status === 'pending')
  const failed = team.filter((row) => row.status === 'failed')

  return (
    <section className="page">
      <header className="page-head">
        <h1>School overview</h1>
        <p className="page-sub">{formatDateLong()}</p>
      </header>

      {(pending.length > 0 || failed.length > 0) && (
        <p className="alert alert-note">
          {pending.length > 0 && (
            <>
              {pending.length} staff {pending.length === 1 ? 'account is' : 'accounts are'} waiting to
              be provisioned. The Python service creates them, so it has to be running.{' '}
            </>
          )}
          {failed.length > 0 && (
            <>{failed.length} failed to provision — check the Staff page. </>
          )}
          <a href="#/teachers">Open Teacher Management</a>
        </p>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{stats.enrolled}</span>
          <span className="stat-label">Students enrolled</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.present}</span>
          <span className="stat-label">Present today</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.late}</span>
          <span className="stat-label">Late today</span>
        </div>
        <div className="stat">
          <span className="stat-value">{team.length}</span>
          <span className="stat-label">Staff accounts</span>
        </div>
      </div>

      <div className="panels">
        <article className="card">
          <h2>By grade</h2>
          {grades.length === 0 ? (
            <p className="muted">
              Nothing to report yet. Add students from{' '}
              <a href="#/teachers">Teacher Management</a>.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Grade</th>
                  <th>Enrolled</th>
                  <th>Present</th>
                  <th>Late</th>
                  <th>Absent</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((row) => (
                  <tr key={row.grade}>
                    <td>{row.grade}</td>
                    <td className="mono">{row.enrolled}</td>
                    <td className="ok">{row.present}</td>
                    <td>{row.late}</td>
                    <td className="muted">{row.absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="card">
          <h2>Latest scans</h2>
          {recent.length === 0 ? (
            <p className="muted">No scans recorded today.</p>
          ) : (
            <ul className="feed">
              {recent.map(({ log, student }) => (
                <li key={log.id}>
                  <Avatar student={student} size="sm" />
                  <span className="feed-body">
                    <strong>{fullName(student)}</strong>
                    <em>{student?.grade_level}</em>
                  </span>
                  <span className="feed-time mono">{formatTime(log.scan_time)}</span>
                  <span className={`dot dot-${log.status === 'Late' ? 'late' : 'present'}`} />
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  )
}
