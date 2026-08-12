import { useState } from "react";
import { Link } from "react-router-dom";
import { BRAND_ICONS, type BrandIconKey } from "../components/brandIconRegistry.ts";
import DiagramLightbox from "../components/DiagramLightbox.tsx";
import JobLifecycle from "../components/JobLifecycle.tsx";

const AWS_DIAGRAM_LABEL = "AWS infrastructure diagram";
const AWS_DIAGRAM_ALT =
  "AWS infrastructure: ALB fronting an API ASG spread across two availability zones, with worker ASG, RDS, and Redis";

/* Hero 圖：hover 左邊的技術層，右邊亮起作用到該層的 deploy stages。
   一層可以對應多個 stage；這是 stack 與 pipeline 的多對多關係，不硬畫成
   一對一。資料來源：.github/workflows/ci-cd.yml。 */

/* 有品牌圖示的用圖示，沒有的（AWS 自家服務）用字母牌 —— 不自行仿畫商標。
   每層只留 tier + primary：解釋的工作交給右邊的 pipeline detail，
   左欄保持成一根乾淨的結構骨架。 */
type Layer = {
  tier: string;
  icons?: BrandIconKey[];
  marks?: string[];
  primary: string;
  next?: { label: string; icon: BrandIconKey };
  detail: string;
};

const STACK: Layer[] = [
  {
    tier: "APPLICATION",
    icons: ["django", "celery", "postgresql", "redis"],
    primary: "Django REST Framework · Celery",
    detail:
      "A push starts the workflow, then Django tests against Postgres before an image is built.",
  },
  {
    tier: "CONTAINER",
    icons: ["docker"],
    primary: "Docker",
    detail:
      "The tested application is packaged once and pushed as an immutable, commit-addressed image.",
  },
  {
    tier: "ORCHESTRATION",
    marks: ["ASG"],
    primary: "EC2 Auto Scaling · ALB",
    // 這一格不是空的，是「還沒升級」。用 whisper 色標，視覺上就分得出來。
    next: { label: "Kubernetes", icon: "kubernetes" },
    detail:
      "An instance refresh replaces the fleet while keeping at least half of its capacity healthy.",
  },
  {
    tier: "INFRASTRUCTURE AS CODE",
    icons: ["terraform"],
    primary: "Terraform",
    detail:
      "Terraform applies the declared infrastructure and keeps its state in a protected remote backend.",
  },
  {
    tier: "CLOUD",
    marks: ["AWS"],
    primary: "AWS",
    detail:
      "GitHub OIDC provides short-lived AWS credentials for infrastructure and deployment changes.",
  },
];

const PIPELINE = [
  {
    label: "commit + push",
    targets: [0],
  },
  {
    label: "test",
    targets: [0],
  },
  {
    label: "build & push",
    targets: [1],
  },
  {
    label: "terraform apply",
    targets: [3, 4],
  },
  {
    label: "roll ASGs",
    targets: [2],
  },
];

function StackFigure() {
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [hoveredLayer, setHoveredLayer] = useState<number | null>(null);
  const currentLayer = hoveredLayer ?? selectedLayer;
  const activeLayer = currentLayer === null ? null : STACK[currentLayer];

  return (
    <figure className="hero-frame">
      <p className="eyebrow hero-frame-eyebrow">
        <span className="eyebrow-dot" />
        THE STACK
      </p>

      <div className="stackfig">
        {/* ── 左：技術堆疊，也是整張圖的互動入口 ───────────────── */}
        <ol className="stack-col">
          {STACK.map((layer, i) => (
            <li
              key={layer.tier}
              className={
                currentLayer !== null && i === currentLayer
                  ? "stack-layer is-lit"
                  : "stack-layer"
              }
            >
              <button
                type="button"
                className="stack-layer-control"
                aria-pressed={i === selectedLayer}
                onMouseEnter={() => setHoveredLayer(i)}
                onMouseLeave={() => setHoveredLayer(null)}
                onFocus={() => setHoveredLayer(i)}
                onBlur={() => setHoveredLayer(null)}
                onClick={() =>
                  setSelectedLayer((selected) => (selected === i ? null : i))
                }
              >
                <span className="stack-glyphs" aria-hidden="true">
                  {layer.marks?.map((mark) => (
                    <span key={mark} className="stack-mark">
                      {mark}
                    </span>
                  ))}
                  {layer.icons?.map((key) => {
                    const Icon = BRAND_ICONS[key];
                    return <Icon key={key} className="stack-icon" />;
                  })}
                </span>

                <span className="stack-text">
                  <span className="stack-tier">{layer.tier}</span>
                  <span className="stack-primary">{layer.primary}</span>
                  {layer.next && (
                    <span className="stack-next">
                      {(() => {
                        const Icon = BRAND_ICONS[layer.next.icon];
                        return <Icon className="stack-next-icon" />;
                      })()}
                      {layer.next.label} — next
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>

        {/* ── 右：只顯示左側所選 layer 對應的 deploy stages ────── */}
        <div className="pipe-col">
          <ol className="pipe-list">
            {PIPELINE.map((stage) => (
              <li
                key={stage.label}
                className={
                  currentLayer !== null && stage.targets.includes(currentLayer)
                    ? "pipe-stage is-active"
                    : "pipe-stage"
                }
              >
                <div className="pipe-stage-content">
                  <span className="pipe-mark" />
                  <span className="pipe-label">{stage.label}</span>
                </div>
              </li>
            ))}
          </ol>
          <figcaption className="pipe-detail">
            {activeLayer?.detail ??
              "Hover or focus a stack layer to see how it moves through CI/CD."}
          </figcaption>
        </div>
      </div>
    </figure>
  );
}

/* 卡片標題直接使用各頁 h1；首頁目錄不再替內頁重寫一套名稱。 */
const ROUTE = [
  {
    to: "/auth",
    index: "01",
    eyebrow: "AUTHENTICATION",
    title: "Login, Register & Inspect Your JWT",
  },
  {
    to: "/queue",
    index: "02",
    eyebrow: "DISTRIBUTED QUEUE",
    title: "Distributed Queue & Async Pattern",
  },
  {
    to: "/durability",
    index: "03",
    eyebrow: "DURABILITY",
    title: "Why every piece of this queue exists",
  },
  {
    to: "/high-availability",
    index: "04",
    eyebrow: "HIGH AVAILABILITY",
    title: "Surviving Instance Loss",
  },
  {
    to: "/scalability",
    index: "05",
    eyebrow: "SCALABILITY",
    title: "Throughput Scales With the Worker Pool",
  },
  {
    to: "/security",
    index: "06",
    eyebrow: "SECURITY",
    title: "Security Control",
  },
];

function HomePage() {
  const [architectureOpen, setArchitectureOpen] = useState(false);

  return (
    <section className="home">
      <div className="hero">
        <p id="home-architecture-title" className="eyebrow">
          <span className="eyebrow-dot" />
          DURABLE QUEUE
        </p>
        <h1>Building a durable job processing system</h1>
        <p className="home-lede">
          Job state lives in Postgres, so work survives worker crashes and
          restarts.
        </p>
      </div>

      <section
        className="home-architecture"
        aria-labelledby="home-architecture-title"
      >
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          SYSTEM ARCHITECTURE
        </p>
        <figure className="home-architecture-figure">
          <button
            type="button"
            className="diagram-zoom-trigger"
            onClick={() => setArchitectureOpen(true)}
            aria-label={`Open ${AWS_DIAGRAM_LABEL} full size`}
          >
            <img src="/diagrams/aws-infra.svg" alt={AWS_DIAGRAM_ALT} loading="lazy" />
            <span className="diagram-zoom-hint">⤢ Click to zoom</span>
          </button>
        </figure>
      </section>

      <JobLifecycle />

      <StackFigure />

      <div className="route">
        <span className="route-watermark" aria-hidden="true">
          THE ROUTE
        </span>
        <p className="eyebrow route-eyebrow">
          <span className="eyebrow-dot" />
          SIX SECTIONS, IN ORDER
        </p>

        <div className="route-grid">
          {ROUTE.map((section) => (
            <Link key={section.to} to={section.to} className="route-card">
              <span className="route-card-index" aria-hidden="true">
                {section.index}
              </span>
              <p className="eyebrow">
                <span className="eyebrow-dot" />
                {section.eyebrow}
              </p>
              <h3>{section.title}</h3>
              <span className="route-card-satellite" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </div>

      {architectureOpen && (
        <DiagramLightbox
          imageSrc="/diagrams/aws-infra.svg"
          label={AWS_DIAGRAM_LABEL}
          onClose={() => setArchitectureOpen(false)}
        />
      )}
    </section>
  );
}

export default HomePage;
