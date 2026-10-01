import { demo } from './demo.js'
import { isLive, supabase } from './config.js'
import { todayStamp } from './attendance.js'

export const mode = isLive ? 'live' : 'demo'

function unwrap(promise) {
  return promise.then(({ data, error }) => {
    if (error) throw new Error(error.message)
    return data
  })
}

export function startOfToday() {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.toISOString()
}

export const api = {
  async listStudents() {
    if (!isLive) return demo.listStudents()
    return unwrap(
      supabase.from('students').select('*').order('fingerprint_id', { ascending: true }),
    )
  },

  async addStudent(input) {
    if (!isLive) return demo.addStudent(input)
    const { data, error } = await supabase.from('students').insert(input).select().single()
    if (error) {
      throw new Error(
        error.code === '23505'
          ? `Fingerprint ID ${input.fingerprint_id} is already assigned.`
          : error.message,
      )
    }
    return data
  },

  async updateStudent(id, changes) {
    if (!isLive) return demo.updateStudent(id, changes)
    const { error } = await supabase.from('students').update(changes).eq('id', id)
    if (error) {
      throw new Error(
        error.code === '23505'
          ? `Fingerprint ID ${changes.fingerprint_id} is already assigned.`
          : error.message,
      )
    }
  },

  /** Cascades to that student's attendance rows, so warn before calling. */
  async removeStudent(id) {
    if (!isLive) return demo.removeStudent(id)
    const { error } = await supabase.from('students').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  async listAttendance() {
    if (!isLive) return demo.listAttendance(startOfToday())
    return unwrap(
      supabase
        .from('attendance_logs')
        .select('*, students(*)')
        .gte('scan_time', startOfToday())
        .order('scan_time', { ascending: false })
        .limit(500),
    )
  },

  async listAttendanceRange(fromIso, toIso) {
    if (!isLive) return demo.listAttendanceRange(fromIso, toIso)
    return unwrap(
      supabase
        .from('attendance_logs')
        .select('*, students(*)')
        .gte('scan_time', fromIso)
        .lte('scan_time', toIso)
        .order('scan_time', { ascending: false })
        .limit(5000),
    )
  },

  /** One row for the signed-out Scan Station: newest scan today + head count. */
  async kioskPulse() {
    if (!isLive) return demo.kioskPulse(startOfToday())
    const [row] = await unwrap(supabase.rpc('kiosk_pulse', { p_since: startOfToday() }))
    return row ?? null
  },

  /** When a class starts and how much slack it gets, or null for the .env default. */
  async getGradeSettings(grade) {
    if (!isLive) return demo.getGradeSettings(grade)
    const { data, error } = await supabase
      .from('grade_settings')
      .select('*')
      .eq('grade_level', grade)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data
  },

  async saveGradeSettings(grade, changes) {
    if (!isLive) return demo.saveGradeSettings(grade, changes)
    const { error } = await supabase
      .from('grade_settings')
      .upsert({ ...changes, grade_level: grade }, { onConflict: 'grade_level' })
    if (error) throw new Error(error.message)
  },

  /** Deletes the grade's scans since local midnight. Returns how many went. */
  async resetAttendance(grade) {
    if (!isLive) return demo.resetAttendance(grade, startOfToday())
    const { data, error } = await supabase.rpc('reset_grade_attendance', {
      p_grade: grade,
      p_since: startOfToday(),
    })
    if (error) throw new Error(error.message)
    return data
  },

  /**
   * Manually insert an attendance log for a student (teacher-triggered).
   * Returns the created row.
   */
  async markAttendance(studentId, status) {
    if (!isLive) {
      // Demo shim: insert a synthetic log row
      return demo.insertAttendance?.({ student_id: studentId, status, scan_time: new Date().toISOString(), parent_notified: false })
    }
    const { data, error } = await supabase
      .from('attendance_logs')
      .insert({ student_id: studentId, status, scan_time: new Date().toISOString(), parent_notified: false })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  /**
   * Call the notify-parent Edge Function to email the parent via Brevo
   * and flip parent_notified on the attendance log.
   *
   * @param {object} params
   * @param {string} params.logId       - attendance_logs.id
   * @param {object} params.student     - { first_name, last_name, grade_level, parent_email }
   * @param {string} params.status      - "Present" | "Late" | "Absent"
   * @param {string} params.scanTime    - ISO timestamp
   * @param {string} [params.markedBy]  - Teacher name (optional)
   */
  async notifyParent({ logId, student, status, scanTime, markedBy = '' }) {
    if (!isLive) {
      console.log('[demo] notifyParent skipped in demo mode')
      return { sent: false }
    }
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-parent`
    const resp = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        log_id: logId,
        student,
        status,
        scan_time: scanTime,
        marked_by: markedBy,
      }),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }))
      throw new Error(err.error ?? 'Failed to send parent notification')
    }
    return resp.json()
  },

  async getStatus() {
    if (!isLive) return demo.getStatus()
    const { data } = await supabase.from('backend_status').select('*').eq('id', 1).maybeSingle()
    return data
  },

  /** The teacher's manual attendance overrides for today. */
  async listMarks() {
    if (!isLive) return demo.listMarks()
    return unwrap(supabase.from('attendance_marks').select('*').eq('mark_date', todayStamp()))
  },

  async saveMark(studentId, status) {
    if (!isLive) return demo.saveMark(studentId, status)
    const { error } = await supabase.from('attendance_marks').upsert(
      {
        student_id: studentId,
        mark_date: todayStamp(),
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,mark_date' },
    )
    if (error) throw new Error(error.message)
  },

  async clearMark(studentId) {
    if (!isLive) return demo.clearMark(studentId)
    const { error } = await supabase
      .from('attendance_marks')
      .delete()
      .eq('student_id', studentId)
      .eq('mark_date', todayStamp())
    if (error) throw new Error(error.message)
  },

  async listStaff() {
    if (!isLive) return demo.listStaff()
    return unwrap(supabase.from('staff_profiles').select('*').order('created_at', { ascending: true }))
  },

  async myStaffProfile() {
    if (!isLive) return demo.myStaffProfile()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('staff_profiles')
      .select('*')
      .eq('auth_id', user.id)
      .maybeSingle()
    return data
  },

  async addStaff(input) {
    if (!isLive) return demo.addStaff(input)
    const { data, error } = await supabase
      .from('staff_profiles')
      .insert({ ...input, status: 'pending' })
      .select()
      .single()
    if (error) {
      throw new Error(
        error.code === '23505'
          ? `${input.email} is already on the staff list.`
          : error.message,
      )
    }
    return data
  },

  async updateStaff(id, changes) {
    if (!isLive) return demo.updateStaff(id, changes)
    const { error } = await supabase.from('staff_profiles').update(changes).eq('id', id)
    if (error) throw new Error(error.message)
  },

  async removeStaff(id) {
    if (!isLive) return demo.removeStaff(id)
    const { error } = await supabase.from('staff_profiles').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  /** Whether the register screen may create another account. */
  async registrationOpen() {
    if (!isLive) return true
    const { data, error } = await supabase.rpc('registration_open')
    if (error) throw new Error(error.message)
    return Boolean(data)
  },

  /** Clock the signed-in staff member in for today. */
  async timeIn() {
    if (!isLive) return demo.timeIn()
    const { data, error } = await supabase.rpc('time_in')
    if (error) throw new Error(error.message)
    return data
  },

  /** Clock the signed-in staff member out for today. */
  async timeOut() {
    if (!isLive) return demo.timeOut()
    const { data, error } = await supabase.rpc('time_out')
    if (error) throw new Error(error.message)
    return data
  },

  /** The signed-in staff member's time row for today, or null before they clock in. */
  async getMyTimeStatus() {
    if (!isLive) return demo.getMyTimeStatus()
    const { data, error } = await supabase.rpc('my_time_status')
    if (error) throw new Error(error.message)
    return data
  },

  /** Set the maximum session hours for a staff member. */
  async setMaxSessionHours(staffId, hours) {
    if (!isLive) return demo.setMaxSessionHours(staffId, hours)
    const { data, error } = await supabase.rpc('set_max_session_hours', {
      p_staff_id: staffId,
      p_hours: hours,
    })
    if (error) throw new Error(error.message)
    return data
  },

  /** Claims an admin row for the account that just registered. */
  async claimAdminProfile(fullName) {
    if (!isLive) return demo.addStaff({ full_name: fullName, email: 'admin@school.example', role: 'admin', grade_level: null })
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Sign in before claiming the admin account.')

    const { error } = await supabase.from('staff_profiles').insert({
      auth_id: user.id,
      email: user.email,
      full_name: fullName,
      role: 'admin',
      status: 'active',
    })
    if (error) {
      throw new Error(
        error.code === '23505'
          ? 'That email is already on the staff list.'
          : 'Self-registration is closed right now, so this account was not added. An admin can add you from the Staff page.',
      )
    }
  },

  /** Queues a sensor capture; the Python service performs it and fills in the slot. */
  async startCapture(fingerprintId) {
    if (!isLive) return demo.startCapture(fingerprintId)
    const { data, error } = await supabase
      .from('fingerprint_captures')
      .insert({ status: 'pending', target_slot: fingerprintId ?? null })
      .select()
      .single()
    if (error) {
      throw new Error(
        error.message.includes('fingerprint_captures')
          ? 'The capture table is missing — re-run backend/schema.sql.'
          : error.message,
      )
    }
    return data
  },

  /** Queues removal of a stale template (after a transfer); the Python service clears it on the sensor. */
  async queueClear(fingerprintId) {
    if (!isLive) return demo.queueClear(fingerprintId)
    const { data, error } = await supabase
      .from('fingerprint_captures')
      .insert({ status: 'pending', target_slot: fingerprintId, action: 'delete' })
      .select()
      .single()
    if (error) {
      throw new Error(
        error.message.includes('fingerprint_captures')
          ? 'The capture table is missing — re-run backend/schema.sql.'
          : error.message,
      )
    }
    return data
  },

  async getCapture(id) {
    if (!isLive) return demo.getCapture(id)
    const { data } = await supabase.from('fingerprint_captures').select('*').eq('id', id).maybeSingle()
    return data
  },

  /** Stage updates push over realtime so the enroll modal reacts at once; polling stays as the backstop. */
  subscribeCaptures(onChange) {
    if (!isLive) return () => {}
    const channel = supabase
      .channel('capture-feed')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'fingerprint_captures' },
        onChange,
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  },

  /** Fires whenever attendance, roster or staff data may have changed. */
  subscribe(onChange) {
    if (!isLive) return demo.subscribe(onChange)
    const channel = supabase
      .channel('attendance-feed')
      .on(
        'postgres_changes',
        // Updates too: the backend inserts the scan with parent_notified=false
        // and flips it a moment later, which is its own event.
        { event: '*', schema: 'public', table: 'attendance_logs' },
        onChange,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_profiles' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_marks' }, onChange)
      .subscribe()
    return () => supabase.removeChannel(channel)
  },

  /** Demo-only: pretends the Arduino reported a fingerprint. */
  async simulateScan(fingerprintId) {
    if (isLive) throw new Error('Scans come from the Arduino in live mode.')
    return demo.simulateScan(fingerprintId)
  },
}
