import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarList, ColumnChart, StackedBar } from '../../components/charts.jsx'
import { api } from '../../lib/api.js'
import { latestByStudent, summarize } from '../../lib/attendance.js'
import { useApp } from '../../lib/useApp.js'

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
]

function dayKey(date) {
  return new Date(date).toDateString()
}

function buildDays(logs, students, days) {
  const buckets = []
  const today = new Date()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    date.setHours(0, 0, 0, 0)
    buckets.push({
      date: date.toISOString(),
      label: date.toLocaleDateString([], { day: 'numeric' }),
      full: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      match: date.toDateString(),
      present: 0,
      late: 0,
      absent: 0,
    })
  }

  const byDay = new Map(buckets.map((bucket) => [bucket.match, []]))
  for (const log of logs) {
    const list = byDay.get(dayKey(log.scan_time))
    if (list) list.push(log)
  }

  for (const bucket of buckets) {
    const dayLogs = byDay.get(bucket.match) ?? []
    const latest = latestByStudent(dayLogs)
    let present = 0
    let late = 0
    for (const student of students) {
      const status = latest.get(student.id)?.status
      if (status === 'Late') late += 1
      else if (status) present += 1
    }
    bucket.present = present
    bucket.late = late
    bucket.absent = Math.max(students.length - present - late, 0)
    bucket.total = present + late
  }

  return buckets
}

export default function Reports() {
  const { students, team, logs } = useApp()
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
  // `logs` is today only; `ranged` spans the picker. Do not mix them up.
  const today = summarize(students, logs)

  const perGrade = useMemo(() => {
    const counts = new Map()
    for (const student of students) {
      counts.set(student.grade_level, (counts.get(student.grade_level) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [students])

  const teachersByClass = useMemo(() => {
    const counts = new Map()
    for (const student of students) {
      counts.set(student.grade_level, (counts.get(student.grade_level) ?? 0) + 1)
    }
    return team
      .filter((row) => row.role === 'teacher')
      .map((row) => ({
        label: `${row.full_name.split(' ')[0]} · ${row.grade_level ?? 'unassigned'}`,
        value: row.grade_level ? (counts.get(row.grade_level) ?? 0) : 0,
      }))
      .sort((a, b) => b.value - a.value)
  }, [team, students])

  const notified = ranged.filter((log) => log.parent_notified).length

  return (
    <section className="page">
      <header className="page-head page-head-row">
        <div>
          <h1>Reports</h1>
          <p className="page-sub">
            {error ? error : `${ranged.length} scans across the last ${range.days} days`}
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
            Only actual scans are plotted. Absences are flat by definition — every student who does
            not scan is absent — so they are reported in the split instead.
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
            Counts are capped at one scan per student, so a re-scan does not inflate the class.
          </p>
        </article>

        <article className="card">
          <h2>Students per grade</h2>
          <BarList items={perGrade} />
        </article>

        <article className="card">
          <h2>Professors by class size</h2>
          <BarList items={teachersByClass} />
        </article>

        <article className="card">
          <h2>Parent notifications</h2>
          <StackedBar
            segments={[
              { label: 'Sent', value: notified, tone: 'present' },
              { label: 'Not sent', value: ranged.length - notified, tone: 'absent' },
            ]}
          />
          <p className="hint">
            Emails are off unless the backend has a Brevo key and EMAIL_PROVIDER is not set to off.
            A failed send is recorded as “not sent”, not as a separate failure state.
          </p>
        </article>
      </div>
    </section>
  )
}
