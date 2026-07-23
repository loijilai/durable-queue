const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export interface TokenPair {
  access: string
  refresh: string
}

export interface RegisterFields {
  username: string
  email: string
  password: string
}

export interface LoginCredentials {
  username: string
  password: string
}

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(data?.detail ?? 'Request failed', response.status, data)
  }

  return data as T
}

export function registerUser(fields: RegisterFields): Promise<{ username: string; email: string }> {
  return request('/api/auth/register/', {
    method: 'POST',
    body: JSON.stringify(fields),
  })
}

export function login(credentials: LoginCredentials): Promise<TokenPair> {
  return request('/api/auth/token/', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}
