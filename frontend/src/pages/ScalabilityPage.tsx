import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth.ts";
import {
  ApiError,
  createJob,
  listJobs,
  type JobStatus,
  type TranscriptionJob,
} from "../lib/api.ts";
import ExcalidrawDiagram from "../components/ExcalidrawDiagram.tsx";
import Foldout from "../components/Foldout.tsx";
import { scaleOutScene } from "../lib/diagramScenes.ts";

const DIAGRAM_LABEL = "worker pool scale-out diagram";
const POLL_INTERVAL_MS = 2000;
const CLOCK_INTERVAL_MS = 250;
const TERMINAL_STATUSES: JobStatus[] = ["succeeded", "failed"];
const DEMO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
// N 選能被 2 和 4 整除的數，兩種 worker 數都跑滿整波，T 才會漂亮砍半。
const BATCH_SIZE = 20;

// 這輪 batch 的 job id：切頁 unmount 後回來用它重抓還原（後端是真相來源）。
// 有值 ⟺ 有一輪還沒結算；結算時清空，這個 invariant 讓 restore/polling 不會重複結算。
const RUN_JOBS_KEY = "scl-run-job-ids";
// 已結算的對照結果，只留最近兩輪。
const RUNS_KEY = "scl-runs";

interface CompletedRun {
  workerCount: number; // 由 distinct worker host 推得——證明負載真的被打散
  seconds: number; // max(finished_at) − min(created_at)，用後端 timestamp 而非 poll 時鐘
  jobCount: number;
  at: string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// T = 這輪最後一個 job 完成 − 第一個 job 建立。並發 submit 讓 created_at 擠在一起，
// 所以 T 由 worker 處理時間主導，2→4 worker 的砍半才乾淨、擋得住質疑。
function computeRun(jobs: TranscriptionJob[]): CompletedRun {
  const created = jobs.map((j) => new Date(j.created_at).getTime());
  const finished = jobs
    .map((j) => (j.finished_at ? new Date(j.finished_at).getTime() : null))
    .filter((t): t is number => t !== null);
  const hosts = new Set<string>();
  for (const j of jobs)
    for (const a of j.worker_attempts ?? []) hosts.add(a.host);
  return {
    workerCount: hosts.size,
    seconds: (Math.max(...finished) - Math.min(...created)) / 1000,
    jobCount: jobs.length,
    at: new Date().toISOString(),
  };
}

function lastHost(job: TranscriptionJob): string | null {
  const attempts = job.worker_attempts ?? [];
  return attempts.length ? attempts[attempts.length - 1].host : null;
}

// 容器 id / EC2 hostname 都很長，只留頭幾碼夠辨識就好。
function shortHost(host: string): string {
  return host.length > 10 ? host.slice(0, 10) : host;
}

function ScalabilityPage() {
  const { accessToken, authedFetch } = useAuth();
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [runJobIds, setRunJobIds] = useState<number[]>(() =>
    loadJson<number[]>(RUN_JOBS_KEY, []),
  );
  const [runs, setRuns] = useState<CompletedRun[]>(() =>
    loadJson<CompletedRun[]>(RUNS_KEY, []),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const running = runJobIds.length > 0;

  useEffect(() => {
    sessionStorage.setItem(RUN_JOBS_KEY, JSON.stringify(runJobIds));
  }, [runJobIds]);
  useEffect(() => {
    sessionStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  }, [runs]);

  // 有一輪在跑就每 2s listJobs、過濾成這輪、更新 GRID；全部 terminal 時結算。
  // runJobIds 非空才跑，所以切頁回來（從 sessionStorage 還原）會自動續跑。
  useEffect(() => {
    if (!accessToken || runJobIds.length === 0) return;
    const idset = new Set(runJobIds);
    let cancelled = false;

    async function poll() {
      try {
        const all = await authedFetch((token) => listJobs(token));
        if (cancelled) return;
        const mine = all.filter((j) => idset.has(j.id));
        setJobs(mine);
        const done =
          mine.length === idset.size &&
          mine.every((j) => TERMINAL_STATUSES.includes(j.status));
        if (done) {
          setRuns((prev) => [...prev, computeRun(mine)].slice(-2));
          setRunJobIds([]); // 清空 → invariant 成立、polling 停、GRID 留最後快照
        }
      } catch {
        // 暫時性失敗不中斷，下一個 tick 再試
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [accessToken, runJobIds, authedFetch]);

  // 只在跑的時候開一個細顆粒時鐘，讓 live elapsed 平滑跳動（結算後的 T 才是準的）。
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running]);

  async function runBatch() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    setJobs([]);
    try {
      // 並發送出 N 個 POST，把 created_at 擠在一起，別讓 submit ramp 稀釋 T。
      const created = await Promise.all(
        Array.from({ length: BATCH_SIZE }, () =>
          authedFetch((token) => createJob(token, DEMO_URL)),
        ),
      );
      setJobs(created);
      setRunJobIds(created.map((j) => j.id)); // 觸發 polling effect
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function resetRuns() {
    setRuns([]);
  }

  const doneCount = jobs.filter((j) =>
    TERMINAL_STATUSES.includes(j.status),
  ).length;

  // live elapsed：從這輪最早 created_at 到現在（純視覺，結算後改秀後端算的 T）。
  const liveElapsed = useMemo(() => {
    if (!running || jobs.length === 0) return null;
    const created = jobs.map((j) => new Date(j.created_at).getTime());
    return (now - Math.min(...created)) / 1000;
  }, [running, jobs, now]);

  // 依 worker 數排序，對照卡永遠讀成「少 → 多」，順序自對。
  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => a.workerCount - b.workerCount),
    [runs],
  );
  const speedup =
    sortedRuns.length === 2 &&
    sortedRuns[0].workerCount !== sortedRuns[1].workerCount &&
    sortedRuns[1].seconds > 0
      ? sortedRuns[0].seconds / sortedRuns[1].seconds
      : null;
  const sameWorkerCount =
    sortedRuns.length === 2 &&
    sortedRuns[0].workerCount === sortedRuns[1].workerCount;

  return (
    <section className="ha-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        SCALE OUT
      </p>
      <h1>Throughput Scales With the Worker Pool</h1>
      <p className="placeholder-body">
        The queue decouples producers from consumers, so workers scale out
        independently and linearly.
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
        <div className="queue-card scl-demo">
          <div className="scl-controls">
            <button
              type="button"
              className="btn-primary"
              onClick={runBatch}
              disabled={submitting || running}
            >
              {submitting
                ? "Submitting…"
                : running
                  ? "Draining…"
                  : `Run batch of ${BATCH_SIZE}`}
            </button>
            <span className="scl-progress">
              {jobs.length > 0
                ? `${doneCount} / ${jobs.length} done`
                : "no batch yet"}
            </span>
            {liveElapsed !== null && (
              <span className="scl-clock">{liveElapsed.toFixed(1)}s</span>
            )}
          </div>
          {error && <p className="auth-error">{error}</p>}

          <p className="eyebrow audit-eyebrow">
            <span className="eyebrow-dot" />
            LIVE JOB GRID
          </p>
          {jobs.length === 0 ? (
            <p className="placeholder-body ha-hint">
              Run a batch to watch {BATCH_SIZE} jobs processing in parallel. You
              can see the load spread across the pool.
            </p>
          ) : (
            <div className="scl-grid" aria-label="live job grid">
              {jobs.map((job) => {
                const host = lastHost(job);
                return (
                  <div
                    key={job.id}
                    className={`scl-cell scl-cell-${job.status}`}
                    title={`#${job.id} · ${job.status}${host ? ` · ${host}` : ""}`}
                  >
                    <span className="scl-cell-id">#{job.id}</span>
                    <span className="scl-cell-status">{job.status}</span>
                    <span className="scl-cell-host">
                      {host ? shortHost(host) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Results: worker count vs drain time ──────────────────── */}
      <div className="scl-results">
        <div className="scl-results-head">
          <p className="eyebrow audit-eyebrow">
            <span className="eyebrow-dot" />
            WORKERS vs DRAIN TIME
          </p>
          {runs.length > 0 && (
            <button type="button" className="scl-reset" onClick={resetRuns}>
              Reset
            </button>
          )}
        </div>

        {runs.length === 0 ? (
          <p className="placeholder-body ha-hint">
            Run one batch with 2 workers, then rescale to 4 and run the same
            batch. The two measurements land here for comparison — worker counts
            are inferred from the distinct hosts that actually did the work.
          </p>
        ) : (
          <>
            <div className="scl-run-table">
              {sortedRuns.map((run) => (
                <div key={run.at} className="scl-run-row">
                  <span className="scl-run-workers">
                    {run.workerCount} worker{run.workerCount === 1 ? "" : "s"}
                  </span>
                  <span className="scl-run-detail">
                    {run.jobCount} jobs drained in
                  </span>
                  <span className="scl-run-time">
                    {run.seconds.toFixed(1)}s
                  </span>
                </div>
              ))}
            </div>
            {speedup && (
              <p className="scl-speedup">
                speedup <strong>×{speedup.toFixed(2)}</strong>
                {speedup >= 1.7 ? " — near-linear scale-out" : ""}
              </p>
            )}
            {sameWorkerCount && (
              <p className="ha-caveat">
                Both runs saw the same worker count — rescale the pool (
                <code>--scale worker=N</code>) between runs to compare.
              </p>
            )}
          </>
        )}
      </div>

      {/* ── How to run / why it scales ───────────────────────────── */}
      <Foldout title="HOW TO RUN · WHY IT SCALES">
        <div className="ha-columns">
          <div className="ha-col">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              HOW TO RUN
            </p>
            <ol className="ha-steps">
              <li>
                Boot the backend with two workers —{" "}
                <code>docker compose up --build --scale worker=2</code>.
              </li>
              <li>
                Click <strong>Run batch of {BATCH_SIZE}</strong> and let the
                grid drain to all SUCCEEDED. The first result row appears.
              </li>
              <li>
                Rescale the pool to four —{" "}
                <code>docker compose up -d --scale worker=4</code> — then run
                the same batch again.
              </li>
              <li>
                Compare the two rows: double the workers, roughly half the drain
                time.
              </li>
            </ol>
          </div>

          <div className="ha-col">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              WHY IT SCALES
            </p>
            <ul className="ha-mechanism">
              <li>
                <strong>queue decoupling</strong> — producers just enqueue; any
                number of consumers pull independently, so adding workers adds
                throughput.
              </li>
              <li>
                <strong>stateless workers</strong> — each worker needs nothing
                from its peers, so the pool scales horizontally with no
                coordination.
              </li>
            </ul>
          </div>
        </div>
      </Foldout>

      {/* ── Architecture diagram ─────────────────────────────────── */}
      <figure className="ha-diagram">
        <ExcalidrawDiagram scene={scaleOutScene} label={DIAGRAM_LABEL} />
        <figcaption>
          The queue decouples the API from the worker pool, so consumers scale
          out independently — solid workers are running now, dashed ones are
          added on scale-out. On AWS each is a real EC2 host, spread across two
          AZs.
        </figcaption>
      </figure>
    </section>
  );
}

export default ScalabilityPage;
