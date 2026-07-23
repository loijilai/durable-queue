import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import {
  login as loginRequest,
  refreshAccessToken as refreshAccessTokenRequest,
  registerUser,
  ApiError,
  type LoginCredentials,
  type RegisterFields,
  type TokenPair,
} from '../lib/api.ts'
import {
  saveTokens,
  saveAccessToken,
  getAccessToken,
  getRefreshToken,
  clearTokens,
  decodeJwtPayload,
  type JwtPayload,
} from '../lib/authStorage.ts'

interface AuthContextValue {
  accessToken: string | null
  user: JwtPayload | null
  login: (credentials: LoginCredentials) => Promise<void>
  register: (fields: RegisterFields) => Promise<void>
  completeGoogleLogin: (tokens: TokenPair) => void
  logout: () => void
  refreshAccessToken: () => Promise<string>
  authedFetch: <T>(fn: (token: string) => Promise<T>) => Promise<T>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() => getAccessToken())
  // 多個 request 同時 401 時，只打一次 refresh，其他 request 共用同一個 in-flight promise。
  const refreshInFlight = useRef<Promise<string> | null>(null)

  async function login(credentials: LoginCredentials) {
    const tokens = await loginRequest(credentials)
    saveTokens(tokens)
    setAccessToken(tokens.access)
  }

  async function register(fields: RegisterFields) {
    await registerUser(fields)
  }

  function completeGoogleLogin(tokens: TokenPair) {
    saveTokens(tokens)
    setAccessToken(tokens.access)
  }

  function logout() {
    clearTokens()
    setAccessToken(null)
  }

  function refreshAccessToken(): Promise<string> {
    if (!refreshInFlight.current) {
      refreshInFlight.current = (async () => {
        const refresh = getRefreshToken()
        if (!refresh) {
          logout()
          throw new Error('No refresh token available')
        }
        try {
          const { access } = await refreshAccessTokenRequest(refresh)
          saveAccessToken(access)
          setAccessToken(access)
          return access
        } catch (err) {
          // refresh token 本身也失效了（過期或被撤銷）——沒有別的路可走，只能真的登出。
          logout()
          throw err
        } finally {
          refreshInFlight.current = null
        }
      })()
    }
    return refreshInFlight.current
  }

  // Silent refresh 攔截器：先用目前的 access token 打 fn，401 就換一顆新 token 重試一次。
  async function authedFetch<T>(fn: (token: string) => Promise<T>): Promise<T> {
    if (!accessToken) throw new Error('Not authenticated')
    try {
      return await fn(accessToken)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const newToken = await refreshAccessToken()
        return fn(newToken)
      }
      throw err
    }
  }

  const user = accessToken ? decodeJwtPayload(accessToken) : null

  const value: AuthContextValue = {
    accessToken,
    user,
    login,
    register,
    completeGoogleLogin,
    logout,
    refreshAccessToken,
    authedFetch,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

export { AuthProvider, useAuth }
