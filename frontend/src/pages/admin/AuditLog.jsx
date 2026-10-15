import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import { formatTime } from '../../lib/format.js'
import { useApp } from '../../lib/useApp.js'

const RANGE_OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All', days: 0 },
]

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00`).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function durationOf(row) {
  if (!row.time_in) return '—'
  if (!row.time_out) return 'On the clock'
  const ms = new Date(row.time_out).getTime() - new Date(row.time_in).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const minutes = Math.round(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return `${hours}h ${String(rest).padStart(2, '0')}m`
}

function staffName(row, team) {
  if (row.staff?.full_name) return row.staff.full_name
  if (row.staff?.email) return row.staff.email
  const match = team.find((entry) => entry.id === row.staff_id)
  if (match) return match.full_name || match.email
  return 'Unknown staff'
}

function staffRole(row, team) {
  if (row.staff?.role) return row.staff.role
  return team.find((entry) => entry.id === row.staff_id)?.role ?? '—'
}

function actorLabel(log) {
  return log.actor_name || log.actor_email || 'System'
}

export default function AuditLog() {
  const { team } = useApp()
  const [audits, setAudits] = useState([])
  const [timeLogs, setTimeLogs] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('all')
  const [entity, setEntity] = useState('all')
  const [range, setRange] = useState(RANGE_OPTIONS[1])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [auditRows, timeRows] = await Promise.all([api.listAuditLogs(500), api.listStaffTimeLogs(1000)])
      setAudits(auditRows ?? [])
      setTimeLogs(timeRows ?? [])
    } catch (loadError) {
      setError(
        /audit_logs|staff_time_logs|relation/i.test(loadError.message)
          ? 'The audit tables are missing — run backend/schema.sql in Supabase Studio > SQL Editor, then reload.'
          : loadError.message,
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const cutoff = useMemo(() => {
    if (!range.days) return null
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (range.days - 1))
    return date
  }, [range])

  const needle = query.trim().toLowerCase()

  const visibleAudits = useMemo(
    () =>
      audits.filter((log) => {
        if (cutoff && new Date(log.created_at) < cutoff) return false
        if (action !== 'all' && log.action !== action) return false
        if (entity !== 'all' && log.entity_type !== entity) return false
        if (!needle) return true
        return [actorLabel(log), log.actor_email, log.actor_role, log.action, log.entity_type, log.summary]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      }),
    [audits, cutoff, action, entity, needle],
  )

  const visibleTime = useMemo(
    () =>
      timeLogs.filter((row) => {
        if (cutoff && new Date(row.time_in ?? row.created_at ?? row.work_date) < cutoff) return false
        if (!needle) return true
        return [staffName(row, team), staffRole(row, team), row.work_date]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      }),
    [timeLogs, cutoff, needle, team],
  )

  const actions = useMemo(() => [...new Set(audits.map((log) => log.action).filter(Boolean))].sort(), [audits])
  const entities = useMemo(
    () => [...new Set(audits.map((log) => log.entity_type).filter(Boolean))].sort(),
    [audits],
  )

  const todayStamp = new Date().toISOString().slice(0, 10)
  const activeToday = timeLogs.filter((row) => row.work_date === todayStamp && !row.time_out).length
  const hoursToday = timeLogs
    .filter((row) => row.work_date === todayStamp && row.time_in && row.time_out)
    .reduce((sum, row) => sum + (new Date(row.time_out).getTime() - new Date(row.time_in).getTime()), 0)

  function resetFilters() {
    setQuery('')
    setAction('all')
    setEntity('all')
    setRange(RANGE_OPTIONS[1])
    document.getElementById('audit-what-changed')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="page">
      <header className="page-head page-head-row">
        <div>
          <h1>Audit log</h1>
          <p className="page-sub">
            {error
              ? error
              : `${visibleAudits.length} change${visibleAudits.length === 1 ? '' : 's'} · ${visibleTime.length} usage session${visibleTime.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="page-head-actions">
          <div className="range-picker">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                className={`btn btn-quiet ${option.days === range.days ? 'is-on' : ''}`}
                onClick={() => setRange(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-quiet" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </header>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{audits.length}</span>
          <span className="stat-label">Changes tracked</span>
        </div>
        <div className="stat">
          <span className="stat-value">{timeLogs.length}</span>
          <span className="stat-label">Usage sessions</span>
        </div>
        <div className="stat">
          <span className="stat-value">{activeToday}</span>
          <span className="stat-label">Clocked in now</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {hoursToday > 0 ? `${(hoursToday / 3600000).toFixed(1)}h` : '—'}
          </span>
          <span className="stat-label">Hours logged today</span>
        </div>
      </div>

      <article className="card" style={{ marginBottom: '24px' }}>
        <h2>Filters</h2>
        <div className="roster-filters">
          <label className="roster-filter">
            Action
            <select value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="all">All actions</option>
              {actions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="roster-filter">
            Area
            <select value={entity} onChange={(event) => setEntity(event.target.value)}>
              <option value="all">All areas</option>
              {entities.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="search" style={{ marginBottom: 0 }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search staff, action, or summary"
            aria-label="Search audit log"
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </label>
      </article>

      <div className="panels panels-stacked">
        <article className="card">
          <h2>Staff usage time</h2>
          <p className="hint">Clock-in and clock-out sessions for teachers and admins, newest first.</p>
          {visibleTime.length === 0 ? (
            <p className="muted">{loading ? 'Loading…' : 'No usage sessions in this range.'}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Date</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {visibleTime.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{staffName(row, team)}</strong>
                      <em>{staffRole(row, team)}</em>
                    </td>
                    <td className="mono">{formatDate(row.work_date)}</td>
                    <td className="mono">{formatTime(row.time_in)}</td>
                    <td className="mono">{row.time_out ? formatTime(row.time_out) : '—'}</td>
                    <td>
                      <span className={`dot dot-${row.time_out ? 'present' : 'late'}`} />
                      {durationOf(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="card" id="audit-what-changed">
          <h2>What changed</h2>
          <p className="hint">Every roster, staff, mark, and rule change, plus sign-ins and resets.</p>
          {visibleAudits.length === 0 ? (
            <p className="muted">{loading ? 'Loading…' : 'No changes in this range.'}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Staff</th>
                  <th>Action</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {visibleAudits.map((log) => (
                  <tr key={log.id}>
                    <td className="mono">{formatDateTime(log.created_at)}</td>
                    <td>
                      <strong>{actorLabel(log)}</strong>
                      <em>{log.actor_role ?? ''}</em>
                    </td>
                    <td>
                      <span className="pill">{log.action}</span>
                      <em>{log.entity_type}</em>
                    </td>
                    <td>{log.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      </div>
    </section>
  )
}
