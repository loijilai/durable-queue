import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import {
  ApiError,
  API_BASE_URL,
  createJob,
  getJob,
  pingHealth,
  type JobStatus,
  type TranscriptionJob,
} from "../lib/api.ts";
import AuditTrail from "../components/AuditTrail.tsx";
import DiagramLightbox from "../components/DiagramLightbox.tsx";
import Foldout from "../components/Foldout.tsx";

const DIAGRAM_LABEL = "AWS infrastructure diagram";
const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: JobStatus[] = ["succeeded", "failed"];
const DEMO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
// 記住這次 demo 的 job id，切頁 unmount 後回來能重抓還原（後端是真相來源）。
const DEMO_JOB_KEY = "ha-scenario-a-job-id";

// 場景 B 是對真實 AWS、預錄的。放上錄影連結就會取代下方的 placeholder。
const RECORDING_URL = "";

const PROBE_INTERVAL_MS = 1000;
const PROBE_WINDOW = 39;
const PROBE_TIMEOUT_MS = 3000;
// 切頁 unmount 會清掉 probe 狀態，存一份到 sessionStorage，回來還原並自動續跑。
const PROBE_KEY = "ha-scenario-b-probe";

interface Sample {
  ok: boolean;
}

interface ProbeState {
  strip: Sample[];
  stats: { total: number; failed: number; streak: number };
  running: boolean;
}

function loadProbe(): ProbeState {
  const empty: ProbeState = {
    strip: [],
    stats: { total: 0, failed: 0, streak: 0 },
    running: false,
  };
  try {
    const raw = sessionStorage.getItem(PROBE_KEY);
    return raw ? (JSON.parse(raw) as ProbeState) : empty;
  } catch {
    return empty;
  }
}

// 持續探測 /health/（ALB health check 打的同一支，AllowAny、不碰 DB），
// 把每次請求成敗畫成一條連續性 strip。預錄 terminate 全程這條探針不該斷。
function HealthProbe() {
  const [strip, setStrip] = useState<Sample[]>(() => loadProbe().strip);
  const [stats, setStats] = useState(() => loadProbe().stats);
  const [running, setRunning] = useState(() => loadProbe().running);

  // strip/stats/running 一有變動就存起來，切頁回來用 loadProbe 還原。
  useEffect(() => {
    sessionStorage.setItem(
      PROBE_KEY,
      JSON.stringify({ strip, stats, running }),
    );
  }, [strip, stats, running]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    async function tick() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const ok = await pingHealth(controller.signal);
      clearTimeout(timer);
      if (cancelled) return;
      setStrip((prev) => [...prev, { ok }].slice(-PROBE_WINDOW));
      setStats((prev) => ({
        total: prev.total + 1,
        failed: prev.failed + (ok ? 0 : 1),
        streak: ok ? prev.streak + 1 : 0,
      }));
    }
    tick();
    const id = setInterval(tick, PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running]);

  const uptime =
    stats.total === 0
      ? "—"
      : (((stats.total - stats.failed) / stats.total) * 100).toFixed(1);

  function toggle() {
    if (!running) {
      // 每次重新開始都清空，讓數字對得上這一輪 demo
      setStrip([]);
      setStats({ total: 0, failed: 0, streak: 0 });
    }
    setRunning((r) => !r);
  }

  return (
    <div className="queue-card hp-card">
      <div className="hp-head">
        <button type="button" className="btn-primary" onClick={toggle}>
          {running ? "Stop probe" : "Start probe"}
        </button>
        <span className="hp-target">
          target:{" "}
          <code>{API_BASE_URL || "(VITE_API_BASE_URL unset)"}/health/</code>
        </span>
      </div>

      <p className="eyebrow audit-eyebrow">
        <span className="eyebrow-dot" />
        REQUEST CONTINUITY
      </p>
      <div className="hp-strip" aria-label="request continuity strip">
        {strip.length === 0 ? (
          <span className="hp-strip-empty">
            Start the probe to watch live request continuity.
          </span>
        ) : (
          strip.map((s, i) => (
            <span
              key={i}
              className={`hp-tick ${s.ok ? "hp-tick-ok" : "hp-tick-fail"}`}
            />
          ))
        )}
      </div>

      <dl className="hp-stats">
        <div>
          <dt>requests</dt>
          <dd>{stats.total}</dd>
        </div>
        <div>
          <dt>failed</dt>
          <dd className={stats.failed > 0 ? "hp-bad" : undefined}>
            {stats.failed}
          </dd>
        </div>
        <div>
          <dt>uptime</dt>
          <dd>{uptime === "—" ? "—" : `${uptime}%`}</dd>
        </div>
        <div>
          <dt>consecutive OK</dt>
          <dd>{stats.streak}</dd>
        </div>
      </dl>
    </div>
  );
}

function HighAvailabilityPage() {
  const { accessToken, authedFetch } = useAuth();
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

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
        HIGH AVAILABILITY
      </p>
      <h1>Surviving Instance Loss</h1>
      <p className="placeholder-body">
        The stateless tier — API and workers — runs on ASGs spread across two
        AZs with <code>desired=2</code>, so it is already HA. Two failure
        scenarios make that concrete: a worker crash that loses no work, and an
        API instance loss that never breaks the frontend.
      </p>

      {/* ── Scenario A ─────────────────────────────────────────── */}
      <div className="ha-scenario">
        <p className="eyebrow ha-scenario-tag">
          <span className="eyebrow-dot" />
          SCENARIO A · WORKER CRASH
        </p>
        <h2 className="ha-scenario-title">Worker Crash Without Losing Work</h2>
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

        <Foldout title="HOW TO RUN · WHY IT SURVIVES">
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
                  Click <strong>Start scenario A</strong>. A worker claims the
                  job — the first audit entry shows <em>running here</em>.
                </li>
                <li>
                  While it is RUNNING, find the busy worker (
                  <code>docker ps</code>) and{" "}
                  <code>docker kill &lt;id&gt;</code>.
                </li>
                <li>
                  After ~30s (the visibility timeout) another worker re-claims
                  it, and the job still reaches SUCCEEDED.
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
                  after the task completes, so a crash mid-run leaves it
                  un-ACKed and Redis redelivers it.
                </li>
                <li>
                  <strong>visibility timeout</strong> — how long an un-ACKed
                  task waits before redelivery (set to 30s here so the demo is
                  snappy).
                </li>
                <li>
                  <strong>idempotency guard</strong> — skips jobs already in a
                  terminal state, so redelivery can never double-write a
                  finished job.
                </li>
              </ul>
            </div>
          </div>
        </Foldout>
      </div>

      {/* ── Scenario B ─────────────────────────────────────────── */}
      <div className="ha-scenario">
        <p className="eyebrow ha-scenario-tag">
          <span className="eyebrow-dot" />
          SCENARIO B · API INSTANCE LOSS
        </p>
        <h2 className="ha-scenario-title">API Instance Loss, Zero Downtime</h2>
        <p className="placeholder-body">
          Terminate one API EC2 in the AWS console. The ALB health check marks
          it unhealthy and drains traffic to the surviving instance; the ASG
          replaces it minutes later.
        </p>

        <HealthProbe />

        <figure className="ha-diagram">
          <button
            type="button"
            className="diagram-zoom-trigger"
            onClick={() => setZoomed(true)}
            aria-label={`Open ${DIAGRAM_LABEL} full size`}
          >
            <img
              src="/aws-infra.svg"
              alt="AWS infrastructure: ALB fronting an API ASG spread across two availability zones, with worker ASG, RDS, and Redis"
              loading="lazy"
            />
            <span className="diagram-zoom-hint">⤢ Click to zoom</span>
          </button>
          <figcaption>
            The stateless API ASG spans two AZs behind the ALB — losing one
            instance leaves the other serving traffic.
          </figcaption>
        </figure>

        <figure className="ha-recording">
          <figcaption className="eyebrow audit-eyebrow">
            <span className="eyebrow-dot" />
            RECORDED EVIDENCE · REAL AWS
          </figcaption>
          {RECORDING_URL ? (
            <a
              className="ha-recording-link"
              href={RECORDING_URL}
              target="_blank"
              rel="noreferrer"
            >
              ▶ Watch the AWS console terminate + self-heal recording
            </a>
          ) : (
            <p className="ha-recording-slot">
              Recording slot — drop the AWS console clip (EC2 terminate → ALB
              draining → ASG replacement) here. During the interview this plays
              alongside the live probe above.
            </p>
          )}
        </figure>

        <Foldout title="HOW TO RUN · WHY IT SURVIVES">
          <div className="ha-columns">
            <div className="ha-col">
              <p className="eyebrow">
                <span className="eyebrow-dot" />
                HOW TO RUN
              </p>
              <ol className="ha-steps">
                <li>
                  {" "}
                  <strong>Start probe</strong> hits <code>/health/</code> once a
                  second.
                </li>
                <li>
                  In the EC2 console, <strong>terminate</strong> the API
                  instance currently serving traffic.
                </li>
                <li>
                  Watch the probe: the ALB drains the dead target within a
                  couple of health-check intervals, so the strip stays green (or
                  flashes one red then recovers).
                </li>
                <li>
                  Minutes later the ASG launches a replacement to restore{" "}
                  <code>desired=2</code> — no manual step.
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
                  <strong>ALB health check</strong> — probes{" "}
                  <code>/health/</code> and stops routing to a target the moment
                  it fails, so requests only reach live instances.
                </li>
                <li>
                  <strong>stateless API</strong> — JWT auth means any instance
                  can serve any request; losing one drops no session state.
                </li>
                <li>
                  <strong>ASG self-healing</strong> — spread across two AZs with{" "}
                  <code>desired=2</code>, it relaunches to the target count on
                  its own.
                </li>
              </ul>
            </div>
          </div>
        </Foldout>
      </div>

      {zoomed && (
        <DiagramLightbox
          imageSrc="/aws-infra.svg"
          label={DIAGRAM_LABEL}
          onClose={() => setZoomed(false)}
        />
      )}
    </section>
  );
}

export default HighAvailabilityPage;
