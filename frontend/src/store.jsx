import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, mode } from './lib/api.js'
import { demoRole } from './lib/demo.js'
import { getCurrentUser, signOut as endSession, watchAuth } from './lib/auth.js'
import { AppContext } from './lib/useApp.js'

const HEARTBEAT_STALE_SECONDS = 20
// Backstop for changes the realtime socket silently misses; half the backend's
// 5s heartbeat so even a dead socket lags by at most a couple of seconds.
const STATUS_POLL_MS = 2500

function describeBackend(status) {
  if (status?.connected) {
    const beat = status.last_heartbeat ? new Date(status.last_heartbeat).getTime() : 0
    const fresh = Date.now() - beat < HEARTBEAT_STALE_SECONDS * 1000
    return {
      state: fresh ? 'online' : 'stale',
      label: fresh ? 'Arduino connected' : 'Backend silent',
      detail: status.message || status.port || '',
    }
  }
  if (mode === 'demo') {
    return {
      state: 'demo',
      label: 'Demo mode',
      detail: 'Simulated scans only — add Supabase keys and start the Python backend to go live',
    }
  }
  return {
    state: 'offline',
    label: 'Backend offline',
    detail: status?.message || 'Python service is not reporting',
  }
}

export function AppProvider({ children }) {
  const [students, setStudents] = useState([])
  const [logs, setLogs] = useState([])
  const [marks, setMarks] = useState([])
  const [backend, setBackend] = useState(() => describeBackend(null))
  const [user, setUser] = useState(null)
  const [staff, setStaff] = useState(null)
  const [team, setTeam] = useState([])
  const [registrationOpen, setRegistrationOpen] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [timeRemaining, setTimeRemaining] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [roster, today] = await Promise.all([api.listStudents(), api.listAttendance()])
      setStudents(roster ?? [])
      setLogs(today ?? [])
      setLoadError('')
      // A missing marks table must not take the roster down with it.
      setMarks(await api.listMarks().catch(() => []))
    } catch (error) {
      setLoadError(error.message)
    }
  }, [])

  const refreshStaff = useCallback(async () => {
    // null means we could not tell, which the register screen treats as closed
    setRegistrationOpen(await api.registrationOpen().catch(() => null))
    try {
      const me = await api.myStaffProfile()
      setStaff(me ?? null)
      setTeam(me?.role === 'admin' ? ((await api.listStaff()) ?? []) : [])
    } catch {
      setStaff(null)
      setTeam([])
    }
  }, [])

  useEffect(() => {
    const onChange = () => {
      refresh()
      refreshStaff()
    }
    onChange()
    return api.subscribe(onChange)
  }, [refresh, refreshStaff])

  useEffect(() => {
    const poll = async () => setBackend(describeBackend(await api.getStatus().catch(() => null)))
    poll()
    // Realtime is the fast path; this reconciles anything it silently missed —
    // a dropped socket, a backgrounded tab, a laptop that fell asleep.
    const timer = setInterval(() => {
      poll()
      refresh()
    }, STATUS_POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (mode !== 'live') return undefined
    getCurrentUser().then(setUser)
    return watchAuth((next) => {
      setUser(next)
      refreshStaff()
    })
  }, [refreshStaff])

  const signOut = useCallback(async () => {
    await endSession()
    setUser(null)
    setStaff(null)
    setTimeRemaining(null)
    // Drop the roster too, so a signed-out screen can never render class data
    // left over in memory from the previous session.
    setStudents([])
    setLogs([])
    setMarks([])
    setTeam([])
    // The Scan Station is the signed-out face of the app, so signing out from
    // any role lands back on it instead of the login form.
    window.location.hash = '#/kiosk'
  }, [])

  // Auto-start the countdown when a staff member signs in
  useEffect(() => {
    if (staff?.status === 'active' && timeRemaining === null) {
      const hours = staff.max_session_hours ?? 8
      setTimeRemaining(hours * 3600)
    }
  }, [staff?.status, staff?.max_session_hours, timeRemaining === null])

  // Countdown timer: ticks every second, auto-logs out at zero
  useEffect(() => {
    if (timeRemaining === null || timeRemaining <= 0) return undefined
    const timer = setInterval(() => {
      setTimeRemaining((prev) => (prev === null ? null : Math.max(prev - 1, 0)))
    }, 1000)
    return () => clearInterval(timer)
  }, [timeRemaining === null])

  // Auto-logout when the countdown reaches zero — redirects to the attendance page
  useEffect(() => {
    if (timeRemaining === 0) {
      endSession()
      setUser(null)
      setStaff(null)
      setTimeRemaining(null)
      setStudents([])
      setLogs([])
      setMarks([])
      setTeam([])
      window.location.hash = '#/attendance'
    }
  }, [timeRemaining])

  // public = signed out, pending/failed = a login with no usable staff row
  const access = useMemo(() => {
    if (mode === 'demo') return demoRole()
    if (!user) return 'public'
    if (!staff) return 'pending'
    if (staff.status === 'active') return staff.role
    return staff.status
  }, [user, staff])

  const setMaxSessionHours = useCallback(async (staffId, hours) => {
    const row = await api.setMaxSessionHours(staffId, hours)
    if (staffId === staff?.id) {
      setStaff(row)
    }
    setTeam((prev) => prev.map((r) => (r.id === staffId ? row : r)))
  }, [staff?.id])

  const value = useMemo(
    () => ({
      mode,
      students,
      logs,
      marks,
      backend,
      loadError,
      user,
      staff,
      team,
      access,
      registrationOpen,
      timeRemaining,
      refresh,
      refreshStaff,
      signOut,
      setMaxSessionHours,
      simulateScan: api.simulateScan,
    }),
    [students, logs, marks, backend, loadError, user, staff, team, access, registrationOpen, timeRemaining, refresh, refreshStaff, signOut, setMaxSessionHours],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
