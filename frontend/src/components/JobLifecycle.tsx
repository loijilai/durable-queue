import { useState, type KeyboardEvent } from "react";

/* Job 生命週期圖 —— docs/0-job-lifecycle.excalidraw 的可動版本。
   這裡刻意「不」走 ExcalidrawDiagram 那條路：exportToSvg 產出的是一坨
   已經 render 完的靜態 SVG，節點沒有可定址的 id，要動它只能事後撈 DOM，
   一改圖就壞。所以幾何照抄那張 .excalidraw，但用手寫 SVG 重畫，
   讓每個 node / edge 都是有 id、可被 state 點亮的元素。

   顏色不照抄 .excalidraw 的調色盤，改用 DESIGN.md §2 Job Status Colors。
   全站規則是「一個顏色只代表一件事」：redeliver 那顆在原圖是琥珀色，
   但它的 status 其實還是 running —— 換顏色會讓讀者以為多了第五種狀態。
   這裡改成同樣的藍 + 虛線框 + attempt #2 標籤：同一個狀態，不同次嘗試。 */

type NodeId = "pending" | "running" | "redelivered" | "succeeded" | "failed";
type EdgeId =
  | "enqueue"
  | "pickup"
  | "crash"
  | "redeliver"
  | "success"
  | "fail"
  | "retry";

/* 每條邊只寫一次 path，讓線條幾何維持單一資料來源。 */
const EDGES: Record<EdgeId, { d: string; tone: string }> = {
  enqueue: { d: "M 32 300 H 92", tone: "ink" },
  pickup: { d: "M 248 300 H 346", tone: "blue" },
  crash: { d: "M 392 256 V 200", tone: "red" },
  redeliver: { d: "M 484 200 V 256", tone: "blue" },
  success: { d: "M 530 284 L 706 196", tone: "green" },
  fail: { d: "M 530 316 L 706 376", tone: "red" },
  retry: { d: "M 792 442 V 466 H 170 V 344", tone: "ink" },
};

type Step = {
  label: string;
  /* 這一格的「開關」畫在哪裡 —— 使用者點的就是它。五格對應五個狀態方塊，
     manual retry 沒有自己的狀態（它是一條邊），所以在那條邊上放一顆 chip。 */
  control: NodeId | "retry-chip";
  tone: string;
  nodes: NodeId[];
  edges: EdgeId[];
  detail: string;
};

/* 每一格的文案都對得上 durable_queue/jobs/{services,tasks}.py 的實際行為，
   不是示意 —— 首頁是這個專案的門面，寫錯就是說謊。 */
const STEPS: Step[] = [
  {
    label: "enqueue",
    control: "pending",
    tone: "ink",
    nodes: ["pending"],
    edges: ["enqueue"],
    detail:
      "The row lands in Postgres first, then the task is published to the broker. State lives in the database — the queued message is only a pointer to it.",
  },
  {
    label: "picked up",
    control: "running",
    tone: "blue",
    nodes: ["running"],
    edges: ["pickup"],
    detail:
      "A worker takes the task and calls mark_running(), appending {host, at} to worker_attempts — that list is the record of who ran this job, and how many times.",
  },
  {
    label: "redelivered",
    control: "redelivered",
    tone: "blue",
    nodes: ["running", "redelivered"],
    edges: ["crash", "redeliver"],
    detail:
      "The worker dies before it acks. Because the task is acks_late, the broker hands the same job to a second worker: the status is still running — only the attempt count moved.",
  },
  {
    label: "succeeded",
    control: "succeeded",
    tone: "green",
    nodes: ["running", "succeeded"],
    edges: ["success"],
    detail:
      "The happy branch. mark_succeeded() stores the transcript and stamps finished_at, and the job is done for good.",
  },
  {
    label: "failed",
    control: "failed",
    tone: "red",
    nodes: ["running", "failed"],
    edges: ["fail"],
    detail:
      "The other branch out of the same state. The task raised and its retries are spent, so Task.on_failure records the error on the row.",
  },
  {
    label: "manual retry",
    control: "retry-chip",
    tone: "ink",
    nodes: ["failed", "pending"],
    edges: ["retry"],
    detail:
      "Terminal for the worker is not terminal for the user: retry_job() clears the error and puts the row back to pending. Only a failed job is allowed to take this edge.",
  },
];

function JobLifecycle() {
  const [step, setStep] = useState<number | null>(null);
  const [held, setHeld] = useState<number | null>(null);

  const current = held ?? step;
  const active = current === null ? null : STEPS[current];

  const nodeCls = (id: NodeId, tone: string) =>
    `jl-node jl-node--${tone}${active?.nodes.includes(id) ? " is-lit" : ""}`;
  const edgeCls = (id: EdgeId) =>
    `jl-edge jl-edge--${EDGES[id].tone}${active?.edges.includes(id) ? " is-lit" : ""}`;

  /* 圖形本身就是控制項：滑過去預覽、點下去釘住、Enter/Space 等同點擊。
     SVG 的 <g> 沒有內建的按鈕語意，所以 role / tabIndex / 鍵盤事件都要自己補
     —— 少了鍵盤那一段，這張圖就只有滑鼠使用者能操作。 */
  const controlProps = (control: Step["control"]) => {
    const i = STEPS.findIndex((s) => s.control === control);
    return {
      className: "jl-control",
      role: "button",
      tabIndex: 0,
      "aria-label": STEPS[i].label,
      "aria-pressed": i === step,
      onMouseEnter: () => setHeld(i),
      onMouseLeave: () => setHeld(null),
      onFocus: () => setHeld(i),
      onBlur: () => setHeld(null),
      onClick: () => setStep((selected) => (selected === i ? null : i)),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setStep((selected) => (selected === i ? null : i));
        }
      },
    };
  };

  return (
    <figure className="hero-frame jl-frame">
      {/* 目前這一格的名字和說明都放在左上角，圖底下不再掛一排文字清單 ——
          清單和方塊本來是同一組東西的兩種畫法，留一種就好。 */}
      <figcaption className="jl-head">
        <p className="eyebrow hero-frame-eyebrow">
          <span className="eyebrow-dot" />
          ONE JOB, FOUR STATES — HOVER OR CLICK ANY STATE
        </p>
        {/* aria-live 掛在不會被 key 重建的外層，否則每次換格都是換一個新的
            live region，螢幕閱讀器不一定會念。 */}
        <div className="jl-live" aria-live="polite">
          <p
            className={
              active
                ? `jl-current jl-current--${active.tone}`
                : "jl-current"
            }
            key={`n${current}`}
          >
            {active?.label ?? "No state selected"}
          </p>
          <p className="jl-detail" key={`d${current}`}>
            {active?.detail ??
              "Hover or focus a state to inspect this job lifecycle."}
          </p>
        </div>
      </figcaption>

      {/* viewBox 貼齊實際畫到的範圍（y 86…482、x 8…890），不是從 0 0 起算 ——
          SVG 會等比縮放整個 viewBox，上方多留的 80 幾個單位在畫面上就是
          一整條空白，把圖推離標題。座標本身不動，只是把鏡頭切齊。 */}
      <svg
        className="jl-svg"
        viewBox="0 78 910 414"
        role="group"
        aria-label="Job lifecycle: pending to running, redelivered on worker death, then branching to succeeded or failed, with failed retryable back to pending"
      >
        <defs>
          {/* marker 一個色一顆：CSS 的 marker-end 會跟著 .is-lit 換掉，
              所以箭頭永遠和線同色，不需要 context-stroke（Safari 支援較晚）。 */}
          {[
            ["dust", "var(--dust)"],
            ["ink", "var(--charcoal)"],
            ["blue", "var(--status-running)"],
            ["green", "var(--status-succeeded)"],
            ["red", "var(--status-failed)"],
          ].map(([name, color]) => (
            <marker
              key={name}
              id={`jl-mk-${name}`}
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

        {/* ── Terminal state 圍籬：使用者改圖時加的框，這裡保留成虛線 ──
            它不是一個節點，是一句話 —— 進了這個框，worker 就不再改這一列。 */}
        <rect
          className="jl-terminal"
          x="694"
          y="104"
          width="196"
          height="344"
          rx="26"
        />
        <text className="jl-terminal-label" x="792" y="92">
          TERMINAL STATE
        </text>

        {/* ── 邊 ─────────────────────────────────────────────── */}
        {(Object.keys(EDGES) as EdgeId[]).map((id) => (
          <path key={id} className={edgeCls(id)} d={EDGES[id].d} fill="none" />
        ))}

        {/* ── 節點（同時是控制項） ───────────────────────────── */}
        <g {...controlProps("pending")} className={nodeCls("pending", "pending")}>
          <ellipse cx="170" cy="300" rx="72" ry="38" />
          <text x="170" y="300">
            pending
          </text>
        </g>

        <g {...controlProps("running")} className={nodeCls("running", "running")}>
          <rect x="352" y="262" width="172" height="76" rx="16" />
          <text x="438" y="300">
            running
          </text>
        </g>
        <text className="jl-tag" x="438" y="356">
          attempt #1
        </text>

        {/* 同一個 status 的第二次嘗試：同色、虛線框 —— 不是新狀態。 */}
        <g
          {...controlProps("redelivered")}
          className={`${nodeCls("redelivered", "running")} jl-node--ghost`}
        >
          <rect x="352" y="118" width="172" height="76" rx="16" />
          <text x="438" y="156">
            running
          </text>
        </g>
        <text className="jl-tag" x="438" y="108">
          attempt #2 — same job
        </text>

        <g
          {...controlProps("succeeded")}
          className={nodeCls("succeeded", "succeeded")}
        >
          <ellipse cx="792" cy="176" rx="80" ry="40" />
          <text x="792" y="176">
            succeeded
          </text>
        </g>

        <g {...controlProps("failed")} className={nodeCls("failed", "failed")}>
          <ellipse cx="792" cy="396" rx="80" ry="40" />
          <text x="792" y="396">
            failed
          </text>
        </g>

        {/* ── 邊上的說明 ─────────────────────────────────────── */}
        {/* 標籤位置都算過：pending 是橢圓，靠近它的字要退到橢圓在該 y
            的實際寬度之外，不能只看 bounding box。 */}
        <text className="jl-edge-label" x="14" y="268" textAnchor="start">
          POST /api/jobs/
        </text>
        <text className="jl-edge-label" x="297" y="282">
          worker picks it up
        </text>
        <text className="jl-edge-label" x="378" y="222" textAnchor="end">
          crash before ack
        </text>
        <text className="jl-edge-label" x="498" y="222" textAnchor="start">
          broker redelivers
        </text>
        <text className="jl-edge-label" x="612" y="228">
          transcript written
        </text>
        <text className="jl-edge-label" x="612" y="374">
          raised, retries spent
        </text>

        {/* manual retry 是一條邊，不是一個狀態，所以它的開關是畫在線上的
            chip；做成跟方塊一樣大的可點區域，不然這一格會比其他五格難點。 */}
        <g
          {...controlProps("retry-chip")}
          className={`jl-chip${active?.control === "retry-chip" ? " is-lit" : ""}`}
        >
          <rect x="282" y="450" width="196" height="32" rx="16" />
          <text x="380" y="466">
            manual retry
          </text>
        </g>
      </svg>

      {/* 這句是整張圖的重點，所以不放進輪播 —— 它在每一格都成立。 */}
      <p className="jl-note">
        Once a job is terminal, mark_running / mark_succeeded / mark_failed
        return early — so a redelivered duplicate can never overwrite a finished
        result.
      </p>
    </figure>
  );
}

export default JobLifecycle;
