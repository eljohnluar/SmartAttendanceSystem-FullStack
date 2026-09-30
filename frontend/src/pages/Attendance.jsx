import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { latestByStudent, markFor, summarize } from '../lib/attendance.js'
import { Avatar, StatusPill } from '../components/ui.jsx'
import { formatDateLong, formatTime, fullName, studentFor } from '../lib/format.js'
import { useApp } from '../lib/useApp.js'

function TimeCard() {
  const { staff, setMaxSessionHours } = useApp()
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
  )
}

const SUGGESTED_START = '08:00'
const SUGGESTED_GRACE = 15

function matches(needle, ...haystacks) {
  // fingerprint_id arrives as a number, which has no toLowerCase of its own.
  return haystacks.some((text) => String(text ?? '').toLowerCase().includes(needle))
}

function cutoffOf(start, minutes) {
  const [hour, minute] = start.split(':').map(Number)
  const total = hour * 60 + minute + minutes
  if (!Number.isFinite(total)) return start
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * When a class starts and how much slack it gets. Stored per grade so the
 * Python service applies the right rule the moment it logs the next scan.
 */
function LateRule({ students, logs }) {
  const { refresh } = useApp()
  const grades = useMemo(
    () => [...new Set(students.map((student) => student.grade_level).filter(Boolean))].sort(),
    [students],
  )
  const [picked, setPicked] = useState('')
  const grade = grades.includes(picked) ? picked : (grades[0] ?? '')

  const [start, setStart] = useState(SUGGESTED_START)
  const [grace, setGrace] = useState(String(SUGGESTED_GRACE))
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!grade) return undefined
    let stale = false
    api
      .getGradeSettings(grade)
      .then((row) => {
        if (stale) return
        setStart(row?.school_start ? row.school_start.slice(0, 5) : SUGGESTED_START)
        setGrace(String(row?.late_grace_minutes ?? SUGGESTED_GRACE))
        setSaved(row ?? null)
        setNote('')
        setError('')
      })
      .catch((loadError) => {
        if (!stale) setError(loadError.message)
      })
    return () => {
      stale = true
    }
  }, [grade])

  const todayCount = useMemo(
    () => logs.filter((log) => studentFor(log, students)?.grade_level === grade).length,
    [logs, students, grade],
  )

  async function save(event) {
    event.preventDefault()
    const minutes = Number(grace)
    if (!/^\d{2}:\d{2}$/.test(start)) {
      setError('Pick a start time first.')
      return
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180) {
      setError('Grace must be a whole number of minutes between 0 and 180.')
      return
    }

    setBusy(true)
    setError('')
    setNote('')
    try {
      await api.saveGradeSettings(grade, { school_start: start, late_grace_minutes: minutes })
      setSaved({ school_start: start, late_grace_minutes: minutes })
      setNote(`Saved. ${grade} is late from ${cutoffOf(start, minutes)} onwards.`)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    setConfirming(false)
    setError('')
    setNote('')
    try {
      const cleared = await api.resetAttendance(grade)
      setNote(
        cleared ? `Cleared ${cleared} scan${cleared === 1 ? '' : 's'} for ${grade}. They can scan again.` : `Nothing to clear for ${grade} today.`,
      )
      await refresh()
    } catch (resetError) {
      setError(resetError.message)
    } finally {
      setBusy(false)
    }
  }

  if (grades.length === 0) return null

  return (
    <section className="card rule-card">
      <h2>Late rule</h2>

      <form className="rule-row" onSubmit={save}>
        {grades.length > 1 && (
          <div className="field">
            <label htmlFor="rule_grade">Grade</label>
            <select id="rule_grade" value={grade} onChange={(event) => setPicked(event.target.value)}>
              {grades.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="rule_start">School starts</label>
          <input
            id="rule_start"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="rule_grace">Grace (minutes)</label>
          <input
            id="rule_grace"
            type="number"
            min="0"
            max="180"
            step="1"
            value={grace}
            onChange={(event) => setGrace(event.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save
        </button>
      </form>

      <p className="hint">
        {saved
          ? `Late after ${cutoffOf(saved.school_start, saved.late_grace_minutes)} for ${grade}.`
          : `No rule saved for ${grade} yet, so it falls back to ${SUGGESTED_START} plus ${SUGGESTED_GRACE} minutes. Saving here sets the rule for this class.`}
      </p>

      {error && <p className="alert alert-error">{error}</p>}
      {note && !error && <p className="alert alert-ok">{note}</p>}

      <div className="rule-reset">
        {confirming ? (
          <>
            <p>
              Clear all {todayCount} scan{todayCount === 1 ? '' : 's'} recorded today for {grade}? The
              students will need to scan again.
            </p>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={reset} disabled={busy}>
              Yes, clear them
            </button>
          </>
        ) : (
          <>
            <p className="hint">
              {todayCount} scan{todayCount === 1 ? '' : 's'} recorded today for {grade}.
            </p>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setConfirming(true)}
              disabled={busy || todayCount === 0}
            >
              Reset today
            </button>
          </>
        )}
      </div>
    </section>
  )
}

export default function Dashboard() {
  const { students, logs, marks, backend, access, staff, refresh } = useApp()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const stats = summarize(students, logs, marks)
  const latest = latestByStudent(logs)

  const visibleLogs = useMemo(
    () =>
      logs.filter((log) => {
        if (!needle) return true
        const student = studentFor(log, students)
        return matches(needle, fullName(student), student?.grade_level, log.status)
      }),
    [logs, students, needle],
  )

  const visibleStudents = useMemo(
    () =>
      students.filter((student) =>
        matches(
          needle,
          fullName(student),
          student.grade_level,
          student.parent_email,
          student.fingerprint_id,
          markFor(marks, student.id)?.status ?? latest.get(student.id)?.status ?? '',
        ),
      ),
    [students, marks, latest, needle],
  )

  /** '' means "no override — go by the scan", which deletes the mark row. */
  async function setMark(student, status) {
    try {
      if (status) await api.saveMark(student.id, status)
      else await api.clearMark(student.id)
      await refresh()
    } catch (markError) {
      window.alert(markError.message)
    }
  }

  return (
    <section className="page">
      <header className="page-head page-head-row">
        <div>
          <h1>Attendance dashboard</h1>
          <p className="page-sub">{formatDateLong()}</p>
        </div>
        <div className="head-side">
          {access === 'teacher' && <span className="pill pill-demo">{staff?.grade_level} only</span>}
          <StatusPill backend={backend} />
        </div>
      </header>

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
          <span className="stat-value">{stats.absent}</span>
          <span className="stat-label">Absent today</span>
        </div>
        <div className="stat">
          <span className="stat-value">{logs.filter((log) => log.parent_notified).length}</span>
          <span className="stat-label">Parent emails sent</span>
        </div>
      </div>

      <TimeCard />

      <LateRule students={students} logs={logs} />

      <label className="search">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a student, grade or parent email"
          aria-label="Search"
        />
        {query && (
          <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
            ×
          </button>
        )}
      </label>

      <div className="panels">
        <article className="card">
          <h2>Today’s log</h2>
          {visibleLogs.length === 0 ? (
            <p className="muted">{logs.length === 0 ? 'No scans recorded yet today.' : 'No results for that search.'}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Student</th>
                  <th>Status</th>
                  <th>Parent</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((log) => {
                  const student = studentFor(log, students)
                  return (
                    <tr key={log.id}>
                      <td className="mono">{formatTime(log.scan_time)}</td>
                      <td>
                        <span className="cell-person">
                          <Avatar student={student} size="sm" />
                          <span>
                            <strong>{fullName(student)}</strong>
                            <em>{student?.grade_level ?? 'Removed student'}</em>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={`dot dot-${log.status === 'Late' ? 'late' : 'present'}`} />
                        {log.status}
                      </td>
                      <td className={log.parent_notified ? 'ok' : 'muted'}>
                        {log.parent_notified ? 'Notified' : 'Pending'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </article>

        <article className="card">
          <h2>Roster</h2>
          {visibleStudents.length === 0 ? (
            <p className="muted">No students match that search.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Grade</th>
                  <th>Parent email</th>
                  <th>Today</th>
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map((student) => {
                  const scan = latest.get(student.id)
                  const mark = markFor(marks, student.id)
                  return (
                    <tr key={student.id}>
                      <td className="mono">{student.fingerprint_id}</td>
                      <td>
                        <span className="cell-person">
                          <Avatar student={student} size="sm" />
                          <strong>{fullName(student)}</strong>
                        </span>
                      </td>
                      <td>{student.grade_level}</td>
                      <td className="muted">{student.parent_email}</td>
                      <td>
                        <select
                          value={mark?.status ?? ''}
                          onChange={(event) => setMark(student, event.target.value)}
                          aria-label={`Today's status for ${fullName(student)}`}
                        >
                          <option value="">
                            {scan ? `By scan — ${scan.status}` : 'No scan yet'}
                          </option>
                          <option value="Present">Mark present</option>
                          <option value="Late">Mark late</option>
                          <option value="Absent">Mark absent</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </article>
      </div>
    </section>
  )
}
