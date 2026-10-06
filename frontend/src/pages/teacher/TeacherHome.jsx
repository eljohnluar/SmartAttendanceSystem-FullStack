import { useState, Fragment } from 'react'
import { api } from '../../lib/api.js'
import { Avatar } from '../../components/ui.jsx'
import { rosterWithStatus, summarize } from '../../lib/attendance.js'
import { formatDateLong, formatTime, fullName } from '../../lib/format.js'
import { useApp } from '../../lib/useApp.js'

const STATUSES = ['Present', 'Late', 'Absent']

/**
 * Row-level controls for manually marking a student's attendance and
 * optionally notifying their parent by email via Brevo.
 */
function ManualMarkRow({ student, log, staff, onDone }) {
  const [busy, setBusy] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function mark(status) {
    setBusy(true)
    setNote('')
    setError('')
    try {
      if (api.saveMark) {
        await api.saveMark(student.id, status).catch(() => {})
      }
      const row = await api.markAttendance(student.id, status)

      // Fire-and-forget parent notification via Edge Function
      setNotifying(true)
      try {
        await api.notifyParent({
          logId: row.id,
          student,
          status,
          scanTime: row.scan_time,
          markedBy: staff?.full_name ?? '',
        })
        setNote(`Marked ${status}. Parent notified by email.`)
      } catch (emailErr) {
        // Email failed but the attendance row was saved — non-fatal
        setNote(`Marked ${status}. Email notification failed: ${emailErr.message}`)
      } finally {
        setNotifying(false)
      }

      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function resendNotification() {
    if (!log) return
    setNotifying(true)
    setNote('')
    setError('')
    try {
      await api.notifyParent({
        logId: log.id,
        student,
        status: log.status,
        scanTime: log.scan_time,
        markedBy: staff?.full_name ?? '',
      })
      setNote(`Re-sent parent notification (${log.status}).`)
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setNotifying(false)
    }
  }

  return (
    <div className="manual-mark">
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          className={`btn btn-sm btn-mark btn-mark-${s.toLowerCase()}`}
          disabled={busy || notifying}
          onClick={() => mark(s)}
          title={`Mark ${s} and notify parent`}
        >
          {s}
        </button>
      ))}

      {log && !log.parent_notified && student.parent_email && (
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          disabled={notifying || busy}
          onClick={resendNotification}
          title="Re-send parent email"
        >
          {notifying ? 'Sending…' : 'Notify'}
        </button>
      )}

      {note && <span className="mark-note ok">{note}</span>}
      {error && <span className="mark-note err">{error}</span>}
    </div>
  )
}

export default function TeacherHome() {
  const { students, logs, marks, staff, grades, refresh } = useApp()
  const [expanded, setExpanded] = useState(null)
  const stats = summarize(students, logs, marks)
  const roster = rosterWithStatus(students, logs, marks)

  function toggleRow(studentId) {
    setExpanded((prev) => (prev === studentId ? null : studentId))
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>Dashboard</h1>
        <p className="page-sub">
          {staff?.full_name ? `${staff.full_name} · ` : ''}
          {grades.length ? grades.join(' · ') : 'No grade assigned'}
          {staff?.sections?.length ? ` · ${staff.sections.join(', ')}` : ''} · {formatDateLong()}
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
        <p className="hint">
          Click a row to manually mark attendance and notify the parent by email.
        </p>
        {roster.length === 0 ? (
          <p className="muted">
            No students are assigned to your grades yet. Use <a href="#/students">Students</a> to add
            them.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Scanned</th>
                <th>Status</th>
                <th>Parent</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {roster.map(({ student, log, mark }) => {
                const status = mark?.status ?? log?.status ?? 'Absent'
                const tone = status === 'Late' ? 'late' : status === 'Absent' ? 'absent' : 'present'
                return (
                  <Fragment key={student.id}>
                    <tr
                      className={`roster-row${expanded === student.id ? ' roster-row-open' : ''}`}
                      onClick={() => toggleRow(student.id)}
                      style={{ cursor: 'pointer' }}
                    >
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
                      <td className={log?.parent_notified ? 'ok' : 'muted'}>
                        {log ? (log.parent_notified ? 'Notified' : 'Pending') : '—'}
                      </td>
                      <td>
                        <span className="expand-caret" aria-hidden="true">
                          {expanded === student.id ? '▲' : '▼'}
                        </span>
                      </td>
                    </tr>

                    {expanded === student.id && (
                      <tr className="mark-row">
                        <td colSpan={5}>
                          <ManualMarkRow
                            student={student}
                            log={log}
                            staff={staff}
                            onDone={() => {
                              setExpanded(null)
                              refresh()
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </article>
    </section>
  )
}
