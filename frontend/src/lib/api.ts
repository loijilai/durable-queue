export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface RegisterFields {
  username: string;
  email: string;
  password: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export type JobStatus = "pending" | "running" | "succeeded" | "failed";

export interface TranscriptionJob {
  id: number;
  video_url: string;
  status: JobStatus;
  transcript: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  owner: number;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(data?.detail ?? "Request failed", response.status, data);
  }

  return data as T;
}

// Job endpoint 都要求登入，所以帶一個 accessToken 進來，組成 Authorization: Bearer <token> header。
function authedRequest<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return request(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

export function registerUser(
  fields: RegisterFields,
): Promise<{ username: string; email: string }> {
  return request("/api/auth/register/", {
    method: "POST",
    body: JSON.stringify(fields),
  });
}

export function login(credentials: LoginCredentials): Promise<TokenPair> {
  return request("/api/auth/token/", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

// SIMPLE_JWT 沒開 ROTATE_REFRESH_TOKENS，所以這支只換一顆新的 access token，refresh token 本身不變。
export function refreshAccessToken(
  refresh: string,
): Promise<{ access: string }> {
  return request("/api/auth/token/refresh/", {
    method: "POST",
    body: JSON.stringify({ refresh }),
  });
}

export function createJob(
  token: string,
  videoUrl: string,
): Promise<TranscriptionJob> {
  return authedRequest(token, "/api/jobs/", {
    method: "POST",
    body: JSON.stringify({ video_url: videoUrl }),
  });
}

export function getJob(token: string, id: number): Promise<TranscriptionJob> {
  return authedRequest(token, `/api/jobs/${id}/`);
}

// JobCreateView 是 ListCreateAPIView，GET 已經內建 list（依 owner 過濾）能力。
export function listJobs(token: string): Promise<TranscriptionJob[]> {
  return authedRequest(token, "/api/jobs/");
}

// 後端只接受對 FAILED 狀態的 job 呼叫，否則回 409（見 jobs/services.py retry_job）。
export function retryJob(token: string, id: number): Promise<TranscriptionJob> {
  return authedRequest(token, `/api/jobs/${id}/retry/`, { method: "POST" });
}
