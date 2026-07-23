import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/auth', label: 'Authentication' },
  { to: '/queue', label: 'Distributed Queue' },
  { to: '/concurrency', label: 'Concurrency' },
  { to: '/scalability', label: 'Scalability' },
  { to: '/high-availability', label: 'High Availability' },
]

function Layout() {
  return (
    <div className="page">
      <header className="topbar">
        <nav className="nav-pill">
          <NavLink to="/" end className="nav-brand">
            durable-queue
          </NavLink>
          <div className="nav-links">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? 'nav-link nav-link-active' : 'nav-link'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
