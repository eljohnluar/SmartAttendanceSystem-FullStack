import { GRADES } from '../lib/grades.js'

/**
 * The grades a professor teaches: one pick per row, a plus that appears once
 * the first has something in it, and a remove on every row after the first so
 * the list can never be emptied by accident.
 *
 * A grade already chosen in another row is disabled rather than silently
 * dropped, so the repeat is visible where it was made.
 */
export function GradeFields({ grades, onChange, options = [], disabled = false, nameFor }) {
  const list = grades?.length ? grades : ['']
  const taken = new Set(list.filter(Boolean))
  const choices = [...new Set([...GRADES, ...options, ...list.filter(Boolean)])]
  const lastIsBlank = !(list[list.length - 1] ?? '').trim()

  function setAt(index, value) {
    const next = [...list]
    next[index] = value
    onChange(next.filter((grade, position) => grade || position === next.length - 1))
  }

  return (
    <div className="grade-fields">
      {list.map((grade, index) => (
        <div className="grade-row" key={index}>
          <select
            value={grade}
            disabled={disabled}
            onChange={(event) => setAt(index, event.target.value)}
            aria-label={nameFor ? nameFor(index + 1) : `Grade ${index + 1}`}
          >
            <option value="">{disabled ? 'Not needed for admins' : 'Choose a grade'}</option>
            {choices.map((entry) => (
              <option key={entry} value={entry} disabled={entry !== grade && taken.has(entry)}>
                {entry}
              </option>
            ))}
          </select>
          {index > 0 && !disabled && (
            <button
              type="button"
              className="btn-icon"
              onClick={() => onChange(list.filter((_, position) => position !== index))}
              aria-label={`Remove grade ${index + 1}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!disabled && taken.size > 0 && !lastIsBlank && (
        <button
          type="button"
          className="btn-icon btn-icon-add"
          onClick={() => onChange([...list.filter(Boolean), ''])}
          aria-label="Add another grade"
        >
          +
        </button>
      )}
    </div>
  )
}
