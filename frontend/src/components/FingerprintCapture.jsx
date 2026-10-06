import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { fullName } from '../lib/format.js'
import { Modal } from './ui.jsx'

const POLL_MS = 500
const GIVE_UP_SECONDS = 100
const STALE_SECONDS = 8

const PROMPT =
  'Press the finger flat and hold still, lift it off completely, and repeat until all three scans are taken.'

const MERGING = 'Combining the three scans into one print…'

// Mirrors the stages the scanner reports. Three presses of the same finger are
// merged into a single print, which is what makes the match reliable when the
// child is in a hurry.
const STAGES = [
  { key: 'place_1', label: 'First press', hint: 'Press the finger flat and hold still.' },
  { key: 'place_2', label: 'Second press', hint: 'Lift it off, then press the same finger again.' },
  { key: 'place_3', label: 'Third press', hint: 'Once more — same finger, flat and still.' },
]

function locate(step) {
  if (step === 'merge') return STAGES.length
  const index = STAGES.findIndex((entry) => entry.key === step)
  return index
}

function explain(code) {
  if (!code) return 'The scanner gave no reason. Try again.'
  if (code.startsWith('TEMPLATES_DID_NOT_MATCH')) {
    return 'That looked like a different finger — the scans have to be the same one. Try again.'
  }
  if (code.startsWith('TIMEOUT')) {
    return 'The scanner never saw a finger. Press Enroll fingerprint and place the finger flat right away.'
  }
  if (code.startsWith('NO_STUDENT')) {
    return 'No student is saved under that Fingerprint ID yet. Save the student first, then enroll the print.'
  }
  if (code.startsWith('MERGE_FAILED')) {
    return 'The three scans could not be combined. Press the finger a little flatter and try again.'
  }
  if (code.startsWith('SAVE_FAILED')) {
    return 'The print was captured but could not be saved. Check the connection and try again.'
  }
  return `The scanner rejected that print: ${code}. Try again.`
}

/**
 * The second half of enrolling a student: the profile is already saved, so a
 * failed print leaves a usable row to retry against. Always captures into the
 * Fingerprint ID named on the student, never whichever one is free.
 */
export function FingerprintCapture({ student, onClose }) {
  const [capturing, setCapturing] = useState(false)
  const [captured, setCaptured] = useState(false)
  const [step, setStep] = useState(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const timer = useRef(null)
  const subscription = useRef(null)

  useEffect(
    () => () => {
      clearInterval(timer.current)
      subscription.current?.()
    },
    [],
  )

  async function enroll() {
    clearInterval(timer.current)
    subscription.current?.()
    setError('')
    setStep(null)
    setNote(PROMPT)
    try {
      const started = await api.startCapture(student.fingerprint_id)
      setCapturing(true)

      const startedAt = Date.now()
      let settled = false

      const finish = () => {
        settled = true
        clearInterval(timer.current)
        subscription.current?.()
        subscription.current = null
      }

      async function tick() {
        if (settled) return
        const elapsed = (Date.now() - startedAt) / 1000
        const row = await api.getCapture(started.id).catch(() => null)

        if (row?.status === 'done') {
          finish()
          setCapturing(false)
          setCaptured(true)
          setStep(null)
          setNote(`Fingerprint ID ${student.fingerprint_id} saved. They can scan now.`)
          return
        }
        if (row?.status === 'failed') {
          finish()
          setCapturing(false)
          setStep(null)
          setError(explain(row.error))
          return
        }
        if (row?.status === 'expired') {
          finish()
          setCapturing(false)
          setStep(null)
          setError('Timed out waiting for a finger. Press Enroll fingerprint to try again.')
          return
        }
        if (elapsed >= GIVE_UP_SECONDS) {
          finish()
          setCapturing(false)
          setStep(null)
          setError('Nothing came back from the scanner. Check it is plugged in, then try again.')
          return
        }
        setStep(row?.step || null)
        // The first stage lands about a second after Enroll when the whole
        // stack is current, so prolonged silence means one piece is stale.
        if (elapsed >= STALE_SECONDS && !row?.step) {
          setNote(
            'No stages are coming through. Check the scanner is plugged in and the attendance scanner program is running, then try again.',
          )
        }
      }

      timer.current = setInterval(tick, POLL_MS)
      subscription.current = api.subscribeCaptures(tick)
    } catch (captureError) {
      setCapturing(false)
      setNote('')
      setError(captureError.message)
    }
  }

  const stage = locate(step)
  const liveHint = stage >= 0 && stage < STAGES.length ? STAGES[stage].hint : null

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
      {(capturing || captured) && (
        <ol className="scan-steps" aria-label="Capture stages">
          {STAGES.map((entry, index) => {
            const state =
              captured || (stage >= 0 && index < stage) ? 'done' : index === stage ? 'active' : 'todo'
            return (
              <li key={entry.key} className={`scan-step scan-step-${state}`}>
                <span className="scan-step-dot" />
                {entry.label}
              </li>
            )
          })}
        </ol>
      )}
      <p className={`hint${capturing ? ' hint-live' : ''}`} aria-live="polite">
        {liveHint ||
          (step === 'merge' ? MERGING : '') ||
          note ||
          'Enroll the print now, or do it later — the Fingerprint button on their row reopens this.'}
      </p>
    </Modal>
  )
}
