import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  login as loginRequest,
  registerUser,
  type LoginCredentials,
  type RegisterFields,
  type TokenPair,
} from '../lib/api.ts'
import {
  saveTokens,
  getAccessToken,
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
}

const AuthContext = createContext<AuthContextValue | null>(null)

function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() => getAccessToken())

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

  const user = accessToken ? decodeJwtPayload(accessToken) : null

  const value: AuthContextValue = {
    accessToken,
    user,
    login,
    register,
    completeGoogleLogin,
    logout,
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
