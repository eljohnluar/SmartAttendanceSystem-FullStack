import { useState } from 'react'
import { Avatar, StatusPill } from './ui.jsx'
import { useApp } from '../lib/useApp.js'

export function TopBar() {
  const { mode, user, staff, backend, signOut } = useApp()
  const [open, setOpen] = useState(false)

  const name = staff?.full_name || user?.email || 'Staff'

  return (
    <header className="topbar">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Smart Attendance
      </span>

      <div className="topbar-actions">
        {mode === 'demo' && <span className="mode-tag">demo data</span>}
        <StatusPill backend={backend} />

        <div className="profile">
          <button
            type="button"
            className="profile-btn"
            onClick={() => setOpen((previous) => !previous)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Account"
          >
            <Avatar student={{ first_name: name }} size="md" />
          </button>

          {open && (
            <>
              <span className="menu-backdrop" onClick={() => setOpen(false)} />
              <div className="profile-menu" role="menu">
                <span className="profile-email">{user?.email || staff?.email || name}</span>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    signOut()
                  }}
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
