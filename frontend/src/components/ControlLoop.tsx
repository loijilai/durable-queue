import { useState, type KeyboardEvent } from "react";

/* Backlog → capacity 控制迴路圖。走 JobLifecycle.tsx 那條路：手寫 SVG，
   每個節點與每條邊都是有 id、可被 state 點亮的元素。理由和那個檔案一樣 ——
   ExcalidrawDiagram 走的是 exportToSvg，產出的是一坨已經 render 完的靜態
   SVG，節點沒有可定址的 id，逐格點亮只能事後撈 DOM，一改圖就壞。

   圖上的每個數字都對得上 infra/worker_autoscaling.tf 與
   issues/scaling-control-loop/11-acceptance-experiment-results.md 的實測值，
   不是示意。參數的推導（為什麼是 step scaling、67 怎麼算出來的）不進圖裡。 */

type NodeId = "backlog" | "alarm" | "policy" | "worker";
type EdgeId = "burst" | "signal" | "trigger" | "launch" | "drain" | "idle";
/* 打錯的 tone 會安靜地產出一個沒有規則的 class name，所以列舉它。 */
type EdgeTone = "ink" | "loop";

/* 每條邊只寫一次 path，讓線條幾何維持單一資料來源。
   drain 是回到起點的那一段 —— 它讓這張圖是環而不是四格流程圖，所以它不跟
   其他邊共用 dust 的未點亮色，而是常駐上色（見 .cl-edge--loop）。它用的是
   Link Blue：那條線上發生的事是 Worker 取走 Job，也就是 DESIGN.md §2 的
   in-progress。這張圖上沒有任何東西是 succeeded，所以沒有綠色。 */
const EDGES: Record<EdgeId, { d: string; tone: EdgeTone }> = {
  burst: { d: "M 16 120 H 62", tone: "ink" },
  signal: { d: "M 274 120 H 362", tone: "ink" },
  trigger: { d: "M 470 168 V 282", tone: "ink" },
  launch: { d: "M 366 330 H 278", tone: "ink" },
  drain: { d: "M 170 282 V 170", tone: "loop" },
  idle: { d: "M 424 226 H 452 V 282", tone: "ink" },
};

type Step = {
  label: string;
  /* 這一格的「開關」畫在哪裡 —— 使用者點的就是它。四格對應四個節點；
     縮容不是迴路上的一個節點（它是迴路停下來之後才發生的事），所以它的
     開關是畫在環中央的一顆 chip。 */
  control: NodeId | "idle-chip";
  nodes: NodeId[];
  edges: EdgeId[];
  detail: string;
};

const STEPS: Step[] = [
  {
    label: "the burst arrives",
    control: "backlog",
    nodes: ["backlog"],
    edges: ["burst"],
    detail:
      "The Batch Submitter's 250 Jobs are all accepted in 6.1 seconds, none rejected, and nothing has run yet — they are the Backlog.",
  },
  {
    label: "the alarm fires",
    control: "alarm",
    nodes: ["alarm"],
    edges: ["signal"],
    detail:
      "The alarm trips when the Backlog goes above 1 — a threshold an Interactive Submitter, sending one Job at a time, can never reach on its own.",
  },
  {
    label: "the scaling policy steps",
    control: "policy",
    nodes: ["alarm", "policy"],
    edges: ["trigger"],
    detail:
      "For as long as the alarm stays in ALARM the policy adds 2 more Workers each time — a fixed step, not a computed jump to whatever count the Backlog implies.",
  },
  {
    label: "capacity rises, Jobs are taken",
    control: "worker",
    nodes: ["policy", "worker", "backlog"],
    edges: ["launch", "drain"],
    detail:
      "Capacity climbs 1 → 3 → 5 … to 17 Workers, and because every Worker takes a Job the Backlog falls and the alarm clears — that arrow back to the Backlog is the loop closing.",
  },
  {
    label: "capacity scales in",
    control: "idle-chip",
    nodes: ["policy"],
    edges: ["idle"],
    detail:
      "Capacity returns to 1 only after the Backlog and In-flight Jobs are both zero for 3 straight minutes — two numbers rather than one, because an empty Backlog does not mean an idle system.",
  },
];

function ControlLoop() {
  const [pinned, setPinned] = useState<number | null>(null);
  const [previewed, setPreviewed] = useState<number | null>(null);

  const current = previewed ?? pinned;
  const active = current === null ? null : STEPS[current];

  const nodeCls = (id: NodeId) =>
    `cl-node cl-node--${id}${active?.nodes.includes(id) ? " is-lit" : ""}`;
  const edgeCls = (id: EdgeId) =>
    `cl-edge cl-edge--${EDGES[id].tone}${active?.edges.includes(id) ? " is-lit" : ""}`;

  /* 圖形本身就是控制項：滑過去預覽、點下去釘住、Enter/Space 等同點擊。
     SVG 的 <g> 沒有內建的按鈕語意，所以 role / tabIndex / 鍵盤事件都要自己補
     —— 少了鍵盤那一段，這張圖就只有滑鼠使用者能操作。 */
  const controlProps = (control: Step["control"]) => {
    const i = STEPS.findIndex((s) => s.control === control);
    return {
      role: "button",
      tabIndex: 0,
      "aria-label": STEPS[i].label,
      "aria-pressed": i === pinned,
      onMouseEnter: () => setPreviewed(i),
      onMouseLeave: () => setPreviewed(null),
      onFocus: () => setPreviewed(i),
      onBlur: () => setPreviewed(null),
      onClick: () => setPinned((held) => (held === i ? null : i)),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setPinned((held) => (held === i ? null : i));
        }
      },
    };
  };

  return (
    <figure className="hero-frame cl-frame">
      <div className="cl-body">
        <svg
          className="cl-svg"
          viewBox="-12 56 624 382"
          role="group"
          aria-label="Control loop: a burst becomes Backlog, the Backlog trips an alarm, the alarm drives the scaling policy, the policy adds Workers, and the Workers take Jobs so the Backlog falls again"
        >
          <defs>
            {/* marker 一個色一顆：CSS 的 marker-end 會跟著 .is-lit 換掉，
                所以箭頭永遠和線同色，不需要 context-stroke（Safari 支援較晚）。 */}
            {[
              ["dust", "var(--dust)"],
              ["ink", "var(--charcoal)"],
              ["loop", "var(--status-running)"],
            ].map(([name, color]) => (
              <marker
                key={name}
                id={`cl-mk-${name}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
              </marker>
            ))}
          </defs>

          {/* ── 邊 ─────────────────────────────────────────────── */}
          {(Object.keys(EDGES) as EdgeId[]).map((id) => (
            <path
              key={id}
              className={edgeCls(id)}
              d={EDGES[id].d}
              fill="none"
            />
          ))}

          {/* ── 節點（同時是控制項） ───────────────────────────── */}
          <g {...controlProps("backlog")} className="cl-control">
            <g className={nodeCls("backlog")}>
              <rect x="66" y="78" width="208" height="84" rx="16" />
              <text className="cl-node-name" x="170" y="112">
                Backlog
              </text>
              <text className="cl-node-value" x="170" y="138">
                peak 245 Jobs waiting
              </text>
            </g>
          </g>

          <g {...controlProps("alarm")} className="cl-control">
            <g className={nodeCls("alarm")}>
              <rect x="366" y="78" width="208" height="84" rx="16" />
              <text className="cl-node-name" x="470" y="112">
                alarm
              </text>
              <text className="cl-node-value" x="470" y="138">
                Backlog &gt; 1
              </text>
            </g>
          </g>

          <g {...controlProps("policy")} className="cl-control">
            <g className={nodeCls("policy")}>
              <rect x="366" y="288" width="208" height="84" rx="16" />
              <text className="cl-node-name" x="470" y="322">
                scaling policy
              </text>
              <text className="cl-node-value" x="470" y="348">
                +2 Workers per step
              </text>
            </g>
          </g>

          <g {...controlProps("worker")} className="cl-control">
            <g className={nodeCls("worker")}>
              <rect x="66" y="288" width="208" height="84" rx="16" />
              <text className="cl-node-name" x="170" y="322">
                Worker
              </text>
              <text className="cl-node-value" x="170" y="348">
                1 → 3 → 5 … 17
              </text>
            </g>
          </g>

          {/* ── 邊上的說明 ─────────────────────────────────────── */}
          <text className="cl-edge-label cl-anchor-start" x="8" y="66">
            250 Jobs in 6.1s · 0 rejected
          </text>
          <text className="cl-edge-label" x="320" y="66">
            Backlog is the signal
          </text>
          <text className="cl-edge-label cl-anchor-start" x="486" y="225">
            add capacity
          </text>
          <text className="cl-edge-label" x="320" y="354">
            ~2 min / step
          </text>

          {/* 回到起點的那一段。它是這張圖之所以是環的全部理由，所以常駐上色、
              常駐標籤，不等使用者滑過去才出現。 */}
          <text className="cl-loop-label" x="154" y="204">
            Workers take Jobs
          </text>
          <text className="cl-loop-label" x="154" y="222">
            Backlog falls
          </text>
          <text className="cl-loop-tag" x="154" y="246">
            THE LOOP CLOSES HERE
          </text>

          {/* 縮容不在環上，它的開關是畫在環中央的 chip。 */}
          <g {...controlProps("idle-chip")} className="cl-control">
            <g
              className={`cl-chip${active?.control === "idle-chip" ? " is-lit" : ""}`}
            >
              <rect x="226" y="208" width="198" height="36" rx="18" />
              <text x="325" y="226">
                scale in · 3 min at zero
              </text>
            </g>
          </g>

          {/* ── 常駐標記：兩個不參與 hover 的邊界 ─────────────── */}
          <g className="cl-marker">
            <rect x="30" y="392" width="196" height="30" rx="15" />
            <text x="128" y="407">
              FLOOR · 1 WORKER
            </text>
          </g>
          <g className="cl-marker">
            <rect x="248" y="392" width="240" height="30" rx="15" />
            <text x="368" y="407">
              SCALING CEILING · 67 WORKERS
            </text>
          </g>
        </svg>

        {/* 說明放在圖旁而不是圖下：讀者的視線在方塊和文字之間來回，
            兩者離得越近，換格時的對應越清楚。 */}
        <figcaption className="cl-side">
          <p className="eyebrow hero-frame-eyebrow">
            <span className="eyebrow-dot" />
            THE CONTROL LOOP — HOVER OR CLICK ANY STEP
          </p>
          {/* aria-live 掛在不會被 key 重建的外層，否則每次換格都是換一個新的
              live region，螢幕閱讀器不一定會念。 */}
          <div className="cl-live" aria-live="polite">
            <p className="cl-current" key={`n${current}`}>
              {active?.label ?? "No step selected"}
            </p>
            <p className="cl-detail" key={`d${current}`}>
              {active?.detail ??
                "Hover, focus, or click a box to follow one turn of the loop."}
            </p>
          </div>
          {/* 釘住與預覽在圖上長得一樣，所以這裡直說目前是哪一種 ——
              否則再點一次取消釘選時，畫面不會有任何回應。 */}
          <p className="cl-hint">
            {pinned === null
              ? "\u00a0"
              : "Pinned — click it again, or press Enter, to release."}
          </p>
        </figcaption>
      </div>
    </figure>
  );
}

export default ControlLoop;
