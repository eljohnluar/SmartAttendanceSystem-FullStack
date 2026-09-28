import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { fullName } from '../lib/format.js'
import { Modal } from './ui.jsx'

const POLL_MS = 1000
const GIVE_UP_SECONDS = 100
const HINT_SECONDS = 25

const PROMPT = 'Press the finger flat and hold still, lift it off completely, then press the same finger again.'

function explain(code) {
  if (!code) return 'The scanner gave no reason. Try again.'
  if (code.startsWith('TEMPLATES_DID_NOT_MATCH')) {
    return 'The two scans did not match — the finger moved or was not lifted fully between them. Try again.'
  }
  if (code.startsWith('TIMEOUT')) {
    return 'The scanner never saw a finger. Press Enroll fingerprint and place the finger flat right away.'
  }
  return `The scanner rejected that print: ${code}. Try again.`
}

/**
 * The second half of enrolling a student: the profile is already saved, so a
 * failed print leaves a usable row to retry against. Always captures into the
 * slot named on the student, never whichever one the sensor prefers.
 */
export function FingerprintCapture({ student, onClose }) {
  const [capturing, setCapturing] = useState(false)
  const [captured, setCaptured] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const timer = useRef(null)

  useEffect(() => () => clearInterval(timer.current), [])

  async function enroll() {
    clearInterval(timer.current)
    setError('')
    setNote(PROMPT)
    try {
      const started = await api.startCapture(student.fingerprint_id)
      setCapturing(true)

      let elapsed = 0
      timer.current = setInterval(async () => {
        elapsed += POLL_MS / 1000
        const row = await api.getCapture(started.id).catch(() => null)

        if (row?.status === 'done') {
          clearInterval(timer.current)
          setCapturing(false)
          setCaptured(true)
          setNote(
            row.fingerprint_id === student.fingerprint_id
              ? `Fingerprint stored in slot ${row.fingerprint_id}. They can scan now.`
              : `Warning: the scanner used slot ${row.fingerprint_id}, but this student is saved as ${student.fingerprint_id}. Update the Fingerprint ID to match.`,
          )
          return
        }
        if (row?.status === 'failed') {
          clearInterval(timer.current)
          setCapturing(false)
          setError(explain(row.error))
          return
        }
        if (row?.status === 'expired') {
          clearInterval(timer.current)
          setCapturing(false)
          setError('Timed out waiting for a finger. Press Enroll fingerprint to try again.')
          return
        }
        if (elapsed >= GIVE_UP_SECONDS) {
          clearInterval(timer.current)
          setCapturing(false)
          setError('Nothing came back from the scanner. Check it is plugged in, then try again.')
          return
        }
        if (elapsed >= HINT_SECONDS) setNote('Still waiting for the scanner…')
      }, POLL_MS)
    } catch (captureError) {
      setCapturing(false)
      setNote('')
      setError(captureError.message)
    }
  }

  return (
    <Modal
      title="Enroll fingerprint"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {captured ? 'Done' : 'Do it later'}
        </button>
      }
    >
      <p className="alert alert-ok">
        {fullName(student)} saved as Fingerprint ID {student.fingerprint_id}.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      <button type="button" className="btn btn-primary" onClick={enroll} disabled={capturing} autoFocus>
        {capturing ? 'Waiting for finger…' : captured ? 'Enroll again' : 'Enroll fingerprint'}
      </button>
      <p className={`hint${capturing ? ' hint-live' : ''}`}>
        {note || 'Capture the print into that slot now, or do it later.'}
      </p>
    </Modal>
  )
}
