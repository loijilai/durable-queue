import { useState, type KeyboardEvent } from "react";

/* Backlog → capacity 控制迴路圖。走 JobLifecycle.tsx 那條路：手寫 SVG，
   每個節點與每條邊都是有 id、可被 state 點亮的元素。理由和那個檔案一樣 ——
   ExcalidrawDiagram 走的是 exportToSvg，產出的是一坨已經 render 完的靜態
   SVG，節點沒有可定址的 id，逐格點亮只能事後撈 DOM，一改圖就壞。

   這一整塊就是一張圖，旁邊不掛說明文字：要講的事由節點、箭頭和節點上的
   數字自己講完，圖因此拿得到整個版面的寬度。

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
  /* 圖上沒有說明文字，所以這個名字只給輔助技術聽 —— 它是這一格唯一的
     文字身分，寫成一句讀得懂的話而不是一個代號。 */
  label: string;
  /* 這一格的「開關」畫在哪裡 —— 使用者點的就是它。四格對應四個節點；
     縮容不是迴路上的一個節點（它是迴路停下來之後才發生的事），所以它的
     開關是畫在環中央的一顆 chip。 */
  control: NodeId | "idle-chip";
  nodes: NodeId[];
  edges: EdgeId[];
};

const STEPS: Step[] = [
  {
    label: "the burst arrives and becomes the Backlog",
    control: "backlog",
    nodes: ["backlog"],
    edges: ["burst"],
  },
  {
    label: "the alarm fires above a Backlog of 1",
    control: "alarm",
    nodes: ["alarm"],
    edges: ["signal"],
  },
  {
    label: "the scaling policy adds two Workers per step",
    control: "policy",
    nodes: ["alarm", "policy"],
    edges: ["trigger"],
  },
  {
    label: "capacity rises and Workers take Jobs, closing the loop",
    control: "worker",
    nodes: ["policy", "worker", "backlog"],
    edges: ["launch", "drain"],
  },
  {
    label: "capacity scales in after three minutes at zero",
    control: "idle-chip",
    nodes: ["policy"],
    edges: ["idle"],
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
      <figcaption>
        <p className="eyebrow hero-frame-eyebrow">
          <span className="eyebrow-dot" />
          THE CONTROL LOOP
        </p>
      </figcaption>

      {/* viewBox 貼齊實際畫到的範圍，不是從 0 0 起算 —— 多留的空白在畫面上
          就是一整條空隙，把圖從框線推開。座標本身不動，只是把鏡頭切齊。 */}
      <svg
        className="cl-svg"
        viewBox="0 54 584 330"
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
          <path key={id} className={edgeCls(id)} d={EDGES[id].d} fill="none" />
        ))}

        {/* ── 節點（同時是控制項） ───────────────────────────── */}
        <g {...controlProps("backlog")} className="cl-control">
          <g className={nodeCls("backlog")}>
            <rect x="66" y="78" width="208" height="84" rx="16" />
            <text className="cl-node-name" x="170" y="112">
              Backlog
            </text>
          </g>
        </g>

        <g {...controlProps("alarm")} className="cl-control">
          <g className={nodeCls("alarm")}>
            <rect x="366" y="78" width="208" height="84" rx="16" />
            <text className="cl-node-name" x="470" y="112">
              alarm
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
        <text className="cl-edge-label cl-anchor-start" x="6" y="100">
          250 Jobs
        </text>
        <text className="cl-edge-label" x="320" y="66">
          Backlog is the signal
        </text>
        <text className="cl-edge-label cl-anchor-start" x="486" y="225">
          add capacity
        </text>
        <text className="cl-edge-label" x="320" y="356">
          ~2 min / step
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
      </svg>
    </figure>
  );
}

export default ControlLoop;
