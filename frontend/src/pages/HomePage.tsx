import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BRAND_ICONS, type BrandIconKey } from "../components/BrandIcons.tsx";
import JobLifecycle from "../components/JobLifecycle.tsx";

/* Hero 圖：左邊是垂直的技術堆疊（結構，靜止），右邊是 deploy pipeline
   （流程，自動跑）。兩者不是兩張圖 —— pipeline 每一站都作用在堆疊的某一層，
   所以 active 的站會把它打到的那幾層一起點亮。這個對應關係是這張圖的重點，
   不是裝飾。資料來源：.github/workflows/ci-cd.yml。 */

/* 有品牌圖示的用圖示，沒有的（AWS 自家服務）用字母牌 —— 不自行仿畫商標。
   每層只留 tier + primary：解釋的工作交給右邊的 pipeline detail，
   左欄保持成一根乾淨的結構骨架。 */
type Layer = {
  tier: string;
  icons?: BrandIconKey[];
  marks?: string[];
  primary: string;
  next?: { label: string; icon: BrandIconKey };
};

const STACK: Layer[] = [
  {
    tier: "APPLICATION",
    icons: ["django", "celery", "postgresql", "redis"],
    primary: "Django REST Framework · Celery",
  },
  {
    tier: "CONTAINER",
    icons: ["docker"],
    primary: "Docker",
  },
  {
    tier: "ORCHESTRATION",
    marks: ["ASG"],
    primary: "EC2 Auto Scaling · ALB",
    // 這一格不是空的，是「還沒升級」。用 whisper 色標，視覺上就分得出來。
    next: { label: "Kubernetes", icon: "kubernetes" },
  },
  {
    tier: "INFRASTRUCTURE AS CODE",
    icons: ["terraform"],
    primary: "Terraform",
  },
  {
    tier: "CLOUD",
    marks: ["AWS"],
    primary: "AWS",
  },
];

const PIPELINE = [
  {
    label: "commit + push",
    targets: [0],
    detail:
      "A push to master is the only trigger. There is no manual deploy step and no clicking through a console.",
  },
  {
    label: "test",
    targets: [0],
    detail:
      "Django’s test suite runs against a real Postgres service container, not a stub — the same engine production uses.",
  },
  {
    label: "build & push",
    targets: [1],
    detail:
      "The image is tagged with the commit SHA, never latest, so every deploy points at one immutable artifact.",
  },
  {
    label: "terraform apply",
    targets: [3, 4],
    detail:
      "State lives in S3, and the runner assumes an AWS role over OIDC — there is no long-lived access key anywhere in the repo.",
  },
  {
    label: "roll ASGs",
    targets: [2],
    detail:
      "Instance refresh at 50% minimum healthy: replacements come up on the new image before the old ones are taken away.",
  },
];

const STEP_MS = 3400;

function StackFigure() {
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState<number | null>(null);

  useEffect(() => {
    if (held !== null) return;
    const id = setInterval(
      () => setStep((s) => (s + 1) % PIPELINE.length),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, [held]);

  const current = held ?? step;
  const active = PIPELINE[current];

  return (
    <figure className="hero-frame">
      <p className="eyebrow hero-frame-eyebrow">
        <span className="eyebrow-dot" />
        THE STACK, AND HOW IT SHIPS
      </p>

      <div className="stackfig">
        {/* ── 左：技術堆疊（靜止結構） ─────────────────────────── */}
        <ol className="stack-col">
          {STACK.map((layer, i) => (
            <li
              key={layer.tier}
              className={
                active.targets.includes(i)
                  ? "stack-layer is-lit"
                  : "stack-layer"
              }
            >
              <div className="stack-glyphs" aria-hidden="true">
                {layer.marks?.map((mark) => (
                  <span key={mark} className="stack-mark">
                    {mark}
                  </span>
                ))}
                {layer.icons?.map((key) => {
                  const Icon = BRAND_ICONS[key];
                  return <Icon key={key} className="stack-icon" />;
                })}
              </div>

              <div className="stack-text">
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
              </div>
            </li>
          ))}
        </ol>

        {/* ── 右：deploy pipeline（自動跑的流程） ───────────────── */}
        <div className="pipe-col">
          <ol className="pipe-list">
            {PIPELINE.map((stage, i) => (
              <li
                key={stage.label}
                className={
                  i === current ? "pipe-stage is-active" : "pipe-stage"
                }
              >
                <button
                  type="button"
                  className="pipe-btn"
                  onMouseEnter={() => setHeld(i)}
                  onMouseLeave={() => setHeld(null)}
                  onFocus={() => setHeld(i)}
                  onBlur={() => setHeld(null)}
                  onClick={() => setStep(i)}
                >
                  <span className="pipe-mark" />
                  <span className="pipe-label">{stage.label}</span>
                </button>
              </li>
            ))}
          </ol>
          <figcaption className="pipe-detail" key={current}>
            {active.detail}
          </figcaption>
        </div>
      </div>
    </figure>
  );
}

/* 每張卡的文案直接對應該頁實際內容 —— 這裡是全站的目錄，寫錯就是說謊。
   description 一律壓成一句：卡片是目錄不是內文，讀者在這裡要做的決定
   只有「進不進去」，多一句都是負擔。 */
const ROUTE = [
  {
    to: "/auth",
    index: "01",
    eyebrow: "AUTHENTICATION",
    title: "Two ways in, one token",
    description:
      "Password or Google OIDC — both end at the same JWT, decoded live in the browser.",
  },
  {
    to: "/queue",
    index: "02",
    eyebrow: "DISTRIBUTED QUEUE",
    title: "Submit a job, poll it to done",
    description:
      "POST returns an id immediately, then real status transitions arrive from the backend.",
  },
  {
    to: "/durability",
    index: "03",
    eyebrow: "DURABILITY",
    title: "Why every piece of this queue exists",
    description:
      "The causal chain from “a worker can die mid-task” down to visibility timeout, locking, and retry.",
  },
  {
    to: "/high-availability",
    index: "04",
    eyebrow: "HIGH AVAILABILITY",
    title: "Surviving instance loss",
    description:
      "Kill a worker mid-job, or lose an API instance — neither breaks the run.",
  },
  {
    to: "/scalability",
    index: "05",
    eyebrow: "SCALABILITY",
    title: "Throughput scales with the worker pool",
    description:
      "Fire a batch and watch it spread across the pool in a live grid.",
  },
  {
    to: "/security",
    index: "06",
    eyebrow: "SECURITY",
    title: "Three routes in, three kinds of control",
    description:
      "The public internet, the deploy pipeline, and a user account — each closed differently.",
  },
];

function HomePage() {
  return (
    <section className="home">
      <div className="hero">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          DURABLE QUEUE
        </p>
        <h1>Building a durable job processing system</h1>
        <p className="home-lede">
          Job state lives in Postgres, not in a worker’s memory — so workers can
          crash and restart without losing work. Six sections walk from the
          login screen down to the network boundary, each with a demo you can
          run against the real backend.
        </p>
      </div>

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
              <p className="route-card-body">{section.description}</p>
              <span className="route-card-satellite" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default HomePage;
