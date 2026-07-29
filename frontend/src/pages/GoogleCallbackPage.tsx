import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'

function GoogleCallbackPage() {
  const { completeGoogleLogin } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  // StrictMode 在 dev 模式下會把 mount 的 effect 連續跑兩次；
  // 這個 effect 會清掉 URL fragment(一次性、讀完即棄),第二次重跑就讀不到東西了。
  // 用 ref 擋掉第二次執行，讓「fragment 只被消費一次」這個不變量成立。
  const hasHandled = useRef(false)

  useEffect(() => {
    if (hasHandled.current) return
    hasHandled.current = true

    const params = new URLSearchParams(window.location.hash.slice(1))
    // 讀完立刻清掉網址列的 fragment，token 不留在 URL / history entry 上
    window.history.replaceState(null, '', window.location.pathname)

    const errorParam = params.get('error')
    const access = params.get('access')
    const refresh = params.get('refresh')

    if (errorParam) {
      setError(errorParam)
      return
    }
    if (!access || !refresh) {
      setError('Missing tokens from Google login redirect')
      return
    }

    completeGoogleLogin({ access, refresh })
    navigate('/auth', { replace: true })
  }, [completeGoogleLogin, navigate])

  if (error) {
    return (
      <section className="auth-page">
        <p className="auth-error">Google login failed: {error}</p>
      </section>
    )
  }

  return (
    <section className="auth-page">
      <p>Signing you in…</p>
    </section>
  )
}

export default GoogleCallbackPage
