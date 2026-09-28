import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, mode } from './lib/api.js'
import { demoRole } from './lib/demo.js'
import { getCurrentUser, signOut as endSession, watchAuth } from './lib/auth.js'
import { AppContext } from './lib/useApp.js'

const HEARTBEAT_STALE_SECONDS = 20
// Matches the backend's own 5s heartbeat, so the pill and the log are never
// more than one beat behind even if the realtime socket dies.
const STATUS_POLL_MS = 5000

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
  const [backend, setBackend] = useState(() => describeBackend(null))
  const [scan, setScan] = useState(null)
  const [user, setUser] = useState(null)
  const [staff, setStaff] = useState(null)
  const [team, setTeam] = useState([])
  const [registrationOpen, setRegistrationOpen] = useState(null)
  const [loadError, setLoadError] = useState('')
  const seenLog = useRef({ id: null, at: 0 })
  const primed = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [roster, today] = await Promise.all([api.listStudents(), api.listAttendance()])
      setStudents(roster ?? [])
      setLogs(today ?? [])
      setLoadError('')

      const newest = today?.[0]
      const at = newest ? Date.parse(newest.scan_time) : 0
      // Only a scan *newer* than the last one seen is worth a kiosk card, so a
      // reset that deletes today's rows cannot re-toast an old check-in.
      if (!primed.current) {
        primed.current = true
        seenLog.current = { id: newest?.id ?? null, at }
      } else if (newest && newest.id !== seenLog.current.id && at > seenLog.current.at) {
        seenLog.current = { id: newest.id, at }
        setScan({ ...newest, arrivedAt: Date.now() })
      }
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
  }, [])

  // public = signed out, pending/failed = a login with no usable staff row
  const access = useMemo(() => {
    if (mode === 'demo') return demoRole()
    if (!user) return 'public'
    if (!staff) return 'pending'
    if (staff.status === 'active') return staff.role
    return staff.status
  }, [user, staff])

  const value = useMemo(
    () => ({
      mode,
      students,
      logs,
      scan,
      backend,
      loadError,
      user,
      staff,
      team,
      access,
      registrationOpen,
      refresh,
      refreshStaff,
      signOut,
      simulateScan: api.simulateScan,
    }),
    [students, logs, scan, backend, loadError, user, staff, team, access, registrationOpen, refresh, refreshStaff, signOut],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
