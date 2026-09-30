import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { fullName } from '../lib/format.js'
import { Modal } from './ui.jsx'

const POLL_MS = 500
const GIVE_UP_SECONDS = 100
const STALE_SECONDS = 8

const PROMPT = 'Press the finger flat and hold still, lift it off completely, then press the same finger again.'

// Mirrors the stages the sensor reports: ENROL_WAIT_1, ENROL_SEEN_1, ENROL_LIFT,
// ENROL_WAIT_2, ENROL_SEEN_2. A `seen` step means the glass has the finger and
// is reading it, which is what makes the modal feel instant at the press.
const STAGES = [
  {
    key: 'place_1',
    seen: 'seen_1',
    label: 'Press finger',
    hint: 'Press the finger flat and hold still.',
    seenHint: 'Finger detected — hold still, reading…',
  },
  {
    key: 'lift',
    label: 'Lift finger',
    hint: 'Lift your finger off the scanner completely.',
  },
  {
    key: 'place_2',
    seen: 'seen_2',
    label: 'Press again',
    hint: 'Press the same finger again, flat and still.',
    seenHint: 'Finger detected — hold still, reading…',
  },
]

function locate(step) {
  for (let index = 0; index < STAGES.length; index += 1) {
    if (STAGES[index].key === step) return { index, detected: false }
    if (STAGES[index].seen === step) return { index, detected: true }
  }
  return { index: -1, detected: false }
}

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
          setNote(
            row.fingerprint_id === student.fingerprint_id
              ? `Fingerprint stored in slot ${row.fingerprint_id}. They can scan now.`
              : `Warning: the scanner used slot ${row.fingerprint_id}, but this student is saved as ${student.fingerprint_id}. Update the Fingerprint ID to match.`,
          )
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
            'No stage updates are arriving. Restart the Python service, re-run backend/schema.sql in Supabase, and re-flash the Arduino — one of them is still an old version.',
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

  const { index: stage, detected } = locate(step)
  const liveHint = stage >= 0 ? (detected ? STAGES[stage].seenHint : STAGES[stage].hint) : null

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
              captured || (stage >= 0 && index < stage)
                ? 'done'
                : index === stage
                  ? detected
                    ? 'seen'
                    : 'active'
                  : 'todo'
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
          note ||
          'Capture the print into that slot now, or do it later — the Fingerprint button on their row reopens this.'}
      </p>
    </Modal>
  )
}
