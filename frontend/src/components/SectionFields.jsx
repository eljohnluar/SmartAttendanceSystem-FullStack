/**
 * The sections a professor is limited to: one row each, a plus to add another
 * once the first has something in it, and a remove on every row after the first
 * so the list can always be emptied right back to "the whole grade".
 *
 * The page owns the <datalist> of known sections and passes its id here, so one
 * list serves every row instead of each row declaring its own duplicate id.
 */
export function SectionFields({ sections, onChange, listId, disabled = false, nameFor }) {
  const list = sections?.length ? sections : ['']

  function setAt(index, value) {
    const next = [...list]
    next[index] = value
    onChange(keepOneTrailingBlank(next))
  }

  const filled = list.filter((section) => section.trim())
  const lastIsBlank = !(list[list.length - 1] ?? '').trim()

  return (
    <div className="section-fields">
      {list.map((section, index) => (
        <div className="section-row" key={index}>
          <input
            value={section}
            disabled={disabled}
            list={disabled ? undefined : listId}
            placeholder={disabled ? 'Not needed for admins' : 'e.g. A'}
            onChange={(event) => setAt(index, event.target.value)}
            aria-label={nameFor ? nameFor(index + 1) : `Section ${index + 1}`}
            autoComplete="off"
          />
          {index > 0 && !disabled && (
            <button
              type="button"
              className="btn-icon"
              onClick={() => onChange(keepOneTrailingBlank(list.filter((_, position) => position !== index)))}
              aria-label={`Remove section ${index + 1}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!disabled && filled.length > 0 && !lastIsBlank && (
        <button
          type="button"
          className="btn-icon btn-icon-add"
          onClick={() => onChange([...filled, ''])}
          aria-label="Add another section"
        >
          +
        </button>
      )}
    </div>
  )
}

/**
 * Interior blanks would render an empty row with no way back, so they collapse;
 * one blank at the end stays, because that is the row being typed into.
 */
function keepOneTrailingBlank(list) {
  const next = list.map((section) => section.trim())
  while (next.length > 1 && next[next.length - 2] === '') next.splice(-2, 1)
  return next
}

/** Blanks and repeats removed, order kept. */
export function cleanSections(sections) {
  const seen = new Set()
  const next = []
  for (const section of sections ?? []) {
    const value = (section ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

/** Sections already in the roster, so a name typed once is a pick from then on. */
export function knownSections(students, grade) {
  return [
    ...new Set(
      students
        .filter((student) => !grade || student.grade_level === grade)
        .map((student) => student.section)
        .filter(Boolean),
    ),
  ].sort()
}
