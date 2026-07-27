import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import {
  ApiError,
  createJob,
  getJob,
  type JobStatus,
  type TranscriptionJob,
} from "../lib/api.ts";
import AuditTrail from "../components/AuditTrail.tsx";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: JobStatus[] = ["succeeded", "failed"];
const DEMO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
// 記住這次 demo 的 job id，切頁 unmount 後回來能重抓還原（後端是真相來源）。
const DEMO_JOB_KEY = "ha-scenario-a-job-id";

function HighAvailabilityPage() {
  const { accessToken, authedFetch } = useAuth();
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = job !== null && !TERMINAL_STATUSES.includes(job.status);

  // 回到頁面（重新 mount）時，用存下的 id 把上次的 demo job 抓回來。
  useEffect(() => {
    if (!accessToken) return;
    const stored = sessionStorage.getItem(DEMO_JOB_KEY);
    if (!stored) return;
    authedFetch((token) => getJob(token, Number(stored)))
      .then(setJob)
      .catch(() => sessionStorage.removeItem(DEMO_JOB_KEY));
  }, [accessToken, authedFetch]);

  // 只追一個 demo job，非 terminal 時每 2 秒打 GET /api/jobs/{id}。
  useEffect(() => {
    if (!accessToken || job === null || !isActive) return;
    const id = setInterval(async () => {
      try {
        setJob(await authedFetch((token) => getJob(token, job.id)));
      } catch {
        // 暫時性失敗不中斷，下一個 tick 再試
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [accessToken, job, isActive, authedFetch]);

  async function startScenario() {
    if (!accessToken) return;
    setStarting(true);
    setError(null);
    try {
      const created = await authedFetch((token) => createJob(token, DEMO_URL));
      sessionStorage.setItem(DEMO_JOB_KEY, String(created.id));
      setJob(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="ha-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        HIGH AVAILABILITY · SCENARIO A
      </p>
      <h1>Worker Crash Without Losing Work</h1>
      <p className="placeholder-body">
        Kill a worker mid-transcription and watch the job survive: the task is
        redelivered, a different worker picks it up, and it still reaches
        SUCCEEDED.
      </p>

      {!accessToken && (
        <div className="queue-card">
          <p>
            You need to be logged in to run this demo.{" "}
            <Link to="/auth">Go to Authentication</Link>.
          </p>
        </div>
      )}

      {accessToken && (
        <div className="queue-card ha-demo">
          <div className="ha-demo-head">
            <button
              type="button"
              className="btn-primary ha-start"
              onClick={startScenario}
              disabled={starting || isActive}
            >
              {starting
                ? "Starting…"
                : isActive
                  ? "Running…"
                  : "Start scenario A"}
            </button>
            {job && (
              <span className={`ha-badge ha-badge-${job.status}`}>
                #{job.id} · {job.status}
              </span>
            )}
          </div>
          {error && <p className="auth-error">{error}</p>}

          {job ? (
            <div className="job-inspect ha-audit">
              <p className="eyebrow audit-eyebrow">
                <span className="eyebrow-dot" />
                WORKER AUDIT TRAIL
              </p>
              <AuditTrail job={job} />
            </div>
          ) : (
            <p className="placeholder-body ha-hint">
              Start the scenario, then kill the busy worker from your terminal
              (steps below) to see a second attempt appear.
            </p>
          )}
        </div>
      )}

      <div className="ha-columns">
        <div className="ha-col">
          <p className="eyebrow">
            <span className="eyebrow-dot" />
            HOW TO RUN
          </p>
          <ol className="ha-steps">
            <li>
              Boot the backend with demo knobs —{" "}
              <code>docker compose up --build --scale worker=2</code>.
            </li>
            <li>
              Click <strong>Start scenario A</strong>. A worker claims the job —
              the first audit entry shows <em>running here</em>.
            </li>
            <li>
              While it is RUNNING, find the busy worker (<code>docker ps</code>)
              and <code>docker kill &lt;id&gt;</code>.
            </li>
            <li>
              After ~30s (the visibility timeout) another worker re-claims it,
              and the job still reaches SUCCEEDED.
            </li>
          </ol>
        </div>

        <div className="ha-col">
          <p className="eyebrow">
            <span className="eyebrow-dot" />
            WHY IT SURVIVES
          </p>
          <ul className="ha-mechanism">
            <li>
              <strong>acks_late</strong> — the message is acknowledged only
              after the task completes, so a crash mid-run leaves it un-ACKed
              and Redis redelivers it.
            </li>
            <li>
              <strong>visibility timeout</strong> — how long an un-ACKed task
              waits before redelivery (set to 30s here so the demo is snappy).
            </li>
            <li>
              <strong>idempotency guard</strong> — <code>mark_running</code>{" "}
              skips jobs already in a terminal state, so redelivery can never
              double-write a finished job.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export default HighAvailabilityPage;
