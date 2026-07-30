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

// 場景 B 的兩條路徑都是對真實 AWS、預錄的。放上連結就會取代下方的 placeholder。
const GRACEFUL_RECORDING_URL = "https://youtu.be/1IOtkj5hIEo";
const UNGRACEFUL_RECORDING_URL = "https://youtu.be/s9L_QNKJyRQ";

const PROBE_INTERVAL_MS = 1000;
const PROBE_WINDOW = 39;
const PROBE_TIMEOUT_MS = 3000;
// 切頁 unmount 會清掉 probe 狀態，存一份到 sessionStorage，回來還原並自動續跑。
const PROBE_KEY = "ha-scenario-b-probe";

const HA_CHAPTERS = [
  {
    id: "worker-crash",
    index: "01",
    tier: "WORKER",
    title: "Crash Recovery",
    terms: ["No lost work", "Task redelivery", "Idempotent completion"],
  },
  {
    id: "graceful-shutdown",
    index: "02",
    tier: "API · PLANNED",
    title: "Zero-Downtime Replace",
    terms: [
      "Drain before shutdown",
      "0 failed requests",
      "Health-gated rollout",
    ],
  },
  {
    id: "unexpected-crash",
    index: "03",
    tier: "API · UNPLANNED",
    title: "Bounded Failure",
    terms: [
      "≈20s detection window",
      "~1 in 2 requests fail",
      "Automatic recovery",
    ],
  },
] as const;

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

function getYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    let id: string | null = null;

    if (host === "youtu.be") {
      id = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      id =
        parsed.searchParams.get("v") ??
        parsed.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1] ??
        null;
    }

    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// 預覽只抓靜態縮圖，不載入 YouTube iframe；第三方播放器要等使用者點擊後才開啟。
function RecordingSlot({
  url,
  title,
  description,
  slotHint,
}: {
  url: string;
  title: string;
  description: string;
  slotHint: string;
}) {
  const videoId = getYouTubeVideoId(url);

  return (
    <figure className="ha-recording">
      <figcaption className="eyebrow audit-eyebrow">
        <span className="eyebrow-dot" />
        RECORDED EVIDENCE · REAL AWS
      </figcaption>
      {url ? (
        <a
          className="ha-recording-card"
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Watch ${title} on YouTube`}
        >
          {videoId && (
            <span className="ha-recording-thumbnail">
              <span className="ha-recording-thumbnail-fallback">
                REAL AWS DEMO
              </span>
              <img
                src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
              <span className="ha-recording-play" aria-hidden="true">
                ▶
              </span>
            </span>
          )}
          <span className="ha-recording-body">
            <span className="ha-recording-platform">YouTube demo</span>
            <strong>{title}</strong>
            <span className="ha-recording-description">{description}</span>
            <span className="ha-recording-cta">Watch recording ↗</span>
          </span>
        </a>
      ) : (
        <p className="ha-recording-slot">Recording slot — {slotHint}</p>
      )}
    </figure>
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
        Across two AZs, worker crashes lose no work and API instance loss
        recovers automatically.
      </p>

      <nav className="sec-spine" aria-label="high availability chapters">
        {HA_CHAPTERS.map((chapter) => (
          <a
            key={chapter.id}
            href={`#${chapter.id}`}
            className="sec-spine-tile"
          >
            <span className="sec-spine-index">{chapter.index}</span>
            <span className="sec-spine-tier">{chapter.tier}</span>
            <span className="sec-spine-title">{chapter.title}</span>
            <ul className="sec-spine-terms">
              {chapter.terms.map((term) => (
                <li key={term}>{term}</li>
              ))}
            </ul>
          </a>
        ))}
      </nav>

      {/* ── Scenario A ─────────────────────────────────────────── */}
      <div id="worker-crash" className="ha-scenario">
        <p className="eyebrow ha-scenario-tag">
          <span className="eyebrow-dot" />
          SCENARIO A · WORKER CRASH
        </p>
        <h2 className="ha-scenario-title">Worker Crash Without Losing Work</h2>
        <p className="placeholder-body">
          Kill a worker mid-task. Redis redelivers the job and another worker
          completes it.
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
                Start the demo, then kill the busy worker to see the job
                reassigned.
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
                  <code>docker compose up --build --scale worker=2</code>.
                </li>
                <li>
                  Start scenario A. While the job is RUNNING, find its worker
                  with <code>docker ps</code>, then run{" "}
                  <code>docker kill &lt;id&gt;</code>.
                </li>
                <li>
                  After ~30s, verify a second attempt appears and the job
                  succeeds.
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
                  <strong>Late ACK</strong> — incomplete work is redelivered.
                </li>
                <li>
                  <strong>Visibility timeout</strong> — redelivery starts after
                  30 seconds.
                </li>
                <li>
                  <strong>Idempotency guard</strong> — finished jobs are not
                  written twice.
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
          SCENARIO B · API INSTANCE LIFECYCLE
        </p>
        <h2 className="ha-scenario-title">Two Ways to Lose an API Instance</h2>
        <p className="placeholder-body">
          A planned shutdown drains traffic first. An unexpected crash leaves a
          short failure window until the ALB detects it.
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
            The ALB routes across stateless API instances in two AZs.
          </figcaption>
        </figure>

        {/* ── B1 · graceful ──────────────────────────────────── */}
        <div id="graceful-shutdown" className="ha-block">
          <p className="eyebrow ha-block-tag">
            <span className="eyebrow-dot" />
            B1 · GRACEFUL SHUTDOWN
          </p>
          <h3 className="ha-block-title">Zero Downtime Deploy</h3>
          <ul className="ha-claim">
            <li className="ha-claim-good">failed · 0</li>
            <li className="ha-claim-good">uptime · 100%</li>
            <li>whole fleet replaced</li>
          </ul>
          <p className="placeholder-body">
            CI/CD replaces instances one at a time, draining each old target
            before shutdown.
          </p>

          <RecordingSlot
            url={GRACEFUL_RECORDING_URL}
            title="Zero-Downtime Deployment with ALB Draining"
            description="Instance refresh drains each target before replacement, keeping failed requests at zero."
            slotHint="instance refresh → drain → healthy replacement"
          />

          <Foldout title="HOW TO RUN · WHY IT SURVIVES">
            <div className="ha-columns">
              <div className="ha-col">
                <p className="eyebrow">
                  <span className="eyebrow-dot" />
                  HOW TO RUN
                </p>
                <ol className="ha-steps">
                  <li>Start the probe.</li>
                  <li>
                    Push to <code>master</code> or run the CI/CD workflow.
                  </li>
                  <li>
                    Verify targets drain before replacement and failed requests
                    remain at 0.
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
                    <strong>Draining</strong> — the ALB stops new traffic before
                    shutdown.
                  </li>
                  <li>
                    <strong>50% minimum healthy</strong> — at least one target
                    keeps serving.
                  </li>
                  <li>
                    <strong>Health-gated replacement</strong> — a new stateless
                    instance must pass <code>/health/</code> before serving.
                  </li>
                </ul>
              </div>
            </div>
          </Foldout>
        </div>

        {/* ── B2 · ungraceful ────────────────────────────────── */}
        <div id="unexpected-crash" className="ha-block">
          <p className="eyebrow ha-block-tag">
            <span className="eyebrow-dot" />
            B2 · UNGRACEFUL SHUTDOWN
          </p>
          <h3 className="ha-block-title">Bounded Failure, Self-Healing</h3>
          <ul className="ha-claim">
            <li className="ha-claim-warn">≈20s detection window</li>
            <li className="ha-claim-warn">~1 in 2 requests fail</li>
            <li className="ha-claim-good">no manual step</li>
          </ul>
          <p className="placeholder-body">
            A hard failure cannot drain first. Requests recover once the ALB
            marks the dead target unhealthy.
          </p>

          <RecordingSlot
            url={UNGRACEFUL_RECORDING_URL}
            title="Automatic Recovery After an API Instance Crash"
            description="The ALB detects the dead target and the ASG restores capacity automatically."
            slotHint="hard kill → unhealthy target → ASG replacement"
          />

          <Foldout title="HOW TO RUN · WHY IT SURVIVES">
            <div className="ha-columns">
              <div className="ha-col">
                <p className="eyebrow">
                  <span className="eyebrow-dot" />
                  HOW TO RUN
                </p>
                <ol className="ha-steps">
                  <li>Start the probe and establish a healthy baseline.</li>
                  <li>
                    Terminate one <code>durable-queue-api</code> instance.
                  </li>
                  <li>
                    Observe brief failures, then recovery and automatic
                    replacement.
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
                    <strong>Bounded detection</strong> —{" "}
                    <code>interval 10s</code> ×{" "}
                    <code>unhealthy threshold 2</code> gives a ~20s window.
                  </li>
                  <li>
                    <strong>Round robin</strong> — roughly half of requests hit
                    the dead target until detection.
                  </li>
                  <li>
                    <strong>ASG self-healing</strong> — <code>desired=2</code>{" "}
                    is restored automatically.
                  </li>
                </ul>
              </div>
            </div>
          </Foldout>
        </div>

        {/* ── 收束：兩條路徑的差別就在一個字 ──────────────────── */}
        <div className="ha-contrast">
          <p className="eyebrow audit-eyebrow">
            <span className="eyebrow-dot" />
            DRAINING VS UNHEALTHY
          </p>
          <div className="ha-contrast-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">Graceful</th>
                  <th scope="col">Ungraceful</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Trigger</th>
                  <td>Code push → CI/CD instance refresh</td>
                  <td>EC2 terminate, no warning</td>
                </tr>
                <tr>
                  <th scope="row">Target state</th>
                  <td>
                    <code>draining</code>
                  </td>
                  <td>
                    <code>unhealthy</code>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Order of events</th>
                  <td>ALB removes the target, then the instance shuts down</td>
                  <td>The instance dies, then the ALB detects it</td>
                </tr>
                <tr>
                  <th scope="row">Failed requests</th>
                  <td>0</td>
                  <td>~half during detection</td>
                </tr>
                <tr>
                  <th scope="row">Window</th>
                  <td>none</td>
                  <td>
                    <code>interval</code> × <code>unhealthy_threshold</code> ≈
                    20s
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="ha-caveat">
            The design goal is to drain routine shutdowns and bound the failures
            that cannot be drained.
          </p>
        </div>
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
