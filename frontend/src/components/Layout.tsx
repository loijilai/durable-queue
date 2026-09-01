import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth.ts";
import BackendStatus from "./BackendStatus.tsx";
import BrandMark from "./BrandMark.tsx";
import { API_BASE_URL } from "../lib/api.ts";

const REPO_URL = "https://github.com/loijilai/durable-queue";
const PROJECT_NOTES_URL =
  "https://loijilai.site/Software-Engineering/Durable-Queue-Project-Notes";

// Swagger UI 由 drf-spectacular 掛在後端的 /api/docs/，所以要跟著 API base
// 走，不是跟著前端 origin。base 沒設時就不顯示，避免給出一個死連結。
const SWAGGER_URL = API_BASE_URL ? `${API_BASE_URL}/api/docs/` : null;

const NAV_ITEMS = [
  { to: "/auth", label: "Authentication" },
  { to: "/queue", label: "Distributed Queue" },
  { to: "/durability", label: "Durability" },
  { to: "/high-availability", label: "High Availability" },
  { to: "/scalability", label: "Scalability" },
  { to: "/security", label: "Security" },
];

function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // 換頁後收起 mobile menu；導覽不該遮住使用者剛選到的內容。
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  return (
    <div className="page">
      <header className="topbar">
        <nav className="nav-pill">
          <NavLink to="/" end className="nav-brand">
            <BrandMark className="nav-brand-mark" />
            durable-queue
          </NavLink>
          <button
            type="button"
            className="nav-menu-toggle"
            aria-expanded={mobileNavOpen}
            aria-controls="primary-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? "Close" : "Menu"}
            <span aria-hidden="true">{mobileNavOpen ? "×" : "☰"}</span>
          </button>
          <div
            id="primary-navigation"
            className={mobileNavOpen ? "nav-menu nav-menu-open" : "nav-menu"}
          >
            <div className="nav-links">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? "nav-link nav-link-active" : "nav-link"
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
            <span
              className={user ? "auth-status auth-status-in" : "auth-status"}
            >
              <span className="auth-status-dot" />
              {user
                ? (user.username ?? `user #${user.user_id}`)
                : "Not signed in"}
            </span>
          </div>
        </nav>
      </header>

      <BackendStatus />

      <main className="content">
        <Outlet />
      </main>

      {/* DESIGN.md §5：頁面節奏由三個表面色調構成 —— canvas cream → lifted
          cream → ink footer。少了這塊，構圖下緣收不住。 */}
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-grid">
            <div className="site-footer-col">
              <p className="site-footer-head">SOURCE &amp; API</p>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="site-footer-link"
              >
                GitHub repository <span aria-hidden="true">↗</span>
              </a>
              <a
                href={PROJECT_NOTES_URL}
                target="_blank"
                rel="noreferrer"
                className="site-footer-link"
              >
                Project notes <span aria-hidden="true">↗</span>
              </a>
              {SWAGGER_URL && (
                <a
                  href={SWAGGER_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="site-footer-link"
                >
                  Swagger UI <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
            <div className="site-footer-col">
              <p className="site-footer-head">THE ROUTE</p>
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="site-footer-link"
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
            <div className="site-footer-col">
              <p className="site-footer-head">STACK</p>
              <span className="site-footer-note">
                Django REST Framework · Celery
              </span>
              <span className="site-footer-note">Postgres · SQS</span>
              <span className="site-footer-note">
                React · Vite · TypeScript
              </span>
              <span className="site-footer-note">
                Terraform · AWS · GitHub Actions
              </span>
            </div>
          </div>
          <div className="site-footer-bottom">
            <span>durable-queue — a learning project.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
