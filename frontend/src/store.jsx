import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, mode } from './lib/api.js'
import { demoRole } from './lib/demo.js'
import { getCurrentUser, signOut as endSession, watchAuth } from './lib/auth.js'
import { gradesOf } from './lib/grades.js'
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
      label: fresh ? 'Scanner connected' : 'Scanner silent',
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
  // A signed-in session that has not proved the emailed code yet. Everything
  // reads as empty until it does, because row-level security says so.
  const [needsOtp, setNeedsOtp] = useState(false)
  // Why a registered admin could not be added to the staff list, if that failed.
  const [claimError, setClaimError] = useState('')
  const claimTriedFor = useRef(null)

  // A self-registered account has a login before it has a staff row, and the
  // row can only be claimed by the signed-in user themselves. Attempted here
  // rather than from the login screen because a reload never mounts that
  // screen, which used to strand a half-created account on the no-role notice.
  // Once per account per page load: a refusal is reported, not retried every
  // time the roster refreshes.
  const claimAdminRow = useCallback(async (signedIn, registrationIsOpen) => {
    const name = signedIn?.user_metadata?.full_name
    if (!signedIn || !name || claimTriedFor.current === signedIn.id) return null
    claimTriedFor.current = signedIn.id
    // Closed registration is not a reason to try, and trying anyway reported it
    // as an error against the account rather than the switch. The notice already
    // says an admin can add this address from the Staff page.
    if (registrationIsOpen === false) return null
    try {
      await api.claimAdminProfile(name)
      return await api.myStaffProfile()
    } catch (error) {
      setClaimError(error.message)
      return null
    }
  }, [])

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
    const open = await api.registrationOpen().catch(() => null)
    setRegistrationOpen(open)
    const signedIn = await getCurrentUser()
    // Asked first and independently of the staff row: an unverified session
    // cannot read staff_profiles at all, so `me` would be null either way.
    const verified = await api.loginVerified().catch(() => true)
    // Only a session can owe a code. login_ok() answers false for a signed-out
    // visitor because there is nobody to answer for, not because a code is
    // waiting, and taking that at face value used to throw every visitor
    // straight at the code screen — including the sign-out below, whose own
    // reset this call finishes after.
    const owesCode = Boolean(signedIn) && !verified
    try {
      const me = (await api.myStaffProfile()) || (await claimAdminRow(signedIn, open))
      setStaff(me ?? null)
      setTeam(me?.role === 'admin' ? ((await api.listStaff()) ?? []) : [])
      setNeedsOtp(owesCode)
    } catch {
      setStaff(null)
      setTeam([])
      setNeedsOtp(owesCode)
    }
  }, [claimAdminRow])

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
    setNeedsOtp(false)
    // A fresh sign-in is a fair chance to retry a claim that failed.
    claimTriedFor.current = null
    setClaimError('')
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

  // The grades the signed-in staff member teaches, and the one they are working
  // in right now. A professor with several needs one at a time on screen,
  // because enrolling a student into the wrong grade is easy to do and awkward
  // to undo.
  const grades = useMemo(() => gradesOf(staff), [staff])
  const [activeGrade, setActiveGrade] = useState(null)
  useEffect(() => {
    setActiveGrade((current) => (grades.includes(current) ? current : (grades[0] ?? null)))
  }, [grades])

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

  // Auto-logout after 15 minutes without any interaction. Re-arms on every
  // mouse, touch, scroll or keyboard event; only runs while signed in.
  useEffect(() => {
    if (!user) return undefined
    const INACTIVITY_LIMIT_MS = 5 * 60 * 1000
    let timer = null
    const arm = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => signOut(), INACTIVITY_LIMIT_MS)
    }
    arm()
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach((name) => window.addEventListener(name, arm, { passive: true }))
    return () => {
      if (timer) clearTimeout(timer)
      events.forEach((name) => window.removeEventListener(name, arm))
    }
  }, [user, signOut])

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

  // public = signed out, unverified = a session that has not proved its emailed
  // code, pending/failed = a login with no usable staff row
  const access = useMemo(() => {
    if (mode === 'demo') return demoRole()
    if (!user) return 'public'
    if (needsOtp) return 'unverified'
    if (!staff) return 'pending'
    if (staff.status === 'active') return staff.role
    return staff.status
  }, [user, staff, needsOtp])

  const setMaxSessionHours = useCallback(
    async (staffId, hours) => {
      const row = await api.setMaxSessionHours(staffId, hours)
      if (staffId === staff?.id) {
        setStaff(row)
      }
      setTeam((prev) => prev.map((r) => (r.id === staffId ? row : r)))
    },
    [staff?.id],
  )

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
      grades,
      activeGrade,
      setActiveGrade,
      team,
      access,
      needsOtp,
      registrationOpen,
      claimError,
      timeRemaining,
      refresh,
      refreshStaff,
      signOut,
      setMaxSessionHours,
      simulateScan: api.simulateScan,
    }),
    [
      students,
      logs,
      marks,
      backend,
      loadError,
      user,
      staff,
      grades,
      activeGrade,
      team,
      access,
      needsOtp,
      registrationOpen,
      claimError,
      timeRemaining,
      refresh,
      refreshStaff,
      signOut,
      setMaxSessionHours,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
