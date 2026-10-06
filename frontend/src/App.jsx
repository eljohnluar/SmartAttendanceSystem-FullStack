import { useEffect, useState } from 'react'
import { Notice } from './components/ui.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { TopBar } from './components/TopBar.jsx'
import Attendance from './pages/Attendance.jsx'
import Home from './pages/Home.jsx'
import Kiosk from './pages/Kiosk.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import AddStaff from './pages/admin/AddStaff.jsx'
import Reports from './pages/admin/Reports.jsx'
import StudentManagement from './pages/admin/StudentManagement.jsx'
import TeacherManagement from './pages/admin/TeacherManagement.jsx'
import Students from './pages/Students.jsx'
import MyProfile from './pages/teacher/MyProfile.jsx'
import TeacherReports from './pages/teacher/TeacherReports.jsx'
import { AppProvider } from './store.jsx'
import { useApp } from './lib/useApp.js'

const STAFF = ['teacher', 'admin']
const ADMIN = ['admin']

// Nav order follows this array, so it doubles as the menu definition. Admin
// never sees the kiosk entry, so leading with it only reorders the teacher menu.
const ROUTES = [
  { path: 'kiosk', label: 'Scan Station', View: Kiosk, roles: ['teacher'] },
  { path: 'home', label: 'Dashboard', View: Home, roles: STAFF },
  { path: 'add-staff', label: 'Add Staff', View: AddStaff, roles: ADMIN },
  { path: 'teachers', label: 'Professor Management', View: TeacherManagement, roles: ADMIN },
  { path: 'roster', label: 'Student Management', View: StudentManagement, roles: ADMIN },
  { path: 'students', label: 'My Students', View: Students, roles: ['teacher'] },
  { path: 'attendance', label: 'Attendance', View: Attendance, roles: STAFF },
  { path: 'reports', label: 'Reports', View: Reports, roles: ADMIN },
  { path: 'my-reports', label: 'Reports', View: TeacherReports, roles: ['teacher'] },
  { path: 'profile', label: 'My Profile', View: MyProfile, roles: ['teacher'] },
  { path: 'register', label: 'Register', View: Register, roles: ['public'], hidden: true },
  { path: 'login', label: 'Sign in', View: Login, roles: ['public'], hidden: true },
]

function hashPath() {
  const hash = window.location.hash.replace('#/', '')
  return ROUTES.some((route) => route.path === hash) ? hash : null
}

/** Unprovisioned logins get no navigation at all. */
function Bare({ access, user, staff, onSignOut }) {
  if (access === 'pending') {
    return (
      <Notice title="Waiting for approval">
        <p>
          {user?.email} has an account but no role yet. An admin assigns grades from the Staff page, and the
          Python service finishes creating the login — it has to be running for that.
        </p>
        <p>
          <button type="button" className="link-btn" onClick={onSignOut}>
            Sign out
          </button>
        </p>
      </Notice>
    )
  }

  return (
    <Notice title="Account could not be created">
      <p>
        The backend tried to provision {user?.email} and failed: {staff?.error || 'no reason given'}. An admin
        can retry from the Staff page.
      </p>
      <p>
        <button type="button" className="link-btn" onClick={onSignOut}>
          Sign out
        </button>
      </p>
    </Notice>
  )
}

function Shell() {
  const { access, user, staff, signOut } = useApp()
  const [path, setPath] = useState(hashPath)

  useEffect(() => {
    const sync = () => setPath(hashPath())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const isStaff = STAFF.includes(access)
  // A signed-out classroom PC is the Scan Station: students check in before
  // any teacher arrives, so guests land on the kiosk instead of the login.
  const current = path ?? (isStaff ? 'home' : 'kiosk')

  if (!isStaff) {
    if (access === 'pending' || access === 'failed') {
      return (
        <div className="bare">
          <Bare access={access} user={user} staff={staff} onSignOut={signOut} />
        </div>
      )
    }
    if (current === 'kiosk') {
      return (
        <div className="kiosk-bare">
          <Kiosk />
          <a className="kiosk-signin" href="#/login">
            Staff sign in
          </a>
        </div>
      )
    }
    // Guests get exactly three screens. Any staff hash left in the address
    // bar (e.g. #/reports when signing out) falls back to the login form,
    // never to the staff page itself.
    const GuestView = current === 'register' ? Register : Login
    return (
      <div className="bare">
        <GuestView />
      </div>
    )
  }

  const route = ROUTES.find((entry) => entry.path === current) ?? ROUTES[0]
  const visible = ROUTES.filter((entry) => !entry.hidden && entry.roles.includes(access))
  const { View } = route

  return (
    <div className="app-shell">
      <TopBar />
      <div className="shell">
        <Sidebar routes={visible} path={route.path} />
        <main className="main">
          {route.roles.includes(access) ? (
            <View />
          ) : (
            <Notice title="Not available for your role">
              <p>Staff accounts are managed by admins. Ask one if you need a colleague added.</p>
            </Notice>
          )}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
