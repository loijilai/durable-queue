import { useEffect, useState } from "react";
import { API_BASE_URL, pingHealth } from "../lib/api.ts";
import DiagramLightbox from "../components/DiagramLightbox.tsx";
import Foldout from "../components/Foldout.tsx";
import LensFigure, { type Lens } from "../components/LensFigure.tsx";
import RecordingSlot from "../components/RecordingSlot.tsx";
import {
  SectionHead,
  SectionSpine,
  type SpineSection,
} from "../components/SectionSpine.tsx";

// =====================================================================
// 不在主路線上的補充頁：面試走完五站後，被問到才翻的兩章。只從頁尾進入，
// 頁尾的連結直達各章錨點（見 Layout 的 APPENDIX 欄）。
// =====================================================================

const CHAPTERS: SpineSection[] = [
  {
    id: "api-availability",
    index: "01",
    tier: "API AVAILABILITY",
    title: "Two Ways to Lose an API Task",
  },
  {
    id: "pipeline",
    index: "02",
    tier: "CI/CD",
    title: "Pipeline Identity & Secret Management",
  },
];

// ── 01 API AVAILABILITY ─────────────────────────────────────────────
const DIAGRAM_LABEL = "AWS infrastructure diagram";

// API tier 的兩條路徑都是對真實 AWS、預錄的。放上連結就會取代下方的 placeholder。
const GRACEFUL_RECORDING_URL = "https://youtu.be/1IOtkj5hIEo";
const UNGRACEFUL_RECORDING_URL = "https://youtu.be/s9L_QNKJyRQ";
// 兩支錄影拍的是 ECS service 之前那一版部署。頁面上的機制描述跟著 infra 走，
// 所以寧可標註錄影比程式碼舊，也不讓文字退回去配合錄影。
const RECORDING_PROVENANCE =
  "Recorded on the deployment that preceded the current ECS service — the same design, an earlier implementation of it.";

const PROBE_INTERVAL_MS = 1000;
const PROBE_WINDOW = 39;
const PROBE_TIMEOUT_MS = 3000;
// 切頁 unmount 會清掉 probe 狀態，存一份到 sessionStorage，回來還原並自動續跑。
const PROBE_KEY = "appendix-api-probe";

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

// ── 02 PIPELINE：一次部署的完整路徑、五個步驟 ─────────────────────────
// 跟 Security 頁拓撲圖的差別是維度：那張是空間（同一張拓撲的三個切面，
// 彼此平行），這裡是時間（同一條管線的五個先後步驟）。畫面以右側 next overlay 依序推進，
// 第五步再前進會回到第一步。
// 圖源 docs/diagrams/sources/deploy-pipeline.drawio 的 master 頁。
// 改圖後執行 python3 tools/diagrams/build_deploy_pipeline.py --export。
const PIPELINE_LENSES: Lens[] = [
  {
    id: "seed",
    tab: "1",
    src: "/diagrams/sec-pipeline-1-seed.svg",
    caption:
      "The only plaintext copy of the app secrets sits in a local .env file. One manual put-secret-value writes it into Secrets Manager — it never enters the repository, and it never travels down the pipeline in the steps that follow.",
  },
  {
    id: "identity",
    tab: "2",
    src: "/diagrams/sec-pipeline-2-identity.svg",
    caption:
      "The runner holds no AWS key. It presents a GitHub OIDC id_token and STS hands back credentials that expire with the job — so there is nothing in the repository to leak, and nothing to rotate. The role it lands in is least-privilege, with iam:PassRole pinned to a single role ARN.",
  },
  {
    id: "image",
    tab: "3",
    src: "/diagrams/sec-pipeline-3-image.svg",
    caption:
      "Those credentials push one artifact, tagged with the commit SHA. The thing that ships is addressable back to the commit that was tested, and a redeploy of the same SHA is the same bytes.",
  },
  {
    id: "state",
    tab: "4",
    src: "/diagrams/sec-pipeline-4-state.svg",
    caption:
      "The same credentials read and write Terraform's state, which records real infrastructure and resolved secret ARNs. That makes the bucket a secret in its own right: encrypted at rest, versioned, and blocked from public access.",
  },
  {
    id: "boot",
    tab: "5",
    src: "/diagrams/sec-pipeline-5-boot.svg",
    caption:
      "update-service --force-new-deployment starts the rollout, after one standalone migration task on the same image, and update-function-code points the worker Lambda at that same image. Two identities split the work: the execution role resolves the secrets into environment variables at start-up; the task role the application runs as gets the queue, and nothing from Secrets Manager.",
  },
];

// 這張表真正要說的話是最後一欄：task definition 有兩個欄位，`environment`
// 的值明文寫在定義裡，任何讀得到 task definition 的人就讀得到；`secrets` 只
// 放 ARN，由 execution role 在啟動時去解析。所以「該進 environment 還是進
// secrets」就是機密與否的判準——而且這條界線是平台強制的二分，不是靠自律。
// secrets / secrets / environment 讀完，三個來源為什麼走兩條不同的路就講完了。
interface ConfigSource {
  source: string;
  origin: string;
  delivery: string;
  note?: string;
}

const CONFIG_SOURCES: ConfigSource[] = [
  {
    source: "RDS master password",
    origin: "AWS (manage_master_user_password = true)",
    delivery: "secrets: → Secrets Manager ARN",
  },
  {
    source: "App secret",
    origin: "Developer",
    delivery: "secrets: → Secrets Manager ARN",
  },
  {
    source: "Config & endpoints",
    origin: "Terraform, computed from other resources",
    delivery: "environment: → literal value in the task definition",
  },
];

function AppendixPage() {
  const [zoomed, setZoomed] = useState(false);

  return (
    <section className="ha-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        APPENDIX
      </p>
      <h1>Beyond the Route</h1>

      <SectionSpine sections={CHAPTERS} label="appendix chapters" />

      {/* ── 01 API AVAILABILITY ─────────────────────────────────── */}
      <section id="api-availability" className="sec-section">
        <SectionHead section={CHAPTERS[0]} />

        <HealthProbe />

        <div className="ha-architecture-reference">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setZoomed(true)}
            aria-label={`Open ${DIAGRAM_LABEL} full size`}
          >
            ⤢ View AWS architecture diagram
          </button>
        </div>

        {/* ── graceful ─────────────────────────────────────── */}
        <div id="graceful-shutdown" className="ha-block">
          <p className="eyebrow ha-block-tag">
            <span className="eyebrow-dot" />
            GRACEFUL SHUTDOWN
          </p>
          <h3 className="ha-block-title">Zero Downtime Deploy</h3>

          <RecordingSlot
            url={GRACEFUL_RECORDING_URL}
            title="Zero-Downtime Deployment with ALB Draining"
            description="The rolling update drains each target before replacement, keeping failed requests at zero."
            slotHint="rolling update → drain → healthy replacement"
            provenance={RECORDING_PROVENANCE}
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
                    <strong>100% minimum healthy</strong> — healthy capacity
                    never dips below <code>desired_count</code>.
                  </li>
                  <li>
                    <strong>Health-gated replacement</strong> — a new stateless
                    ECS task must pass <code>/health/</code> before the old
                    one is drained.
                  </li>
                </ul>
              </div>
            </div>
          </Foldout>
        </div>

        {/* ── ungraceful ───────────────────────────────────── */}
        <div id="unexpected-crash" className="ha-block">
          <p className="eyebrow ha-block-tag">
            <span className="eyebrow-dot" />
            UNGRACEFUL SHUTDOWN
          </p>
          <h3 className="ha-block-title">API Crash</h3>

          <RecordingSlot
            url={UNGRACEFUL_RECORDING_URL}
            title="Automatic Recovery After an API Task Crash"
            description="The ALB detects the dead target and the ECS service scheduler restores capacity automatically."
            slotHint="hard kill → unhealthy target → scheduler replacement"
            provenance={RECORDING_PROVENANCE}
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
                    Stop one <code>durable-queue-api</code> task with{" "}
                    <code>StopTask</code>.
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
                    <strong>Scheduler self-healing</strong> — the ECS service
                    starts a replacement ECS task to bring the running count
                    back to <code>desired_count=2</code>.
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
                  <td>Code push → CI/CD rolling update</td>
                  <td>StopTask, no warning</td>
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
                  <td>ALB removes the target, then the ECS task shuts down</td>
                  <td>The ECS task dies, then the ALB detects it</td>
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
      </section>

      {/* ── 02 PIPELINE IDENTITY & SECRET MANAGEMENT ────────────── */}
      <section id="pipeline" className="sec-section">
        <SectionHead section={CHAPTERS[1]} />

        <LensFigure
          lenses={PIPELINE_LENSES}
          label="deploy pipeline"
          navigation="overlay-arrows"
        />

        {/* 三個來源匯流成同一組環境變數；分類的依據放在最後一欄 */}
        <div className="sec-secrets">
          <p className="eyebrow sec-subsection-tag">
            <span className="eyebrow-dot" />
            THREE SOURCES, ONE PROCESS
          </p>
          <div className="sec-table-scroll">
            <table className="sec-secret-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Who creates the value</th>
                  <th>Task definition field</th>
                </tr>
              </thead>
              <tbody>
                {CONFIG_SOURCES.map((c) => (
                  <tr key={c.source}>
                    <td className="sec-secret-stage">{c.source}</td>
                    <td className="sec-secret-produced">
                      {c.origin}
                      {c.note ? (
                        <span className="sec-secret-note">{c.note}</span>
                      ) : null}
                    </td>
                    <td className="sec-secret-produced">
                      <code>{c.delivery}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {zoomed && (
        <DiagramLightbox
          imageSrc="/diagrams/aws-infra.svg"
          label={DIAGRAM_LABEL}
          onClose={() => setZoomed(false)}
        />
      )}
    </section>
  );
}

export default AppendixPage;
