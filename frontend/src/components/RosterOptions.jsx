import { knownSections } from './SectionFields.jsx'

/**
 * The suggestion lists the roster inputs point at. Rendered once per page,
 * because a datalist inside a form or a table row would be duplicated for every
 * row and ids have to stay unique.
 */
export function RosterOptions({ students }) {
  const grades = [...new Set(students.map((student) => student.grade_level).filter(Boolean))]
    .concat('1st Year')
    .sort()

  return (
    <>
      <datalist id="grade-options">
        {[...new Set(grades)].map((grade) => (
          <option key={grade} value={grade} />
        ))}
      </datalist>
      <datalist id="roster-section-options">
        {knownSections(students).map((section) => (
          <option key={section} value={section} />
        ))}
      </datalist>
    </>
  )
}
