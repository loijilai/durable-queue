import { useState } from "react";

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
}

const LAYERS: Layer[] = [
  {
    id: "infra",
    index: "01",
    tier: "INFRA",
    title: "Network Isolation & Security Group",
  },
  {
    id: "cicd",
    index: "02",
    tier: "CI/CD",
    title: "Pipeline Identity & Secret Management",
  },
  {
    id: "app",
    index: "03",
    tier: "APP",
    title: "Authorization",
  },
];

// ── ① INFRA：一張拓撲圖、三個鏡頭 ──────────────────────────────────
// 三個子題（subnet 隔離 / SG 鏈 / HTTPS）是同一張圖的三個切面，不拆成
// 三張卡——要讓人帶走的是「這是同一個防禦姿態的三個面向」。
// 圖源 docs/diagrams/sources/security-topology.drawio 的 master 頁。
// 改圖後執行 python3 tools/diagrams/build_security_topology.py --export。
// --export，它會重算三個鏡頭頁並覆寫下面這三張 SVG。
interface Lens {
  id: string;
  tab: string;
  caption: string;
  src?: string | null;
}

const TOPOLOGY_LENSES: Lens[] = [
  {
    id: "network",
    tab: "Network boundary",
    src: "/diagrams/sec-topology-network.svg",
    caption:
      "The public subnets hold only the ALB and the NAT gateway. Every compute and data node lives in a private subnet with no public IP — and no security group anywhere opens :22. The admin plane is SSM Session Manager, so there is no bastion and no SSH surface to attack.",
  },
  {
    id: "sg",
    tab: "SG authorization chain",
    src: "/diagrams/sec-topology-sg.svg",
    caption:
      "Each hop authorizes the security group upstream of it rather than a CIDR block, so the boundary follows the resource instead of its IP — instances can scale out or move AZ without a rule change. The worker has zero ingress at all: it is a client that pulls work.",
  },
  {
    id: "tls",
    tab: "Encryption boundary",
    src: "/diagrams/sec-topology-tls.svg",
    caption:
      "TLS terminates at the ALB against an ACM certificate; :80 exists only to 301 clients up to :443. Inside the VPC traffic is plaintext — a deliberate trade-off that leans on the two boundaries above.",
  },
];

// ── ② CI/CD：一次部署的完整路徑、五個步驟 ─────────────────────────
// 跟 ① 的差別是維度：① 是空間（同一張拓撲的三個切面，彼此平行），
// ② 是時間（同一條管線的五個先後步驟）。畫面以右側 next overlay 依序推進，
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

// =====================================================================
// 共用小元件
// =====================================================================

function LensFigure({
  lenses,
  label,
  navigation = "tabs",
}: {
  lenses: Lens[];
  label: string;
  navigation?: "tabs" | "overlay-arrows";
}) {
  const [lensId, setLensId] = useState(lenses[0].id);
  const lensIndex = Math.max(
    lenses.findIndex((lens) => lens.id === lensId),
    0,
  );
  const lens = lenses[lensIndex];
  const previousLens = lenses[(lensIndex - 1 + lenses.length) % lenses.length];
  const nextLens = lenses[(lensIndex + 1) % lenses.length];
  const usesOverlayNavigation = navigation === "overlay-arrows";

  return (
    <div className="sec-lens">
      {!usesOverlayNavigation && (
        <div className="sec-lens-tabs" role="tablist" aria-label={label}>
          {lenses.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === lensId}
              aria-label={item.tab}
              className={`sec-lens-tab${
                item.id === lensId ? " is-active" : ""
              }`}
              onClick={() => setLensId(item.id)}
            >
              {item.tab}
            </button>
          ))}
        </div>
      )}

      <figure className="sec-lens-frame">
        <div className="sec-lens-visual">
          {lens.src ? (
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
          {usesOverlayNavigation && (
            <>
              <button
                type="button"
                className="sec-lens-nav sec-lens-prev"
                onClick={() => setLensId(previousLens.id)}
                aria-label={`Previous ${label}: ${previousLens.tab}`}
              >
                <span aria-hidden="true">{"<"}</span>
              </button>
              <button
                type="button"
                className="sec-lens-nav sec-lens-next"
                onClick={() => setLensId(nextLens.id)}
                aria-label={`Next ${label}: ${nextLens.tab}`}
              >
                <span aria-hidden="true">{">"}</span>
              </button>
            </>
          )}
        </div>
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
        Network isolation, short-lived deploy credentials, and default-deny
        authorization protect the system from infrastructure to individual jobs.
      </p>

      {/* ── SPINE：三張導覽 tile，也是全頁目錄 ──────────────────── */}
      <nav className="sec-spine" aria-label="security layers">
        {LAYERS.map((layer) => (
          <a key={layer.id} href={`#${layer.id}`} className="sec-spine-tile">
            <span className="sec-spine-index">{layer.index}</span>
            <span className="sec-spine-tier">{layer.tier}</span>
            <span className="sec-spine-title">{layer.title}</span>
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
      </section>
    </section>
  );
}

export default SecurityPage;
