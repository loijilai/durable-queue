import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext.tsx'
import { ApiError } from '../lib/api.ts'
import JwtInspector from '../components/JwtInspector.tsx'

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setError(null)
    try {
      await login({ username, password })
    } catch (err) {
      setStatus('error')
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      return
    }
    setStatus('idle')
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} required />
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
      <button type="submit" className="btn-primary" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Logging in…' : 'Log in'}
      </button>
      <p className="auth-switch">
        No account?{' '}
        <button type="button" className="link-button" onClick={onSwitch}>
          Register
        </button>
      </p>
    </form>
  )
}

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const { register } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setError(null)
    try {
      await register({ username, email, password })
    } catch (err) {
      setStatus('error')
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      return
    }
    setStatus('success')
  }

  if (status === 'success') {
    return (
      <div className="auth-form">
        <p>Account created — you can log in now.</p>
        <button type="button" className="btn-primary" onClick={onSwitch}>
          Go to login
        </button>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} required />
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
      <button type="submit" className="btn-primary" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Registering…' : 'Register'}
      </button>
      <p className="auth-switch">
        Already have an account?{' '}
        <button type="button" className="link-button" onClick={onSwitch}>
          Log in
        </button>
      </p>
    </form>
  )
}

function AuthPage() {
  const { accessToken, user, logout } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')

  return (
    <section className="auth-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        AUTHENTICATION
      </p>
      <h1>Login, Register & Inspect Your JWT</h1>

      {!accessToken && (
        <div className="auth-card">
          {mode === 'login' ? (
            <LoginForm onSwitch={() => setMode('register')} />
          ) : (
            <RegisterForm onSwitch={() => setMode('login')} />
          )}
        </div>
      )}

      {accessToken && user && (
        <div className="auth-card">
          <p>
            Logged in as <strong>{user.username ?? `user #${user.user_id}`}</strong>
          </p>
          <button type="button" className="btn-primary" onClick={logout}>
            Log out
          </button>
          <JwtInspector token={accessToken} payload={user} />
        </div>
      )}
    </section>
  )
}

export default AuthPage
