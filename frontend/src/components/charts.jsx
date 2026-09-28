/**
 * Small dependency-free charts. Three shapes so the reports do not all read the
 * same way: ranked bars, a proportion bar, and stacked daily columns.
 */

export function BarList({ items, unit = '' }) {
  const max = Math.max(1, ...items.map((item) => item.value))

  if (items.length === 0) return <p className="muted">Nothing to report yet.</p>

  return (
    <ul className="bars">
      {items.map((item) => (
        <li key={item.label}>
          <span className="bar-label">{item.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="bar-value mono">
            {item.value}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function StackedBar({ segments }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  return (
    <div className="stacked">
      <span
        className="stack"
        role="img"
        aria-label={segments.map((segment) => `${segment.label}: ${segment.value}`).join(', ')}
      >
        {total === 0 ? (
          <span className="stack-seg seg-empty" style={{ width: '100%' }} />
        ) : (
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <span
                key={segment.label}
                className={`stack-seg seg-${segment.tone}`}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ))
        )}
      </span>
      <ul className="legend">
        {segments.map((segment) => (
          <li key={segment.label}>
            <span className={`swatch swatch-${segment.tone}`} />
            {segment.label}
            <strong>{segment.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ColumnChart({ days, keys }) {
  const max = Math.max(1, ...days.map((day) => keys.reduce((sum, key) => sum + day[key.name], 0)))

  if (days.length === 0) return <p className="muted">No attendance recorded in this range.</p>

  return (
    <div className="columns-wrap">
      <div className="columns">
        {days.map((day) => (
          <div className="column" key={day.date} title={`${day.full ?? day.label}: ${day.total ?? 0} arrived`}>
            <div className="column-bar" style={{ height: `${(keys.reduce((sum, key) => sum + day[key.name], 0) / max) * 100}%` }}>
              {keys.map((key) =>
                day[key.name] > 0 ? (
                  <span
                    key={key.name}
                    className={`column-seg seg-${key.tone}`}
                    style={{ flexGrow: day[key.name] }}
                  />
                ) : null,
              )}
            </div>
            <span className="column-label">{day.label}</span>
          </div>
        ))}
      </div>
      <ul className="legend">
        {keys.map((key) => (
          <li key={key.name}>
            <span className={`swatch swatch-${key.tone}`} />
            {key.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
