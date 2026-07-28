import { useState } from "react";
import ExcalidrawDiagram from "../components/ExcalidrawDiagram.tsx";

// =====================================================================
// 全頁的組織原則：攻擊者進得來的三條路——公開網路、部署管線、一個合法
// 帳號——各由一種控制關上。三節的存在是被這三條路決定的，不是隨便切的。
// 每一節：主題（h2）→ 證據（圖 / 表 / 可跑的東西）。
// =====================================================================

// 一份資料同時餵給上方導覽 tile 和各節標題——導覽和內文因此不可能對不上。
interface Layer {
  id: string;
  index: string;
  tier: string;
  title: string;
  terms: string[];
}

const LAYERS: Layer[] = [
  {
    id: "infra",
    index: "01",
    tier: "INFRA",
    title: "Network Isolation & Authorization",
    terms: [
      "Public / private subnet",
      "Layered SG authorization topology",
      "HTTPS (ACM + ALB)",
    ],
  },
  {
    id: "cicd",
    index: "02",
    tier: "CI/CD",
    title: "Pipeline Identity & Secret Management",
    terms: [
      "GitHub OIDC federation",
      "Secrets Manager",
      "Encrypted remote tfstate",
    ],
  },
  {
    id: "app",
    index: "03",
    tier: "APP",
    title: "Authentication & Authorization",
    terms: [
      "JWT + Google OAuth 2.0",
      "Default-deny permissions",
      "Object-level ownership",
    ],
  },
];

// ── ① INFRA：一張拓撲圖、三個鏡頭 ──────────────────────────────────
// 三個子題（subnet 隔離 / SG 鏈 / HTTPS）是同一張圖的三個切面，不拆成
// 三張卡——要讓人帶走的是「這是同一個防禦姿態的三個面向」。
// 圖源 docs/6-security-topology.drawio 的 master 頁（幾何的單一真相來源）。
// 改圖：在 draw.io 編輯 master → 存檔 → python3 docs/6-security-topology.build.py
// --export，它會重算三個鏡頭頁並覆寫下面這三張 SVG。
interface Lens {
  id: string;
  tab: string;
  caption: string;
  // 有 group 的鏡頭組會改用「組名 + 編號」的 tab 條：打光要細（每一步一格），
  // 標題要粗（三個階段）。連續同 group 的鏡頭收成一組，不用巢狀結構。
  group?: string;
  // 拓撲 / 管線是 draw.io 匯出的 SVG（src）；登入檢查是時序圖，走 repo 裡
  // 既有的 excalidraw 管道（scene = .excalidraw 原始 JSON）。兩者擇一。
  src?: string | null;
  scene?: string | null;
}

const TOPOLOGY_LENSES: Lens[] = [
  {
    id: "network",
    tab: "Network boundary",
    src: "/sec-topology-network.svg",
    caption:
      "The public subnets hold only the ALB and the NAT gateway. Every compute and data node lives in a private subnet with no public IP — and no security group anywhere opens :22. The admin plane is SSM Session Manager, so there is no bastion and no SSH surface to attack.",
  },
  {
    id: "sg",
    tab: "SG authorization chain",
    src: "/sec-topology-sg.svg",
    caption:
      "Each hop authorizes the security group upstream of it rather than a CIDR block, so the boundary follows the resource instead of its IP — instances can scale out or move AZ without a rule change. The worker has zero ingress at all: it is a client that pulls work.",
  },
  {
    id: "tls",
    tab: "Encryption boundary",
    src: "/sec-topology-tls.svg",
    caption:
      "TLS terminates at the ALB against an ACM certificate; :80 exists only to 301 clients up to :443. Inside the VPC traffic is plaintext — a deliberate trade-off that leans on the two boundaries above, and one we name again under Out of Scope.",
  },
];

// ── ② CI/CD：一次部署的完整路徑、五個步驟 ─────────────────────────
// 跟 ① 的差別是維度：① 是空間（同一張拓撲的三個切面，彼此平行），
// ② 是時間（同一條管線的五個先後步驟）。tab 因此帶編號 —— tab 這個元件
// 天生讀作平行選項，不編號的話讀者拿不到順序。
// 打光五格、標題三組：group 相同的連續鏡頭在 UI 上收在同一個組名底下。
// 圖源 docs/7-deploy-pipeline.drawio 的 master 頁（幾何的單一真相來源）。
// 改圖：編輯 master → python3 docs/7-deploy-pipeline.build.py --export。
const PIPELINE_LENSES: Lens[] = [
  {
    id: "seed",
    group: "Secret flow",
    tab: "1",
    src: "/sec-pipeline-1-seed.svg",
    caption:
      "The only plaintext copy of the app secrets sits in a local .env file. One manual put-secret-value writes it into Secrets Manager — it never enters the repository, and it never travels down the pipeline in the steps that follow.",
  },
  {
    id: "identity",
    group: "Deploy identity & state protection",
    tab: "2",
    src: "/sec-pipeline-2-identity.svg",
    caption:
      "The runner holds no AWS key. It presents a GitHub OIDC id_token and STS hands back credentials that expire with the job — so there is nothing in the repository to leak, and nothing to rotate.",
  },
  {
    id: "image",
    group: "Deploy identity & state protection",
    tab: "3",
    src: "/sec-pipeline-3-image.svg",
    caption:
      "Those credentials push one artifact, tagged with the commit SHA. The thing that ships is addressable back to the commit that was tested, and a redeploy of the same SHA is the same bytes.",
  },
  {
    id: "state",
    group: "Deploy identity & state protection",
    tab: "4",
    src: "/sec-pipeline-4-state.svg",
    caption:
      "The same credentials read and write Terraform's state, which records real infrastructure and resolved secret ARNs. That makes the bucket a secret in its own right: encrypted at rest, versioned, and blocked from public access.",
  },
  {
    id: "boot",
    group: "Runtime",
    tab: "5",
    src: "/sec-pipeline-5-boot.svg",
    caption:
      "The instance refresh replaces the machine, and the new one authenticates as itself. Its instance profile pulls that same commit SHA and fetches the secrets, which land as environment variables inside the container and nowhere else.",
  },
];

// 這張表真正要說的話是最後一欄：user_data 存在 instance metadata 裡，只有
// base64、沒有加密，任何碰得到那台機器的人都讀得到。所以「可不可以出現在
// user_data」就是機密與否的判準——分類不是憑感覺分的。no / no / yes 讀完，
// 三個來源為什麼走三條不同的路就講完了。
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
    delivery: "Secrets Manager",
  },
  {
    source: "App secret",
    origin: "Developer",
    delivery: "Secrets Manager",
  },
  {
    source: "Config & endpoints",
    origin: "Terraform, computed from other resources",
    delivery: "user_data templated into docker run -e",
  },
];

// ── ③ APP（authentication）：同一趟登入往返上的三道檢查 ────────────
// Auth 頁已經畫過 authorization code flow 了，這裡不重畫流程——主體是
// 「檢查點」，鏡頭切的是「這一道在擋什麼」。時序圖 → 用 excalidraw，
// 跟 repo 既有的分工一致（drawio 畫基礎設施，excalidraw 畫時序/概念）。
// TODO(diagram): 複製 docs/auth-sequence-google-oidc.excalidraw 當底稿，
// 標三組註解另存三份，這裡的 scene 換掉即可。
const LOGIN_LENSES: Lens[] = [
  {
    id: "state",
    tab: "State check",
    caption:
      "/login mints a secrets.token_urlsafe(32) into the session; the callback compares it and immediately pops it. A login CSRF has no valid state to present, and a captured callback URL cannot be replayed a second time.",
    scene: null,
  },
  {
    id: "verify",
    tab: "Token verification",
    caption:
      "The id_token is checked against Google's signing keys and against this client_id — a token minted for a different application is rejected rather than decoded and trusted. The code-for-token exchange happens server-side, so client_secret never leaves the host.",
    scene: null,
  },
  {
    id: "binding",
    tab: "Identity binding",
    caption:
      "Identity is anchored on Google's immutable sub, not on the email address. If a Google login arrives with an email that already has a local account, it is refused rather than silently linked — auto-linking on email is how OAuth account takeover works.",
    scene: null,
  },
];

// ── ③ APP：對真 API 開三槍 ─────────────────────────────────────────
// 順序有意義：先證明沒 token 什麼都拿不到（401），再打出那個 404——此時
// 讀者已經登入了，「我明明有 token，系統連它存在都不告訴我」才有衝擊力，
// 最後 200 當對照組證明系統是活的。
interface Probe {
  id: string;
  label: string;
  request: string;
  expected: number;
  reads: string;
}

const PROBES: Probe[] = [
  {
    id: "anon",
    label: "Call the API with no token",
    request: "GET /api/jobs/",
    expected: 401,
    reads: "DEFAULT_PERMISSION_CLASSES = IsAuthenticated is the global default",
  },
  {
    id: "other",
    label: "Call it with your token, for someone else's job",
    request: "GET /api/jobs/{demo}/",
    expected: 404,
    reads: "Not 403, existence itself does not leak.",
  },
  {
    id: "mine",
    label: "Call it with your token, for your own job",
    request: "GET /api/jobs/{yours}/",
    expected: 200,
    reads: "The same endpoint answers normally for its owner.",
  },
];

function mockProbe(probe: Probe): Promise<number> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(probe.expected), 450),
  );
}

// ── 收尾 ───────────────────────────────────────────────────────────
const THREATS: { threat: string; control: string }[] = [
  {
    threat: "IDOR — reading another user's jobs",
    control: "per-user get_queryset scoping",
  },
  {
    threat: "OAuth login CSRF / replay",
    control: "one-time state + id_token verification",
  },
  {
    threat: "Credential exfiltration from the repo",
    control: "Secrets Manager + instance profile",
  },
  {
    threat: "Direct exposure of the data stores",
    control: "SG-referenced ingress, no public CIDR",
  },
  {
    threat: "Leaked long-lived cloud keys",
    control: "GitHub OIDC AssumeRole, no static keys",
  },
  {
    threat: "CI pipeline privilege escalation",
    control: "PassRole pinned by ARN and service",
  },
  { threat: "Eavesdropping in transit", control: "ACM cert + TLS at the ALB" },
];

const OUT_OF_SCOPE: string[] = [
  "Traffic inside the VPC is plaintext — no TLS between the ALB and the app, none to Redis.",
  "No WAF in front of the ALB — no managed rule sets for common web exploits.",
  "No API rate limiting / throttling — DRF throttle classes are not wired up.",
  "JWTs cannot be revoked — the blacklist app is off, so logout waits out the 15-minute expiry.",
  "No automated secret rotation for the app secret (SECRET_KEY, Google client secret).",
  "No network-flow monitoring — GuardDuty / VPC flow logs are not enabled.",
];

// =====================================================================
// 共用小元件
// =====================================================================

// 一個主體、三個鏡頭。圖框從頭到尾是同一個節點，切 tab 不會有 layout
// jump——視覺上要忠實傳達「圖沒有換，只是鏡頭換了」。
// 連續同 group 的鏡頭收成一組。用 reduce 而不是 Map，是因為順序就是時序，
// 而 group 只會連續出現——不需要能處理交錯的資料結構。
function groupLenses(lenses: Lens[]) {
  return lenses.reduce<{ name?: string; lenses: Lens[] }[]>((groups, lens) => {
    const last = groups[groups.length - 1];
    if (last && last.name === lens.group) last.lenses.push(lens);
    else groups.push({ name: lens.group, lenses: [lens] });
    return groups;
  }, []);
}

function LensFigure({ lenses, label }: { lenses: Lens[]; label: string }) {
  const [lensId, setLensId] = useState(lenses[0].id);
  const lens = lenses.find((l) => l.id === lensId) ?? lenses[0];

  return (
    <div className="sec-lens">
      <div className="sec-lens-tabs" role="tablist" aria-label={label}>
        {groupLenses(lenses).map((group) => (
          <div
            className="sec-lens-group"
            key={group.name ?? group.lenses[0].id}
          >
            {group.name ? (
              <span className="sec-lens-group-name">{group.name}</span>
            ) : null}
            <div className="sec-lens-group-tabs">
              {group.lenses.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="tab"
                  aria-selected={l.id === lensId}
                  aria-label={group.name ? `${group.name} — ${l.tab}` : l.tab}
                  className={`sec-lens-tab${group.name ? " is-step" : ""}${
                    l.id === lensId ? " is-active" : ""
                  }`}
                  onClick={() => setLensId(l.id)}
                >
                  {l.tab}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <figure className="sec-lens-frame">
        {lens.scene ? (
          <ExcalidrawDiagram scene={lens.scene} label={lens.tab} />
        ) : lens.src ? (
          <img src={lens.src} alt={lens.tab} />
        ) : (
          <div
            className="sec-mock"
            role="img"
            aria-label={`${lens.tab} diagram placeholder`}
          >
            <span className="sec-mock-tag">DIAGRAM PENDING</span>
            <span className="sec-mock-name">{lens.tab}</span>
            <span className="sec-mock-hint">
              one .drawio, three layers, three SVG exports
            </span>
          </div>
        )}
        <figcaption>{lens.caption}</figcaption>
      </figure>
    </div>
  );
}

function SectionHead({ layer }: { layer: Layer }) {
  return (
    <div className="sec-section-head">
      <p className="eyebrow sec-section-tag">
        <span className="eyebrow-dot" />
        {layer.index} · {layer.tier}
      </p>
      <h2 className="sec-section-title">{layer.title}</h2>
    </div>
  );
}

// =====================================================================
// 頁面
// =====================================================================
function SecurityPage() {
  const [results, setResults] = useState<Record<string, number | "loading">>(
    {},
  );

  async function runProbe(probe: Probe) {
    setResults((prev) => ({ ...prev, [probe.id]: "loading" }));
    const status = await mockProbe(probe);
    setResults((prev) => ({ ...prev, [probe.id]: status }));
  }

  return (
    <section className="ha-page">
      {/* ── HERO ────────────────────────────────────────────────── */}
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        SECURITY
      </p>
      <h1>Security Control</h1>
      <p className="placeholder-body sec-thesis">
        Three routes into this system — the <em>public internet</em>, the{" "}
        <em>deploy pipeline</em>, and a <em>legitimate user account</em> — each
        closed by a different kind of control.
      </p>

      {/* ── SPINE：三張導覽 tile，也是全頁目錄 ──────────────────── */}
      <nav className="sec-spine" aria-label="security layers">
        {LAYERS.map((layer) => (
          <a key={layer.id} href={`#${layer.id}`} className="sec-spine-tile">
            <span className="sec-spine-index">{layer.index}</span>
            <span className="sec-spine-tier">{layer.tier}</span>
            <span className="sec-spine-title">{layer.title}</span>
            <ul className="sec-spine-terms">
              {layer.terms.map((term) => (
                <li key={term}>{term}</li>
              ))}
            </ul>
          </a>
        ))}
      </nav>

      {/* ── ① INFRA ─────────────────────────────────────────────── */}
      <section id="infra" className="sec-section">
        <SectionHead layer={LAYERS[0]} />

        <LensFigure lenses={TOPOLOGY_LENSES} label="topology lenses" />
      </section>

      {/* ── ② CI/CD ─────────────────────────────────────────────── */}
      <section id="cicd" className="sec-section">
        <SectionHead layer={LAYERS[1]} />

        <LensFigure lenses={PIPELINE_LENSES} label="deploy pipeline lenses" />

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
                  <th>How it reaches the process</th>
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

      {/* ── ③ APP ───────────────────────────────────────────────── */}
      <section id="app" className="sec-section">
        <SectionHead layer={LAYERS[2]} />

        <div className="sec-prober">
          <p className="eyebrow sec-subsection-tag">
            <span className="eyebrow-dot" />
            AUTHORIZATION · TRY IT
          </p>
          <ul className="sec-probe-list">
            {PROBES.map((probe) => {
              const result = results[probe.id];
              const settled = typeof result === "number";
              return (
                <li key={probe.id} className="sec-probe">
                  <div className="sec-probe-head">
                    <div className="sec-probe-what">
                      <span className="sec-probe-label">{probe.label}</span>
                      <code className="sec-probe-request">{probe.request}</code>
                    </div>
                    <div className="sec-probe-action">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => runProbe(probe)}
                        disabled={result === "loading"}
                      >
                        {result === "loading" ? "calling…" : "Send"}
                      </button>
                      <span
                        className={
                          settled
                            ? `sec-status sec-status-${String(result)[0]}xx`
                            : "sec-status sec-status-idle"
                        }
                      >
                        {settled ? result : "—"}
                      </span>
                    </div>
                  </div>
                  {settled && <p className="sec-probe-reads">{probe.reads}</p>}
                </li>
              );
            })}
          </ul>
        </div>

        <p className="eyebrow sec-subsection-tag sec-authn-tag">
          <span className="eyebrow-dot" />
          AUTHENTICATION · THE THREE CHECKS
        </p>
        <LensFigure lenses={LOGIN_LENSES} label="login check lenses" />
      </section>

      {/* ── 收尾 ────────────────────────────────────────────────── */}
      <div className="ha-columns sec-closing">
        <div className="ha-col">
          <p className="eyebrow">
            <span className="eyebrow-dot" />
            THREATS DEFENDED
          </p>
          <ul className="sec-threats">
            {THREATS.map((t) => (
              <li key={t.threat} className="sec-threat-row">
                <span className="sec-threat">{t.threat}</span>
                <span className="sec-threat-arrow" aria-hidden>
                  →
                </span>
                <span className="sec-threat-control">{t.control}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="ha-col">
          <p className="eyebrow">
            <span className="eyebrow-dot" />
            OUT OF SCOPE
          </p>
          <ul className="ha-mechanism sec-gaps">
            {OUT_OF_SCOPE.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default SecurityPage;
