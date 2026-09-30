import { studentFor } from './format.js'

/** Local calendar day as YYYY-MM-DD, the shape of the mark_date column. */
export function todayStamp() {
  return new Date().toLocaleDateString('en-CA')
}

/** Newest log per student; listAttendance already returns newest first. */
export function latestByStudent(logs) {
  const seen = new Map()
  for (const log of logs) if (!seen.has(log.student_id)) seen.set(log.student_id, log)
  return seen
}

export function markFor(marks, studentId) {
  return marks?.find((mark) => mark.student_id === studentId) ?? null
}

/** The teacher's mark outranks the scan; no mark and no scan means absent. */
function statusOf(student, latest, marks) {
  return markFor(marks, student.id)?.status ?? latest.get(student.id)?.status
}

export function summarize(students, logs, marks = []) {
  const latest = latestByStudent(logs)
  let present = 0
  let late = 0
  for (const student of students) {
    const status = statusOf(student, latest, marks)
    if (status === 'Late') late += 1
    else if (status === 'Present') present += 1
  }
  const enrolled = students.length
  return { enrolled, present, late, absent: Math.max(enrolled - present - late, 0) }
}

export function rosterWithStatus(students, logs, marks = []) {
  const latest = latestByStudent(logs)
  return students.map((student) => ({
    student,
    log: latest.get(student.id) ?? null,
    mark: markFor(marks, student.id),
  }))
}

export function byGrade(students, logs, marks = []) {
  const groups = new Map()
  for (const student of students) {
    const grade = student.grade_level || 'Unassigned'
    if (!groups.has(grade)) groups.set(grade, [])
    groups.get(grade).push(student)
  }
  return [...groups.entries()]
    .map(([grade, roster]) => ({ grade, ...summarize(roster, logs, marks), roster }))
    .sort((a, b) => a.grade.localeCompare(b.grade))
}

/** Realtime rows carry only an id, so resolve the profile from the roster. */
export function recentScans(logs, students, limit = 8) {
  return logs.slice(0, limit).map((log) => ({ log, student: studentFor(log, students) }))
}
