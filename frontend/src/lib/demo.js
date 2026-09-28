/**
 * Browser-resident stand-in for Supabase + the Python backend, used until
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are filled in.
 */

const KEY = 'smartattendance.demo.v1'

const SEED_STUDENTS = [
  { fingerprint_id: 1, first_name: 'Amara', last_name: 'Okafor', grade_level: 'Grade 5', parent_email: 'parent.amara@example.com' },
  { fingerprint_id: 2, first_name: 'Daniel', last_name: 'Reyes', grade_level: 'Grade 6', parent_email: 'parent.daniel@example.com' },
  { fingerprint_id: 3, first_name: 'Mei', last_name: 'Tan', grade_level: 'Grade 5', parent_email: 'parent.mei@example.com' },
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
        parsed.nextStaffId = parsed.nextStaffId ?? 1
        parsed.grade_settings = parsed.grade_settings ?? []
        return parsed
      }
    } catch {
      /* corrupt entry below is replaced by a fresh seed */
    }
    const created = { students: [], logs: [], nextLogId: 1, staff: [], nextStaffId: 1, grade_settings: [] }
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
        status: 'active',
        temp_password: null,
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
    async resetAttendance(grade, sinceIso) {
      const inGrade = new Set(
        state.students.filter((student) => student.grade_level === grade).map((student) => student.id),
      )
      const before = state.logs.length
      state.logs = state.logs.filter(
        (log) => !(inGrade.has(log.student_id) && log.scan_time >= sinceIso),
      )
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
      lateCutoff.setHours(
        Number(startHour),
        Number(startMinute) + (rule?.late_grace_minutes ?? 15),
        0,
        0,
      )
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
      return state.staff.find((row) => row.role === 'admin') ?? state.staff[0] ?? null
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
    /** Stands in for the sensor: honours a requested slot, else the next free one. */
    startCapture(requestedSlot) {
      let slot = Number(requestedSlot) || 0
      if (!slot) {
        const taken = new Set(state.students.map((student) => student.fingerprint_id))
        slot = 1
        while (taken.has(slot)) slot += 1
      }
      const capture = { id: crypto.randomUUID(), status: 'capturing', fingerprint_id: null }
      captures.set(capture.id, capture)
      setTimeout(() => {
        capture.status = 'done'
        capture.fingerprint_id = slot
      }, 1800)
      return capture
    },
    getCapture(id) {
      return captures.get(id) ?? null
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
