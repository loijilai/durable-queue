import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ExcalidrawDiagram from "../components/ExcalidrawDiagram.tsx";
import DiagramLightbox from "../components/DiagramLightbox.tsx";
import { AUTH_ATTACK_SCENES, authSequenceScene } from "../lib/diagramScenes.ts";

// 每個攻擊鏡頭都是這張全圖的一個取景框，讀者想確認「這一格在整條流程的哪裡」
// 時，得能把原圖叫出來對照——不然就得離開這頁去 Auth 頁再找回來。
const FULL_SEQUENCE_LABEL = "Google OIDC authorization-code login sequence";

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
  // 攻擊鏡頭專用：沒有這道檢查會發生什麼。刻意跟 caption 分開兩段——
  // 「代價」和「機制」混在同一段裡，讀者只會記得後者。
  stakes?: string;
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
      "TLS terminates at the ALB against an ACM certificate; :80 exists only to 301 clients up to :443. Inside the VPC traffic is plaintext — a deliberate trade-off that leans on the two boundaries above.",
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
      "The runner holds no AWS key. It presents a GitHub OIDC id_token and STS hands back credentials that expire with the job — so there is nothing in the repository to leak, and nothing to rotate. The role it lands in is least-privilege, with iam:PassRole pinned to a single role ARN.",
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

// ── ③ APP（authentication）：三種變成別人的方式 ────────────────────
// Auth 頁已經完整畫過 authorization code flow 了，這裡不重畫流程——重畫
// 就只是炒冷飯。security 圖要回答的不是「登入怎麼運作」而是「不做這個檢查
// 會怎樣」，所以主角換成攻擊者：舞台（lane 幾何）跟 Auth 頁那張是同一個，
// 但正常流程壓灰，亮起來的是攻擊箭頭和擋下它的那一格。
// 攻擊者沒有自己的 lane——多一條會讓圖變寬、也對不上原圖的幾何；攻擊改成
// 既有訊息「被冒名頂替」的樣子，靠紅色講清楚它是敵人。
// 三個鏡頭的排序是「越後面越像設計判斷」：state 是 table stakes，aud 檢查
// 是中段，account linking 是唯一一個沒有標準答案、要自己想威脅模型的。
// 圖源 docs/auth-sequence-google-oidc.excalidraw（Auth 頁用的同一張）。
// 改圖：編輯那張 → python3 docs/8-auth-attacks.build.py。
// 三張圖都是同一張場景上的 760×600 取景框，只是框的位置不同：全圖 1520 寬、
// 欄位只有 760，整張放進來等於 0.5×，13px 的字到螢幕上剩 6px，而且畫面九成
// 是這個鏡頭不談的步驟。框固定大小所以切 tab 不會跳，框往下移所以 tab 條順
// 便變成一條登入時序的 scrub。散文留在這裡而不是畫進圖裡——畫進去就會被取景
// 倍率一起縮放，而且框馬上被撐開。
const LOGIN_LENSES: Lens[] = [
  {
    id: "state",
    tab: "Login CSRF / replay",
    scene: AUTH_ATTACK_SCENES.state,
    stakes:
      "The attacker starts a login as themselves, then makes the victim's browser deliver the resulting callback — or replays a callback URL captured once. Either way the victim's account ends up bound to the attacker's Google identity, and they can sign in as the victim from then on.",
    caption: "",
  },
  {
    id: "verify",
    tab: "Token for another app",
    scene: AUTH_ATTACK_SCENES.token,
    stakes:
      "An id_token is signed by Google no matter which application asked for it, so the signature on its own proves nothing about who the token is for. Decode-and-trust means any developer with a Google client can mint a token for their own app and present it here as one of our users.",
    caption: "",
  },
  {
    id: "binding",
    tab: "Account takeover by email",
    scene: AUTH_ATTACK_SCENES.linking,
    stakes:
      "The attacker signs up to Google with an address that already has a local account here. If the callback matched on email, this login would be linked straight into the victim's account — a full takeover, with no password ever entered.",
    caption: "",
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

// action：跟這組鏡頭有關的一顆按鈕，掛在 tab 條的右端。它是圖的工具列的一
// 部分，自己佔一行會被讀成內文。
function LensFigure({
  lenses,
  label,
  action,
}: {
  lenses: Lens[];
  label: string;
  action?: ReactNode;
}) {
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
        {action ? <div className="sec-lens-action">{action}</div> : null}
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
        <figcaption>
          {/* stakes 先於 caption：安全圖跟流程圖的差別就在「沒有這個會怎樣」，
              那句話必須先被讀到，機制才有重量。 */}
          {lens.stakes ? (
            <span className="sec-lens-stakes">{lens.stakes}</span>
          ) : null}
          {lens.caption}
        </figcaption>
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
  const [fullSequence, setFullSequence] = useState(false);

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

        <p className="eyebrow sec-subsection-tag">
          <span className="eyebrow-dot" />
          AUTHENTICATION · THREE WAYS TO BECOME SOMEONE ELSE
        </p>
        {/* 圖只講被擋下的東西；流程本身在 Auth 頁，這裡明說一次，讀者才不會
            以為 security 頁欠他一張流程圖。 */}
        <p className="placeholder-body sec-authn-note">
          The happy path is greyed out — it is the same sequence the{" "}
          <Link to="/auth">Auth page</Link> walks through. What is lit here is
          the attack, and the one check that ends it.
        </p>
        {/* 對照鈕掛在 tab 條右端：它服務的是「這一格在全圖的哪裡」這個當下的
            疑問，跟切鏡頭是同一類動作，離圖越近越好。 */}
        <LensFigure
          lenses={LOGIN_LENSES}
          label="login attack lenses"
          action={
            <button
              type="button"
              className="btn-secondary sec-lens-compare"
              onClick={() => setFullSequence(true)}
            >
              ⤢ Open the full login sequence
            </button>
          }
        />
        {fullSequence && (
          <DiagramLightbox
            scene={authSequenceScene}
            label={FULL_SEQUENCE_LABEL}
            onClose={() => setFullSequence(false)}
          />
        )}

        <div className="sec-prober">
          <p className="eyebrow sec-subsection-tag sec-subsection-gap">
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
