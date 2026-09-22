import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
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
  { to: "/scalability", label: "Scalability" },
  { to: "/security", label: "Security" },
];

// Appendix 不在主路線上（nav 與首頁都不列），只從頁尾進入，直接跳到被問到的那一章。
const APPENDIX_ITEMS = [
  { to: "/appendix#api-availability", label: "API Availability" },
  { to: "/appendix#pipeline", label: "Pipeline Identity & Secret Management" },
];

function Layout() {
  const { user } = useAuth();
  const { pathname, hash, key } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // BrowserRouter 換頁時不會自己捲到 #錨點；頁尾的 Appendix 連結要直達章節，
  // 所以在這裡補上。依 location.key 觸發，同一個連結再點一次也會重新捲過去。
  // 子頁的 effect 先於 Layout 執行，這時目標節點已經在 DOM 裡。
  useEffect(() => {
    if (!hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [pathname, hash, key]);

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
              <p className="site-footer-head">APPENDIX</p>
              {APPENDIX_ITEMS.map((item) => (
                <Link key={item.to} to={item.to} className="site-footer-link">
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="site-footer-col">
              <p className="site-footer-head">STACK</p>
              <span className="site-footer-note">Django REST Framework</span>
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
