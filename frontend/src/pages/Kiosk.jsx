import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Avatar, Badge } from '../components/ui.jsx'
import { formatTime, fullName } from '../lib/format.js'
import { useApp } from '../lib/useApp.js'

const DWELL_MS = 5000
// The signed-out kiosk has no realtime role, so polling is its only feed;
// keep it brisk or a scan feels like it never registered.
const PULSE_MS = 1000
const FRESH_MS = 15000

export default function Kiosk() {
  const { mode, simulateScan } = useApp()
  const [clock, setClock] = useState(() => new Date())
  const [pulse, setPulse] = useState(null)
  const [card, setCard] = useState(null)
  const [demoId, setDemoId] = useState('1')
  const [demoError, setDemoError] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Polled rather than subscribed so the signed-out kiosk — which has no
  // realtime role — still sees every scan the Python service records.
  useEffect(() => {
    let live = true
    const tick = () => {
      // A missing kiosk_pulse() (schema not re-run yet) must not spam
      // unhandled rejections every poll; the welcome screen still renders.
      api.kioskPulse().then((row) => {
        if (live) setPulse(row)
      }).catch(() => {})
    }
    tick()
    const timer = setInterval(tick, PULSE_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  // Skip the first pulse (it is history, not news) and ignore scans older than
  // a few seconds, so opening the kiosk at noon or a teacher's "clear today"
  // cannot re-show a morning check-in.
  const primed = useRef(false)
  useEffect(() => {
    if (!pulse?.log_id) return
    if (!primed.current) {
      primed.current = true
      return
    }
    const age = Date.now() - Date.parse(pulse.scan_time)
    if (pulse.log_id !== card?.logId && age < FRESH_MS) {
      setCard({ logId: pulse.log_id, row: pulse, arrivedAt: Date.now() })
    }
  }, [pulse, card])

  const row = card?.row ?? null
  const student = row?.log_id
    ? { first_name: row.first_name, last_name: row.last_name, grade_level: row.grade_level }
    : null
  const showStudent = Boolean(student) && clock.getTime() - card.arrivedAt < DWELL_MS

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
        <div className="scan-card" key={card.logId}>
          <Avatar student={student} size="xl" />
          <h1 className="scan-name">{fullName(student)}</h1>
          <p className="scan-grade">{student.grade_level}</p>
          <Badge status={row.status} />
          <p className="scan-time">Checked in at {formatTime(row.scan_time)}</p>
          {row.parent_notified && <p className="scan-note">Parent notified by email</p>}
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
            <strong>{pulse?.checked_in ?? 0}</strong> checked in today
          </p>
        </div>
      )}

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
