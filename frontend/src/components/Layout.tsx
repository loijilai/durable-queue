import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'

const NAV_ITEMS = [
  { to: '/auth', label: 'Authentication' },
  { to: '/queue', label: 'Distributed Queue' },
  { to: '/durability', label: 'Durability' },
  { to: '/high-availability', label: 'High Availability' },
  { to: '/scalability', label: 'Scalability' },
  { to: '/security', label: 'Security' },
]

function Layout() {
  const { user } = useAuth()

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
          <span className={user ? 'auth-status auth-status-in' : 'auth-status'}>
            <span className="auth-status-dot" />
            {user ? (user.username ?? `user #${user.user_id}`) : 'Not signed in'}
          </span>
        </nav>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
