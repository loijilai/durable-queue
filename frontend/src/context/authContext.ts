import { createContext } from 'react'
import type { LoginCredentials, RegisterFields, TokenPair } from '../lib/api.ts'
import type { JwtPayload } from '../lib/authStorage.ts'

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

export { AuthContext, type AuthContextValue }
