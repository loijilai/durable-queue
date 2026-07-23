import type { TokenPair } from './api.ts'

const ACCESS_KEY = 'dq_access_token'
const REFRESH_KEY = 'dq_refresh_token'

export interface JwtPayload {
  token_type: string
  exp: number
  iat: number
  jti: string
  user_id: number
  username?: string
}

export function saveTokens({ access, refresh }: TokenPair): void {
  sessionStorage.setItem(ACCESS_KEY, access)
  sessionStorage.setItem(REFRESH_KEY, refresh)
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_KEY)
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY)
}

export function saveAccessToken(access: string): void {
  sessionStorage.setItem(ACCESS_KEY, access)
}

export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}

// JWT 是 header.payload.signature，用 . 分三段，payload 是 base64url 編碼的 JSON。
// 純解碼、不驗證簽章——前端沒有 secret key，也不需要驗證，只是要「讀出」內容給使用者看。
export function decodeJwtPayload(token: string): JwtPayload {
  const payload = token.split('.')[1]
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  )
  return JSON.parse(json)
}
