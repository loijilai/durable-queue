export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

export async function pingHealth(signal?: AbortSignal): Promise<boolean> {
  if (!API_BASE_URL) return false; // 沒設 base URL：當作後端不可用，不要瞎打
  try {
    const res = await fetch(`${API_BASE_URL}/health/`, { signal });
    if (!res.ok) return false;
    return !(res.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    // 網路錯 / CORS 擋 / timeout 都算一次失敗
    return false;
  }
}

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

export interface WorkerAttempt {
  host: string;
  at: string;
}

// list 的每一筆：不帶逐字稿全文，只帶一段預覽與全文長度。
export interface JobSummary {
  id: number;
  video_url: string;
  status: JobStatus;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  worker_attempts: WorkerAttempt[];
  transcript_preview: string | null;
  transcript_length: number | null;
}

// detail 的回應：唯一帶逐字稿全文的地方。
export interface JobDetail {
  id: number;
  video_url: string;
  status: JobStatus;
  transcript: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  worker_attempts: WorkerAttempt[];
}

// 建立 Job 後的最小回應：指出這個 Job 是誰，完整狀態要另外讀。
export interface JobRef {
  id: number;
  status: JobStatus;
  created_at: string;
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

// 回應是 201 加一個 Location header；body 只夠指出建立了哪一筆，狀態要重抓 list。
export function createJob(token: string, videoUrl: string): Promise<JobRef> {
  return authedRequest(token, "/api/jobs/", {
    method: "POST",
    body: JSON.stringify({ video_url: videoUrl }),
  });
}

// JobCreateView 是 ListCreateAPIView，GET 已經內建 list（依 owner 過濾）能力。
export function listJobs(token: string): Promise<JobSummary[]> {
  return authedRequest(token, "/api/jobs/");
}

// 逐字稿全文只在 detail 拿得到，所以要看全文（展開、複製）時才打這支。
export function getJob(token: string, id: number): Promise<JobDetail> {
  return authedRequest(token, `/api/jobs/${id}/`);
}

// 後端只接受對 FAILED 狀態的 job 呼叫，否則回 409（見 jobs/services.py retry_job）。
// 回應是 202 且沒有 body：已受理而已，最終狀態要重抓 list。
export function retryJob(token: string, id: number): Promise<void> {
  return authedRequest(token, `/api/jobs/${id}/retry/`, { method: "POST" });
}
