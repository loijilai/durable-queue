import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext.tsx";
import { ApiError, API_BASE_URL } from "../lib/api.ts";
import JwtInspector from "../components/JwtInspector.tsx";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

function GoogleLoginButton() {
  // 整頁導頁去後端(不是 fetch)：要讓瀏覽器真的離開 SPA，
  // 把 OAuth state 存進 Django session cookie，並讓使用者在 Google 頁面上操作。
  return (
    <a
      className="btn-secondary btn-google"
      href={`${API_BASE_URL}/api/auth/google/login/`}
    >
      <GoogleIcon />
      Sign in with Google
    </a>
  );
}

type FormStatus = "idle" | "submitting" | "success" | "error";

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      await login({ username, password });
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      return;
    }
    setStatus("idle");
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p className="auth-error">{error}</p>}
      <button
        type="submit"
        className="btn-primary"
        disabled={status === "submitting"}
      >
        {status === "submitting" ? "Logging in…" : "Log in"}
      </button>
      <p className="auth-switch">
        No account?{" "}
        <button type="button" className="link-button" onClick={onSwitch}>
          Register
        </button>
      </p>
    </form>
  );
}

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const { register } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      await register({ username, email, password });
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      return;
    }
    setStatus("success");
  }

  if (status === "success") {
    return (
      <div className="auth-form">
        <p>Account created — you can log in now.</p>
        <button type="button" className="btn-primary" onClick={onSwitch}>
          Go to login
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p className="auth-error">{error}</p>}
      <button
        type="submit"
        className="btn-primary"
        disabled={status === "submitting"}
      >
        {status === "submitting" ? "Registering…" : "Register"}
      </button>
      <p className="auth-switch">
        Already have an account?{" "}
        <button type="button" className="link-button" onClick={onSwitch}>
          Log in
        </button>
      </p>
    </form>
  );
}

type RefreshStatus = "idle" | "refreshing" | "success" | "error";

function RefreshDemo() {
  const { refreshAccessToken } = useAuth();
  const [status, setStatus] = useState<RefreshStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleRefresh() {
    setStatus("refreshing");
    setMessage(null);
    try {
      await refreshAccessToken();
      setStatus("success");
      setMessage("New access token issued.");
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof ApiError
          ? err.message
          : "Refresh token is invalid or expired.",
      );
    }
  }

  return (
    <div className="refresh-demo">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        MANUAL REFRESH DEMO
      </p>
      <p className="jwt-note">
        Call <code>POST /api/auth/token/refresh/</code> with the refresh token
        and swaps in a new access token.
      </p>
      <button
        type="button"
        className="btn-secondary"
        onClick={handleRefresh}
        disabled={status === "refreshing"}
      >
        {status === "refreshing" ? "Refreshing…" : "Refresh access token"}
      </button>
      {message && (
        <p className={status === "error" ? "auth-error" : "refresh-success"}>
          {message}
        </p>
      )}
    </div>
  );
}

function AuthPage() {
  const { accessToken, user, logout } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");

  return (
    <section className="auth-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        AUTHENTICATION
      </p>
      <h1>Login, Register & Inspect Your JWT</h1>

      {!accessToken && (
        <div className="auth-card">
          {mode === "login" ? (
            <LoginForm onSwitch={() => setMode("register")} />
          ) : (
            <RegisterForm onSwitch={() => setMode("login")} />
          )}
          <div className="auth-divider">or</div>
          <GoogleLoginButton />
        </div>
      )}

      {accessToken && user && (
        <div className="auth-card">
          <p>
            Logged in as{" "}
            <strong>{user.username ?? `user #${user.user_id}`}</strong>
          </p>
          <button type="button" className="btn-primary" onClick={logout}>
            Log out
          </button>
          <JwtInspector token={accessToken} payload={user} />
          <RefreshDemo />
        </div>
      )}
    </section>
  );
}

export default AuthPage;
