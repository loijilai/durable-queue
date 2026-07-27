import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import {
  ApiError,
  createJob,
  listJobs,
  retryJob,
  type JobStatus,
  type TranscriptionJob,
} from "../lib/api.ts";

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

function stepState(
  stepStatus: JobStatus,
  job: TranscriptionJob,
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

function JobStep({ status, label, job }: { status: JobStatus; label: string; job: TranscriptionJob }) {
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
function JobTimeline({ job }: { job: TranscriptionJob }) {
  return (
    <div className="job-timeline">
      <JobStep status="pending" label="Pending" job={job} />
      <JobStep status="running" label="Running" job={job} />
      <JobStep status="succeeded" label="Succeeded" job={job} />
      <JobStep status="failed" label="Failed" job={job} />
    </div>
  );
}

// worker_attempts 只存 {host, at}，沒存結果——結果從「位置 + job 狀態」推斷：
// 非最後一筆 = 被後續認領取代（那台掛了）；最後一筆看 job 現在的狀態。
function attemptState(
  isLast: boolean,
  jobStatus: JobStatus,
): { label: string; cls: string } {
  if (!isLast) return { label: "handed off", cls: "attempt-dead" };
  switch (jobStatus) {
    case "running":
      return { label: "running here", cls: "attempt-active" };
    case "succeeded":
      return { label: "succeeded here", cls: "attempt-done" };
    case "failed":
      return { label: "failed here", cls: "attempt-failed" };
    default:
      return { label: "ended, awaiting re-claim", cls: "attempt-dead" };
  }
}

function AuditTrail({ job }: { job: TranscriptionJob }) {
  const attempts = job.worker_attempts ?? [];
  if (attempts.length === 0) {
    return <p className="audit-empty">No worker has claimed this job yet.</p>;
  }
  return (
    <ol className="audit-trail">
      {attempts.map((a, i) => {
        const { label, cls } = attemptState(i === attempts.length - 1, job.status);
        return (
          <li key={i} className={`audit-row ${cls}`}>
            <span className="audit-dot" />
            <code className="audit-host">{a.host}</code>
            <span className="audit-state">{label}</span>
            <span className="audit-time">
              {new Date(a.at).toLocaleTimeString()}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function QueuePage() {
  const { accessToken, authedFetch } = useAuth();
  const [videoUrl, setVideoUrl] = useState("");
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<number, string>>({});
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  function toggleExpanded(id: number) {
    setExpandedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasActiveJob = jobs.some((j) => !TERMINAL_STATUSES.includes(j.status));

  // 進頁面先把使用者現有的 job 歷史抓回來——不只是這次 session 建立的那一批。
  useEffect(() => {
    if (!accessToken) return;
    authedFetch((token) => listJobs(token))
      .then(setJobs)
      .catch(() => {
        // 初次載入失敗就維持空列表，使用者仍可以送出新 job
      });
  }, [accessToken, authedFetch]);

  // 輪詢：list 裡只要還有非 terminal 狀態的 job，每 2 秒打一次 GET /api/jobs/，
  // 一次 request 換回全部 job 的最新狀態，而不是每個 job 各開一條輪詢。
  // 用 authedFetch 包起來，遇到 401（access token 過期）會自動 refresh 一次再重試。
  useEffect(() => {
    if (!accessToken || !hasActiveJob) {
      return;
    }

    const id = setInterval(async () => {
      try {
        const updated = await authedFetch((token) => listJobs(token));
        setJobs(updated);
      } catch {
        // 輪詢中的暫時性失敗（含 refresh 也失敗）不中斷 loop，下一次 tick 再試
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [accessToken, hasActiveJob, authedFetch]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await authedFetch((token) => createJob(token, videoUrl));
      setJobs((prev) => [created, ...prev]);
      setVideoUrl("");
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
      const updated = await authedFetch((token) => retryJob(token, id));
      // retry 把該 job 重設回 PENDING 並清掉 error/finished_at（見後端 retry_job）；
      // 換掉 list 裡對應那一筆，hasActiveJob 會自動變 true，輪詢 effect 自己接手繼續追蹤。
      setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
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
        Submit a YouTube URL to create a job. The API responds immediately with
        a job id — the transcription itself runs asynchronously in a background
        worker. This page polls the real job status endpoint to show that state
        machine as it happens.
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
            {jobs.map((j) => (
              <div key={j.id} className="job-card">
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
                {j.status === "succeeded" && j.transcript && (
                  <p className="job-transcript">{j.transcript}</p>
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
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default QueuePage;
