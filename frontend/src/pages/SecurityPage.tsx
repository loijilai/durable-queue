import { useState } from "react";
import LensFigure, { type Lens } from "../components/LensFigure.tsx";
import {
  SectionHead,
  SectionSpine,
  type SpineSection,
} from "../components/SectionSpine.tsx";

// =====================================================================
// 全頁的組織原則：攻擊者進得來的兩條路——公開網路、一個合法帳號——各由一種
// 控制關上。部署管線那一條搬到了 Appendix（不在主路線上，被問到再翻）。
// 每一節：主題（h2）→ 證據（圖 / 表 / 可跑的東西）。
// =====================================================================

const LAYERS: SpineSection[] = [
  {
    id: "infra",
    index: "01",
    tier: "INFRA",
    title: "Network Isolation & Security Group",
  },
  {
    id: "app",
    index: "02",
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
const TOPOLOGY_LENSES: Lens[] = [
  {
    id: "network",
    tab: "Network boundary",
    src: "/diagrams/sec-topology-network.svg",
    caption:
      "The public subnets hold only the ALB and the NAT gateway. Every compute and data node lives in a private subnet with no public IP — and no security group anywhere opens :22. There is no admin plane at all: no bastion, no SSM Session Manager, and ECS Exec is off.",
  },
  {
    id: "sg",
    tab: "SG authorization chain",
    src: "/diagrams/sec-topology-sg.svg",
    caption:
      "Each hop authorizes the security group upstream of it rather than a CIDR block, so the boundary follows the resource instead of its IP — tasks can scale out or land in another AZ without a rule change. SG-worker carries no ingress rule at all: outbound only, nothing may open a connection to it.",
  },
  {
    id: "tls",
    tab: "Encryption boundary",
    src: "/diagrams/sec-topology-tls.svg",
    caption:
      "TLS terminates at the ALB against an ACM certificate; :80 exists only to 301 clients up to :443. Inside the VPC traffic is plaintext — a deliberate trade-off that leans on the two boundaries above.",
  },
];

// ── ② APP：對真 API 開三槍 ─────────────────────────────────────────
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
        Network isolation and default-deny authorization protect the system
        from infrastructure to individual jobs.
      </p>

      {/* ── SPINE：兩張導覽 tile，也是全頁目錄 ──────────────────── */}
      <SectionSpine sections={LAYERS} label="security layers" />

      {/* ── ① INFRA ─────────────────────────────────────────────── */}
      <section id="infra" className="sec-section">
        <SectionHead section={LAYERS[0]} />

        <LensFigure lenses={TOPOLOGY_LENSES} label="topology lenses" />
      </section>

      {/* ── ② APP ───────────────────────────────────────────────── */}
      <section id="app" className="sec-section">
        <SectionHead section={LAYERS[1]} />

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
