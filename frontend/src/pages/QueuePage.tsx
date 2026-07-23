import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import {
  ApiError,
  createJob,
  getJob,
  type JobStatus,
  type TranscriptionJob,
} from "../lib/api.ts";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: JobStatus[] = ["succeeded", "failed"];

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
      <span className="job-step-dot" />
      {label}
    </div>
  );
}

// Pending → Running 是線性的，走到 terminal state 後分岔成 Succeeded / Failed 兩條互斥支線，
// 用箭頭把線性段落串起來，terminal 的兩個分支並排放在同一欄，呈現真正的狀態機形狀。
function JobTimeline({ job }: { job: TranscriptionJob }) {
  return (
    <div className="job-timeline">
      <JobStep status="pending" label="Pending" job={job} />
      <span className="job-arrow">→</span>
      <JobStep status="running" label="Running" job={job} />
      <span className="job-arrow">→</span>
      <div className="job-branch">
        <JobStep status="succeeded" label="Succeeded" job={job} />
        <JobStep status="failed" label="Failed" job={job} />
      </div>
    </div>
  );
}

function QueuePage() {
  const { accessToken, authedFetch } = useAuth();
  const [videoUrl, setVideoUrl] = useState("");
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 輪詢：job 存在且還沒進到 terminal state 時，每 2 秒打一次 GET /api/jobs/{id}/。
  // 用 authedFetch 包起來，遇到 401（access token 過期）會自動 refresh 一次再重試。
  useEffect(() => {
    if (!accessToken || !job || TERMINAL_STATUSES.includes(job.status)) {
      return;
    }

    const id = setInterval(async () => {
      try {
        const updated = await authedFetch((token) => getJob(token, job.id));
        setJob(updated);
      } catch {
        // 輪詢中的暫時性失敗（含 refresh 也失敗）不中斷 loop，下一次 tick 再試
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [accessToken, job, authedFetch]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await authedFetch((token) => createJob(token, videoUrl));
      setJob(created);
      setVideoUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
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

          {job && (
            <div className="job-panel">
              <p className="job-meta">
                Job created, now processing asynchronously —{" "}
                <strong>#{job.id}</strong>
              </p>
              <JobTimeline job={job} />
              {job.status === "failed" && job.error && (
                <p className="auth-error">{job.error}</p>
              )}
              {job.status === "succeeded" && job.transcript && (
                <p className="job-transcript">{job.transcript}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default QueuePage;
