export const GRADES = ['1st Year', '2nd Year', '3rd Year', '4th Year']

/** Blanks and repeats removed, order kept. */
export function cleanGrades(grades) {
  const seen = new Set()
  const next = []
  for (const grade of grades ?? []) {
    const value = (grade ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

/** The grades a staff row scopes: the list, or the single grade older rows hold. */
export function gradesOf(staff) {
  const list = cleanGrades(staff?.grades ?? [])
  if (list.length) return list
  return staff?.grade_level ? [staff.grade_level] : []
}
