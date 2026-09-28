import { useEffect } from 'react'
import { initials } from '../lib/format.js'

export function Avatar({ student, size = 'md' }) {
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials(student)}
    </span>
  )
}

export function StatusPill({ backend }) {
  return (
    <span className={`pill pill-${backend.state}`}>
      <span className="pill-dot" />
      {backend.label}
    </span>
  )
}

export function Notice({ title, children }) {
  return (
    <section className="login">
      <div className="card login-card">
        <h1>{title}</h1>
        <div className="page-sub">{children}</div>
      </div>
    </section>
  )
}

export function Badge({ status }) {
  const tone = status === 'Late' ? 'late' : 'present'
  return <span className={`badge badge-${tone}`}>{status.toUpperCase()}</span>
}

export function Modal({ title, children, onClose, footer, wide = false }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
