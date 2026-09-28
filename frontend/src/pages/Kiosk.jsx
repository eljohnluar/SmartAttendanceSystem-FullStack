import { useEffect, useState } from 'react'
import { Avatar, Badge } from '../components/ui.jsx'
import { formatTime, fullName, studentFor } from '../lib/format.js'
import { useApp } from '../lib/useApp.js'

const DWELL_MS = 5000

export default function Kiosk() {
  const { scan, students, logs, mode, simulateScan, loadError } = useApp()
  const [clock, setClock] = useState(() => new Date())
  const [demoId, setDemoId] = useState('1')
  const [demoError, setDemoError] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const student = scan ? studentFor(scan, students) : null
  const showStudent = Boolean(student) && clock.getTime() - scan.arrivedAt < DWELL_MS

  async function runDemoScan(event) {
    event.preventDefault()
    setDemoError('')
    const result = await simulateScan(Number(demoId))
    if (result?.error) setDemoError(result.error)
  }

  return (
    <section className="kiosk">
      <header className="kiosk-top">
        <span className="eyebrow">Smart Attendance</span>
        <time className="kiosk-clock" dateTime={clock.toISOString()}>
          {formatTime(clock.toISOString())}
        </time>
      </header>

      {showStudent ? (
        <div className="scan-card" key={scan.id}>
          <Avatar student={student} size="xl" />
          <h1 className="scan-name">{fullName(student)}</h1>
          <p className="scan-grade">{student.grade_level}</p>
          <Badge status={scan.status} />
          <p className="scan-time">Checked in at {formatTime(scan.scan_time)}</p>
          {scan.parent_notified && <p className="scan-note">Parent notified by email</p>}
        </div>
      ) : (
        <div className="welcome">
          <span className="finger-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M12 11.5v1.2M8.6 8.9a5 5 0 0 1 6.8 0M6.4 6.6a8.2 8.2 0 0 1 11.2 0M10.2 16.9a3 3 0 0 1 3.6-.4M4.7 10.1a11.4 11.4 0 0 1 3-3.1" />
            </svg>
          </span>
          <h1 className="welcome-title">Welcome</h1>
          <p className="welcome-hint">Please place your finger on the scanner</p>
          <p className="welcome-count">
            <strong>{logs.length}</strong> checked in today
          </p>
        </div>
      )}

      {loadError && <p className="kiosk-error">{loadError}</p>}

      {mode === 'demo' && (
        <form className="demo-bar" onSubmit={runDemoScan}>
          <label htmlFor="demo-fp">Simulate a scan</label>
          <input
            id="demo-fp"
            inputMode="numeric"
            value={demoId}
            onChange={(event) => setDemoId(event.target.value)}
            aria-label="Fingerprint ID to simulate"
          />
          <button type="submit" className="btn btn-ghost">
            Scan finger
          </button>
          {demoError && <span className="demo-error">{demoError}</span>}
        </form>
      )}
    </section>
  )
}
