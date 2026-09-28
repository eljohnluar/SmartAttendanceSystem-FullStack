export function Sidebar({ routes, path }) {
  return (
    <aside className="sidebar">
      <nav className="side-nav">
        {routes.map((entry) => (
          <a
            key={entry.path}
            href={`#/${entry.path}`}
            className={entry.path === path ? 'is-active' : undefined}
            aria-current={entry.path === path ? 'page' : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
    </aside>
  )
}
