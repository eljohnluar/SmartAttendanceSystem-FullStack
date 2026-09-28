export function fullName(person) {
  if (!person) return 'Unknown student'
  return [person.first_name, person.last_name].filter(Boolean).join(' ')
}

export function initials(person) {
  const letters = fullName(person)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
  return letters || '?'
}

export function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatDateLong(date = new Date()) {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

/** Realtime payloads carry only the row id, so resolve the profile from the roster. */
export function studentFor(log, students) {
  return log.students ?? students.find((student) => student.id === log.student_id) ?? null
}
