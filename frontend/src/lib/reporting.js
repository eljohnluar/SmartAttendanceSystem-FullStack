import { latestByStudent } from './attendance.js'

export const RANGES = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
]

function dayKey(date) {
  return new Date(date).toDateString()
}

/**
 * One bucket per calendar day, newest last, counting at most one status per
 * student so a re-scan cannot inflate a class.
 */
export function buildDays(logs, students, days) {
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

/** Scans in `logs` whose parent was emailed, and those still waiting. */
export function notificationSplit(logs) {
  const sent = logs.filter((log) => log.parent_notified).length
  return { sent, pending: logs.length - sent }
}
