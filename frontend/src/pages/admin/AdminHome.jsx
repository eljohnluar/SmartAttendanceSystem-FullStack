import { useState } from 'react'
import { Avatar } from '../../components/ui.jsx'
import { byGrade, recentScans, summarize } from '../../lib/attendance.js'
import { formatDateLong, formatTime, fullName } from '../../lib/format.js'
import { useApp } from '../../lib/useApp.js'

export default function AdminHome() {
  const { students, logs, marks, team, staff, setMaxSessionHours } = useApp()
  const stats = summarize(students, logs, marks)
  const grades = byGrade(students, logs, marks)
  const recent = recentScans(logs, students)
  const pending = team.filter((row) => row.status === 'pending')
  const failed = team.filter((row) => row.status === 'failed')
  const [hoursInput, setHoursInput] = useState(staff?.max_session_hours ?? 8)
  const [hoursSaved, setHoursSaved] = useState(false)
  const [hoursError, setHoursError] = useState('')

  async function saveHours() {
    const hours = Number(hoursInput)
    if (!hours || hours <= 0 || hours > 24) {
      setHoursError('Enter a value between 0.5 and 24.')
      return
    }
    try {
      await setMaxSessionHours(staff.id, hours)
      setHoursSaved(true)
      setHoursError('')
      setTimeout(() => setHoursSaved(false), 2000)
    } catch (error) {
      setHoursError(error.message)
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>School overview</h1>
        <p className="page-sub">{formatDateLong()}</p>
      </header>

      <article className="card time-card">
        <h2>Allotted session time</h2>
        <p className="muted" style={{ marginBottom: '16px' }}>
          Set the maximum number of hours you can stay logged in. When the time is up, you will be
          logged out automatically.
        </p>
        <div className="hours-row">
          <div className="field" style={{ flex: '0 1 140px' }}>
            <label htmlFor="max_session_hours">Hours</label>
            <input
              id="max_session_hours"
              type="number"
              min="0.5"
              max="24"
              step="0.5"
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={saveHours}>
            {hoursSaved ? 'Saved' : 'Save'}
          </button>
        </div>
        {hoursError && <p className="alert alert-error" style={{ marginTop: '12px' }}>{hoursError}</p>}
        {hoursSaved && <p className="alert alert-ok" style={{ marginTop: '12px' }}>Allotted time updated.</p>}
      </article>

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
          <a href="#/teachers">Open Professor Management</a>
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
              <a href="#/teachers">Professor Management</a>.
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
