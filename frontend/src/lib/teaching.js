import { gradesOf } from './grades.js'

/**
 * What a chosen teacher may be assigned: their grades, and their sections when
 * they have been narrowed to any. A null scope means no teacher is chosen, so
 * the caller falls back to every grade and section in the roster.
 */
export function teacherScope(teacher) {
  if (!teacher) return null
  const grades = gradesOf(teacher)
  // A staff row with no grades assigned is still being set up; treating that as
  // "no grade may be picked" would leave the form with nothing to choose.
  if (grades.length === 0) return null
  return { grades, sections: (teacher.sections ?? []).filter(Boolean) }
}

export function findTeacher(teachers, id) {
  return (teachers ?? []).find((teacher) => teacher.id === id) ?? null
}

export function teacherName(teachers, id) {
  return findTeacher(teachers, id)?.full_name ?? ''
}
