/**
 * Browser-resident stand-in for Supabase + the Python backend, used until
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are filled in.
 */

import { todayStamp } from './attendance.js'

const KEY = 'smartattendance.demo.v1'

const SEED_STUDENTS = [
  {
    fingerprint_id: 1,
    student_number: '2026-0148',
    first_name: 'Amara',
    last_name: 'Okafor',
    grade_level: '1st Year',
    section: 'A',
    parent_email: 'parent.amara@example.com',
    teacher_id: 'staff-teacher',
  },
  {
    fingerprint_id: 2,
    student_number: '2026-0149',
    first_name: 'Daniel',
    last_name: 'Reyes',
    grade_level: '2nd Year',
    section: 'A',
    parent_email: 'parent.daniel@example.com',
    teacher_id: 'staff-teacher',
  },
  {
    fingerprint_id: 3,
    first_name: 'Mei',
    last_name: 'Tan',
    grade_level: '1st Year',
    section: 'B',
    parent_email: 'parent.mei@example.com',
    teacher_id: null,
  },
]

function createStore() {
  let state = load()
  const listeners = new Set()
  const captures = new Map()
  let channel

  try {
    channel = 'BroadcastChannel' in window ? new BroadcastChannel('smartattendance') : null
  } catch {
    channel = null
  }

  channel?.addEventListener('message', () => {
    state = load()
    listeners.forEach((fn) => fn())
  })

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (parsed?.students) {
        parsed.staff = parsed.staff ?? []
        parsed.staff = parsed.staff.map((row) => ({
          ...row,
          grade_level: row.grade_level ?? row.grade_levels?.[0] ?? null,
          grades: row.grades ?? (row.grade_level ? [row.grade_level] : []),
          sections: row.sections ?? [],
        }))
        parsed.nextStaffId = parsed.nextStaffId ?? 1
        parsed.grade_settings = parsed.grade_settings ?? []
        parsed.marks = parsed.marks ?? []
        parsed.timeLogs = parsed.timeLogs ?? []
        return parsed
      }
    } catch {
      /* corrupt entry below is replaced by a fresh seed */
    }
    const created = {
      students: [],
      logs: [],
      nextLogId: 1,
      staff: [],
      nextStaffId: 1,
      grade_settings: [],
      marks: [],
      timeLogs: [],
    }
    localStorage.setItem(KEY, JSON.stringify(created))
    return created
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state))
    listeners.forEach((fn) => fn())
    channel?.postMessage('changed')
  }

  function withStudent(log) {
    const student = state.students.find((s) => s.id === log.student_id) || null
    return { ...log, students: student }
  }

  if (state.students.length === 0) {
    state.students = SEED_STUDENTS.map((seed, index) => ({
      id: `demo-${index + 1}`,
      created_at: new Date().toISOString(),
      ...seed,
    }))
    save()
  }

  if (state.staff.length === 0) {
    state.staff = [
      {
        id: 'staff-admin',
        email: 'admin@school.example',
        full_name: 'Demo Admin',
        role: 'admin',
        grade_level: null,
        grades: [],
        sections: [],
        status: 'active',
        temp_password: null,
        max_session_hours: 8,
      },
      {
        id: 'staff-teacher',
        email: 'teacher@school.example',
        full_name: 'Demo Teacher',
        role: 'teacher',
        // Two grades and two sections, so both lists are visible in the demo.
        grade_level: '1st Year',
        grades: ['1st Year', '2nd Year'],
        sections: ['A', 'B'],
        status: 'active',
        temp_password: null,
        max_session_hours: 8,
      },
    ]
    save()
  }

  return {
    async listStudents() {
      return [...state.students].sort((a, b) => a.fingerprint_id - b.fingerprint_id)
    },
    async addStudent(input) {
      if (state.students.some((s) => s.fingerprint_id === input.fingerprint_id)) {
        throw new Error(`Fingerprint ID ${input.fingerprint_id} is already assigned.`)
      }
      const number = (input.student_number ?? '').trim()
      if (number && state.students.some((s) => (s.student_number ?? '').trim() === number)) {
        throw new Error(`Student ID ${number} is already taken.`)
      }
      const student = {
        id: `demo-${crypto.randomUUID()}`,
        created_at: new Date().toISOString(),
        ...input,
      }
      state.students.push(student)
      save()
      return student
    },
    async updateStudent(id, changes) {
      if (
        state.students.some(
          (s) => s.id !== id && changes.fingerprint_id != null && s.fingerprint_id === changes.fingerprint_id,
        )
      ) {
        throw new Error(`Fingerprint ID ${changes.fingerprint_id} is already assigned.`)
      }
      const number = (changes.student_number ?? '').trim()
      if (number && state.students.some((s) => s.id !== id && (s.student_number ?? '').trim() === number)) {
        throw new Error(`Student ID ${number} is already taken.`)
      }
      state.students = state.students.map((student) =>
        student.id === id ? { ...student, ...changes } : student,
      )
      save()
    },
    async removeStudent(id) {
      state.students = state.students.filter((student) => student.id !== id)
      state.logs = state.logs.filter((log) => log.student_id !== id)
      save()
    },
    async listAttendance(sinceIso) {
      return state.logs
        .filter((log) => log.scan_time >= sinceIso)
        .map(withStudent)
        .sort((a, b) => b.scan_time.localeCompare(a.scan_time))
    },
    async listAttendanceRange(fromIso, toIso) {
      return state.logs
        .filter((log) => log.scan_time >= fromIso && log.scan_time <= toIso)
        .map(withStudent)
        .sort((a, b) => b.scan_time.localeCompare(a.scan_time))
    },
    async kioskPulse(sinceIso) {
      const today = state.logs.filter((log) => log.scan_time >= sinceIso)
      const newest = [...today].sort((a, b) => b.scan_time.localeCompare(a.scan_time))[0] ?? null
      const student = newest ? (state.students.find((row) => row.id === newest.student_id) ?? null) : null
      return {
        log_id: newest?.id ?? null,
        first_name: student?.first_name ?? null,
        last_name: student?.last_name ?? null,
        grade_level: student?.grade_level ?? null,
        status: newest?.status ?? null,
        scan_time: newest?.scan_time ?? null,
        parent_notified: newest?.parent_notified ?? false,
        checked_in: new Set(today.map((log) => log.student_id)).size,
      }
    },
    async getStatus() {
      return {
        id: 1,
        connected: false,
        port: null,
        last_heartbeat: null,
        scans_today: state.logs.filter((log) => isToday(log.scan_time)).length,
        message: 'Demo mode — Python backend not running',
      }
    },
    async getGradeSettings(grade) {
      return state.grade_settings.find((row) => row.grade_level === grade) ?? null
    },
    async saveGradeSettings(grade, changes) {
      const existing = state.grade_settings.find((row) => row.grade_level === grade)
      const row = { ...existing, ...changes, grade_level: grade, updated_at: new Date().toISOString() }
      state.grade_settings = existing
        ? state.grade_settings.map((r) => (r.grade_level === grade ? row : r))
        : [...state.grade_settings, row]
      save()
      return row
    },
    async listMarks() {
      const today = todayStamp()
      return state.marks.filter((mark) => mark.mark_date === today)
    },
    async saveMark(studentId, status) {
      const today = todayStamp()
      const existing = state.marks.find((m) => m.student_id === studentId && m.mark_date === today)
      if (existing) {
        existing.status = status
        existing.updated_at = new Date().toISOString()
      } else {
        state.marks.push({
          id: `mark-${crypto.randomUUID()}`,
          student_id: studentId,
          mark_date: today,
          status,
          updated_at: new Date().toISOString(),
        })
      }
      save()
    },
    async clearMark(studentId) {
      const today = todayStamp()
      state.marks = state.marks.filter((m) => !(m.student_id === studentId && m.mark_date === today))
      save()
    },
    async resetAttendance(grade, sinceIso) {
      const inGrade = new Set(
        state.students.filter((student) => student.grade_level === grade).map((student) => student.id),
      )
      const before = state.logs.length
      state.logs = state.logs.filter((log) => !(inGrade.has(log.student_id) && log.scan_time >= sinceIso))
      save()
      return before - state.logs.length
    },
    /** Mirrors what backend/service.py does on a real scan. */
    async simulateScan(fingerprintId) {
      const student = state.students.find((s) => s.fingerprint_id === Number(fingerprintId))
      if (!student) return { error: `Fingerprint ID ${fingerprintId} is not enrolled.` }

      const now = new Date()
      const rule = state.grade_settings.find((row) => row.grade_level === student.grade_level)
      const [startHour, startMinute] = (rule?.school_start ?? '08:00').split(':')
      const lateCutoff = new Date(now)
      lateCutoff.setHours(Number(startHour), Number(startMinute) + (rule?.late_grace_minutes ?? 15), 0, 0)
      const log = {
        id: `log-${state.nextLogId++}`,
        student_id: student.id,
        scan_time: now.toISOString(),
        status: now > lateCutoff ? 'Late' : 'Present',
        parent_notified: true,
        simulated: true,
      }
      state.logs.push(log)
      save()
      return { log: withStudent(log), student }
    },
    async listStaff() {
      return [...state.staff]
    },
    async myStaffProfile() {
      return (
        state.staff.find((row) => row.role === demoRole()) ??
        state.staff.find((row) => row.role === 'admin') ??
        state.staff[0] ??
        null
      )
    },
    async addStaff(input) {
      if (state.staff.some((row) => row.email.toLowerCase() === input.email.toLowerCase())) {
        throw new Error(`${input.email} is already on the staff list.`)
      }
      // Stands in for the Python poller, which cannot run without Supabase.
      const { temp_password: chosen, ...rest } = input
      const row = {
        id: `staff-${state.nextStaffId++}`,
        status: 'active',
        temp_password: chosen || 'demo-pass-123',
        error: null,
        created_at: new Date().toISOString(),
        ...rest,
      }
      state.staff.push(row)
      save()
      return row
    },
    async updateStaff(id, changes) {
      state.staff = state.staff.map((row) => (row.id === id ? { ...row, ...changes } : row))
      save()
    },
    async removeStaff(id) {
      state.staff = state.staff.filter((row) => row.id !== id)
      save()
    },
    async timeIn() {
      const me =
        state.staff.find((row) => row.role === demoRole()) ??
        state.staff.find((row) => row.role === 'admin') ??
        state.staff[0]
      if (!me) throw new Error('No staff profile found in demo mode.')
      const today = todayStamp()
      const existing = state.timeLogs?.find((log) => log.staff_id === me.id && log.work_date === today)
      if (existing) return existing
      const row = {
        id: `time-${crypto.randomUUID()}`,
        staff_id: me.id,
        work_date: today,
        time_in: new Date().toISOString(),
        time_out: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      state.timeLogs = state.timeLogs ?? []
      state.timeLogs.push(row)
      save()
      return row
    },
    async timeOut() {
      const me =
        state.staff.find((row) => row.role === demoRole()) ??
        state.staff.find((row) => row.role === 'admin') ??
        state.staff[0]
      if (!me) throw new Error('No staff profile found in demo mode.')
      const today = todayStamp()
      const row = state.timeLogs?.find(
        (log) => log.staff_id === me.id && log.work_date === today && !log.time_out,
      )
      if (!row) return null
      row.time_out = new Date().toISOString()
      row.updated_at = new Date().toISOString()
      save()
      return row
    },
    async getMyTimeStatus() {
      const me =
        state.staff.find((row) => row.role === demoRole()) ??
        state.staff.find((row) => row.role === 'admin') ??
        state.staff[0]
      if (!me) return null
      const today = todayStamp()
      return state.timeLogs?.find((log) => log.staff_id === me.id && log.work_date === today) ?? null
    },
    async setMaxSessionHours(staffId, hours) {
      const row = state.staff.find((s) => s.id === staffId)
      if (!row) throw new Error('Staff member not found.')
      row.max_session_hours = hours
      row.updated_at = new Date().toISOString()
      save()
      return row
    },
    /** Stands in for the USB scanner: three presses of one finger, then a merge. */
    startCapture(requestedId) {
      let slot = Number(requestedId) || 0
      if (!slot) {
        const taken = new Set(state.students.map((student) => student.fingerprint_id))
        slot = 1
        while (taken.has(slot)) slot += 1
      }
      const capture = { id: crypto.randomUUID(), status: 'capturing', fingerprint_id: null, step: 'place_1' }
      captures.set(capture.id, capture)
      setTimeout(() => {
        capture.step = 'place_2'
      }, 1600)
      setTimeout(() => {
        capture.step = 'place_3'
      }, 3200)
      setTimeout(() => {
        capture.step = 'merge'
      }, 4600)
      setTimeout(() => {
        capture.status = 'done'
        capture.fingerprint_id = slot
        capture.step = null
      }, 5400)
      return capture
    },
    getCapture(id) {
      return captures.get(id) ?? null
    },
    queueClear(slot) {
      const capture = {
        id: crypto.randomUUID(),
        status: 'capturing',
        fingerprint_id: null,
        action: 'delete',
        target_slot: Number(slot),
      }
      captures.set(capture.id, capture)
      setTimeout(() => {
        capture.status = 'done'
      }, 1200)
      return capture
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

function isToday(iso) {
  const date = new Date(iso)
  const today = new Date()
  return date.toDateString() === today.toDateString()
}

export const demo = createStore()

/**
 * Demo-only role switch: the kiosk is teacher-only, so without this the
 * teacher screens could never be viewed without a real login. Set it in the
 * console with
 *   localStorage.setItem('smartattendance.demo.v1.role', 'teacher')
 * then reload.
 */
export function demoRole() {
  try {
    return localStorage.getItem(`${KEY}.role`) === 'teacher' ? 'teacher' : 'admin'
  } catch {
    return 'admin'
  }
}
