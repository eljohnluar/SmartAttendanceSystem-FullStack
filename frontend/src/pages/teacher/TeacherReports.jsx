import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarList, ColumnChart, StackedBar } from '../../components/charts.jsx'
import { api } from '../../lib/api.js'
import { summarize } from '../../lib/attendance.js'
import { RANGES, buildDays, notificationSplit } from '../../lib/reporting.js'
import { useApp } from '../../lib/useApp.js'

export default function TeacherReports() {
  const { students, logs, marks } = useApp()
  const [range, setRange] = useState(RANGES[0])
  const [ranged, setRanged] = useState([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - (range.days - 1))
    try {
      setRanged(await api.listAttendanceRange(from.toISOString(), new Date().toISOString()))
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    }
  }, [range])

  useEffect(() => {
    load()
  }, [load])

  const days = useMemo(() => buildDays(ranged, students, range.days), [ranged, students, range])
  const today = summarize(students, logs, marks)
  const { sent, pending } = notificationSplit(ranged)

  const perClass = useMemo(() => {
    const counts = new Map()
    for (const student of students) {
      const label = `${student.grade_level || 'Unassigned'}${student.section ? ` · ${student.section}` : ''}`
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [students])

  return (
    <section className="page">
      <header className="page-head page-head-row">
        <div>
          <h1>Reports</h1>
          <p className="page-sub">
            {error ? error : `${ranged.length} scans across the last ${range.days} days`} · your classes only
          </p>
        </div>
        <div className="range-picker">
          {RANGES.map((option) => (
            <button
              key={option.days}
              type="button"
              className={`btn btn-quiet ${option.days === range.days ? 'is-on' : ''}`}
              onClick={() => setRange(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className="report-grid">
        <article className="card">
          <h2>Arrivals by day</h2>
          <ColumnChart
            days={days}
            keys={[
              { name: 'present', label: 'On time', tone: 'present' },
              { name: 'late', label: 'Late', tone: 'late' },
            ]}
          />
          <p className="hint">
            Only actual scans are plotted. Absences are flat by definition — every student who does not scan
            is absent — so they are reported in the split instead.
          </p>
        </article>

        <article className="card">
          <h2>Today’s split</h2>
          <StackedBar
            segments={[
              { label: 'Present', value: today.present, tone: 'present' },
              { label: 'Late', value: today.late, tone: 'late' },
              { label: 'Absent', value: today.absent, tone: 'absent' },
            ]}
          />
          <p className="hint">
            A status you set on the Attendance page counts ahead of the scan, and a re-scan never counts
            twice.
          </p>
        </article>

        <article className="card">
          <h2>Students per class</h2>
          <BarList items={perClass} />
        </article>

        <article className="card">
          <h2>Parent notifications</h2>
          <StackedBar
            segments={[
              { label: 'Sent', value: sent, tone: 'present' },
              { label: 'Not sent', value: pending, tone: 'absent' },
            ]}
          />
          <p className="hint">
            A parent is emailed when their child is marked present or late. A send that fails is recorded as
            “not sent”, not as a separate failure state.
          </p>
        </article>
      </div>
    </section>
  )
}
