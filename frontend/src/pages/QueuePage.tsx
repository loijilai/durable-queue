import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth.ts";
import {
  ApiError,
  createJob,
  getJob,
  listJobs,
  retryJob,
  type JobStatus,
  type JobSummary,
} from "../lib/api.ts";
import AuditTrail from "../components/AuditTrail.tsx";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: JobStatus[] = ["succeeded", "failed"];

function formatRelativeTime(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function formatDuration(startIso: string, endIso: string): string {
  const totalSec = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec % 60);
  return `${min}m ${sec}s`;
}

// Poll 拿到的 list 順序不保證新到舊，前端自己排序才能讓最新送出的 job 一直釘在最上面。
function sortByCreatedAtDesc(jobs: JobSummary[]): JobSummary[] {
  return [...jobs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// 卡片寬度固定、字型固定，用字元數估算是否會超過收合狀態的 max-height，
// 比量測 DOM scrollHeight 簡單，且對這個 demo 頁面的排版已經足夠準確。
// 字元數來自 summary 的 transcript_length，因為列表拿不到全文。
const TRANSCRIPT_TRUNCATE_LENGTH = 220;

const YOUTUBE_ID_PATTERN =
  /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/;

function getYouTubeThumbnailUrl(videoUrl: string): string | null {
  const match = videoUrl.match(YOUTUBE_ID_PATTERN);
  if (!match) return null;
  return `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
}

function stepState(
  stepStatus: JobStatus,
  job: JobSummary,
): "done" | "active" | "failed" | "upcoming" {
  // succeeded / failed 是互斥的兩個 terminal 分支：走到其中一個，另一個永遠是 upcoming（灰色）。
  if (stepStatus === "succeeded")
    return job.status === "succeeded" ? "done" : "upcoming";
  if (stepStatus === "failed")
    return job.status === "failed" ? "failed" : "upcoming";

  const order: JobStatus[] = ["pending", "running"];
  const stepIndex = order.indexOf(stepStatus);
  // job 進了任一個 terminal state，代表 pending/running 都已經走完了。
  const currentIndex = order.includes(job.status)
    ? order.indexOf(job.status)
    : order.length;
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "upcoming";
}

function JobStep({ status, label, job }: { status: JobStatus; label: string; job: JobSummary }) {
  return (
    <div className={`job-step job-step-${stepState(status, job)}`}>
      <span className="job-step-rail">
        <span className="job-step-dot" />
      </span>
      <span className="job-step-label">{label}</span>
    </div>
  );
}

// 卡片寬度有限，橫向排不下四個節點，改用縱向 stepper（訂單追蹤那種常見 pattern）：
// 由上到下 Pending → Running → Succeeded/Failed，一條連接線貫穿，寬度只吃卡片的一小塊，
// 不管卡片多窄都不會橫向溢出。
function JobTimeline({ job }: { job: JobSummary }) {
  return (
    <div className="job-timeline">
      <JobStep status="pending" label="Pending" job={job} />
      <JobStep status="running" label="Running" job={job} />
      <JobStep status="succeeded" label="Succeeded" job={job} />
      <JobStep status="failed" label="Failed" job={job} />
    </div>
  );
}

function QueuePage() {
  const { accessToken, authedFetch } = useAuth();
  const [videoUrl, setVideoUrl] = useState("");
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<number, string>>({});
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [expandedTranscriptIds, setExpandedTranscriptIds] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  // 逐字稿全文只在 detail 拿得到，取回後快取在這裡，同一筆不重複請求。
  const [transcripts, setTranscripts] = useState<Record<number, string>>({});
  const [transcriptLoadingId, setTranscriptLoadingId] = useState<number | null>(null);
  const [transcriptErrors, setTranscriptErrors] = useState<Record<number, string>>({});

  function toggleExpanded(id: number) {
    setExpandedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 已經取回過的就直接用快取，失敗時回 null 並把訊息留在該列上。
  async function loadTranscript(id: number): Promise<string | null> {
    const cached = transcripts[id];
    if (cached !== undefined) return cached;
    setTranscriptLoadingId(id);
    setTranscriptErrors((prev) => {
      const { [id]: _discard, ...rest } = prev;
      return rest;
    });
    try {
      const detail = await authedFetch((token) => getJob(token, id));
      const transcript = detail.transcript ?? "";
      setTranscripts((prev) => ({ ...prev, [id]: transcript }));
      return transcript;
    } catch (err) {
      setTranscriptErrors((prev) => ({
        ...prev,
        [id]:
          err instanceof ApiError ? err.message : "Could not load transcript",
      }));
      return null;
    } finally {
      setTranscriptLoadingId(null);
    }
  }

  async function toggleTranscriptExpanded(id: number) {
    if (expandedTranscriptIds.has(id)) {
      setExpandedTranscriptIds((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      return;
    }
    // 展開才需要全文，取不回來就維持收合狀態，這一列的其他內容不受影響。
    if ((await loadTranscript(id)) === null) return;
    setExpandedTranscriptIds((cur) => new Set(cur).add(id));
  }

  async function handleCopyTranscript(id: number) {
    const transcript = await loadTranscript(id);
    if (transcript === null) return;
    await navigator.clipboard.writeText(transcript);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  const hasActiveJob = jobs.some((j) => !TERMINAL_STATUSES.includes(j.status));

  const refreshJobs = useCallback(async () => {
    const fetched = await authedFetch((token) => listJobs(token));
    setJobs(sortByCreatedAtDesc(fetched));
  }, [authedFetch]);

  // 進頁面先把使用者現有的 job 歷史抓回來——不只是這次 session 建立的那一批。
  useEffect(() => {
    if (!accessToken) return;
    refreshJobs().catch(() => {
      // 初次載入失敗就維持空列表，使用者仍可以送出新 job
    });
  }, [accessToken, refreshJobs]);

  // 輪詢：list 裡只要還有非 terminal 狀態的 job，每 2 秒打一次 GET /api/jobs/，
  // 一次 request 換回全部 job 的最新狀態，而不是每個 job 各開一條輪詢。
  // 用 authedFetch 包起來，遇到 401（access token 過期）會自動 refresh 一次再重試。
  useEffect(() => {
    if (!accessToken || !hasActiveJob) {
      return;
    }

    const id = setInterval(async () => {
      try {
        await refreshJobs();
      } catch {
        // 輪詢中的暫時性失敗（含 refresh 也失敗）不中斷 loop，下一次 tick 再試
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [accessToken, hasActiveJob, refreshJobs]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      // 201 的 body 只帶 id/status/created_at，湊不出列表要的那一列，所以重抓 list。
      await authedFetch((token) => createJob(token, videoUrl));
      setVideoUrl("");
      await refreshJobs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry(id: number) {
    setRetryingId(id);
    setRetryErrors((prev) => {
      const { [id]: _discard, ...rest } = prev;
      return rest;
    });
    try {
      await authedFetch((token) => retryJob(token, id));
      // 202 沒有 body，而且 worker 可能已經把狀態推進了，所以重抓 list 而不是自己拼一筆；
      // 重抓後該 job 必為非終態，hasActiveJob 變 true，輪詢 effect 自己接手繼續追蹤。
      // retry 會清掉逐字稿，快取的全文跟著作廢。
      setTranscripts((prev) => {
        const { [id]: _discard, ...rest } = prev;
        return rest;
      });
      setExpandedTranscriptIds((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      await refreshJobs();
    } catch (err) {
      setRetryErrors((prev) => ({
        ...prev,
        [id]: err instanceof ApiError ? err.message : "Retry failed",
      }));
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <section className="queue-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        CORE FEATURE
      </p>
      <h1>Distributed Queue & Async Pattern</h1>
      <p className="placeholder-body">
        Submit a YouTube URL, get a job ID immediately, and watch its
        asynchronous state machine progress.
      </p>

      {!accessToken && (
        <div className="queue-card">
          <p>
            You need to be logged in to create jobs.{" "}
            <Link to="/auth">Go to Authentication</Link>.
          </p>
        </div>
      )}

      {accessToken && (
        <div className="queue-card">
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              YouTube URL
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                required
              />
            </label>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit job"}
            </button>
          </form>
        </div>
      )}

      {accessToken && jobs.length > 0 && (
        <>
          <p className="eyebrow job-board-eyebrow">
            <span className="eyebrow-dot" />
            YOUR JOBS
          </p>
          <div className="job-board">
            {jobs.map((j) => {
              const thumbnailUrl = getYouTubeThumbnailUrl(j.video_url);
              const transcriptExpanded = expandedTranscriptIds.has(j.id);
              const transcriptLoading = transcriptLoadingId === j.id;
              // 收合時 500 字的預覽就足以填滿被裁切的框；展開後才用取回的全文。
              const transcriptText = transcripts[j.id] ?? j.transcript_preview;
              return (
              <div key={j.id} className="job-card">
                {thumbnailUrl && (
                  <img
                    className="job-thumbnail"
                    src={thumbnailUrl}
                    alt=""
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <p className="job-meta">
                  <strong>#{j.id}</strong> — {j.video_url}
                </p>
                <p className="job-timestamp">
                  {j.finished_at
                    ? `Completed in ${formatDuration(j.created_at, j.finished_at)}`
                    : `Created ${formatRelativeTime(j.created_at)}`}
                </p>
                <JobTimeline job={j} />
                {j.status === "failed" && j.error && (
                  <p className="auth-error">{j.error}</p>
                )}
                {j.status === "succeeded" && j.transcript_preview && (
                  <div className="job-transcript-block">
                    <button
                      type="button"
                      className="btn-copy-transcript"
                      title={copiedId === j.id ? "Copied" : "Copy transcript"}
                      aria-label={copiedId === j.id ? "Copied" : "Copy transcript"}
                      onClick={() => handleCopyTranscript(j.id)}
                      disabled={transcriptLoading}
                    >
                      {copiedId === j.id ? (
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path
                            d="M4 10.5L8 14.5L16 5.5"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <rect
                            x="7"
                            y="7"
                            width="10"
                            height="10"
                            rx="2"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          />
                          <path
                            d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          />
                        </svg>
                      )}
                    </button>
                    <p
                      className={
                        transcriptExpanded
                          ? "job-transcript job-transcript-expanded"
                          : "job-transcript"
                      }
                    >
                      {transcriptText}
                    </p>
                    {(j.transcript_length ?? 0) > TRANSCRIPT_TRUNCATE_LENGTH && (
                      <div className="job-transcript-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => void toggleTranscriptExpanded(j.id)}
                          disabled={transcriptLoading}
                        >
                          {transcriptLoading
                            ? "Loading…"
                            : transcriptExpanded
                              ? "Show less"
                              : "Show more"}
                        </button>
                      </div>
                    )}
                    {transcriptErrors[j.id] && (
                      <p className="auth-error">{transcriptErrors[j.id]}</p>
                    )}
                  </div>
                )}
                {j.status === "failed" && (
                  <>
                    <button
                      type="button"
                      className="btn-secondary btn-retry"
                      onClick={() => handleRetry(j.id)}
                      disabled={retryingId === j.id}
                    >
                      {retryingId === j.id ? "Retrying…" : "Retry"}
                    </button>
                    {retryErrors[j.id] && (
                      <p className="auth-error">{retryErrors[j.id]}</p>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="btn-inspect"
                  onClick={() => toggleExpanded(j.id)}
                  aria-expanded={expandedIds.has(j.id)}
                >
                  {expandedIds.has(j.id) ? "Hide inspector ▴" : "Inspect ▾"}
                </button>
                {expandedIds.has(j.id) && (
                  <div className="job-inspect">
                    <p className="eyebrow audit-eyebrow">
                      <span className="eyebrow-dot" />
                      WORKER AUDIT TRAIL
                    </p>
                    <AuditTrail job={j} />
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export default QueuePage;
