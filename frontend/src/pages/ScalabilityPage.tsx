import EvidenceCarousel, {
  type EvidenceSlide,
} from "../components/EvidenceCarousel.tsx";
import ExcalidrawDiagram from "../components/ExcalidrawDiagram.tsx";
import { twoSubmittersScene } from "../lib/diagramScenes.ts";

/* 數字卡只放這次實驗實測成立的形狀：Job 很快開始執行、Worker Count 爬到
   上限、全程零失敗。數字全部取自 issues/lambda-worker/
   04-burst-experiment-results.md 的 2026-09-22 正式實驗。 */
const BURST_STATS: { label: string; value: string; note: string }[] = [
  {
    label: "First Job's Queue Wait",
    value: "3.8s",
    note: "Accepted to picked up, including a cold start",
  },
  {
    label: "Worker Count reaches 67",
    value: "41.5s",
    note: "After T0, the burst's first Acceptance",
  },
  {
    label: "Peak Worker Count",
    value: "67",
    note: "The concurrency ceiling",
  },
  {
    label: "Failed Jobs",
    value: "0",
    note: "All 250 succeeded, each run once",
  },
  {
    label: "Dead-letter queue",
    value: "0",
    note: "No message exhausted its retries",
  },
];

/* 兩張都是同一次 burst 的 dashboard widget。圖說除了說明線是什麼，還要先把
   讀圖的陷阱講清楚 —— 截圖原樣放，不修圖，所以會誤導人的地方只能靠文字補。 */
const EVIDENCE_SLIDES: EvidenceSlide[] = [
  {
    src: "/evidence/lambda-burst-queue.png",
    alt: "Dashboard widget covering 04:23–04:30 UTC: the Backlog jumps to about 210 at 04:25 and drains to zero by 04:28, while messages received by the poller stay below 67 per minute",
    caption: (
      <>
        <strong>Backlog</strong> is the number of Jobs accepted but not yet
        picked up by a Worker; <strong>Received by poller</strong> is how many
        messages the event source mapping took off the queue each minute. The
        250 Jobs arrive faster than 67 Workers can run them, so the excess
        waits in the queue and drains round by round.
      </>
    ),
  },
  {
    src: "/evidence/lambda-burst-workers.png",
    alt: "Dashboard widget covering 04:23–04:30 UTC: Worker Count rises to 67 at 04:25 and reads 66 at 04:26, where the line ends; the per-minute average Queue Wait rises from about 21 to about 69 seconds",
    caption: (
      <>
        <strong>Worker Count</strong> climbs to 67 in about 40 seconds, then
        dips between rounds as Jobs finish and the next ones are picked up —
        the per-minute maximum hides those dips. The line stops at 04:26
        because the datapoint for the last minute never appeared, though
        Workers were still running then. <strong>Queue Wait</strong> is a
        per-minute average, not a distribution: Jobs later in the burst wait
        longer, and a single line cannot show that spread.
      </>
    ),
  },
];

const EVIDENCE_LABEL = "Screenshots from the 250-Job burst";

const WORKLOAD_DIAGRAM_LABEL =
  "Two Submitters reach the Django API — the Interactive Submitter through the Frontend, the Batch Submitter directly — which enqueues onto SQS; the event source mapping invokes up to 67 concurrent Lambda Workers to drain it";

function ScalabilityPage() {
  return (
    <section className="ha-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        SCALE OUT
      </p>
      <h1>Throughput Scales With the Worker Pool</h1>
      <p className="placeholder-body">
        SQS Drives Lambda Up to 67 Concurrent Workers
      </p>

      {/* 開場不從機制開始，從工作負載開始 —— 讀者要先知道容量是為了誰而存在，
          才有辦法判斷它設計得對不對。
          這裡刻意用圖不用文字：兩條路徑（一條經過 Frontend、一條繞過它）擺在一起
          看，比兩段敘述更快講完「兩種 Submitter」這件事。 */}
      <div className="scl-scenario">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          THE WORKLOAD
        </p>
        <h2 className="scl-card-title">Scalable Infrastructure</h2>

        <ExcalidrawDiagram
          scene={twoSubmittersScene}
          label={WORKLOAD_DIAGRAM_LABEL}
        />

        {/* 圖已經把兩條路徑講完了，文字只補一句「這兩個人是誰」。 */}
        <p className="scl-scenario-caption">
          The Interactive Submitter is one person sending one Job at an
          unpredictable moment; the Batch Submitter is a scheduled service
          sending hundreds of them at a fixed hour.
        </p>
      </div>

      {/* 工作負載之後直接接證據：素材來自 2026-09-22 在 Lambda 上跑的 250 jobs
          burst（issues/lambda-worker/04-burst-experiment-results.md）。
          數字卡先給結論，截圖在後面讓人自己對。截圖疊成一疊而不是排成一列：
          證據多了不該讓頁面跟著變長。 */}
      <div className="scl-evidence">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          THE EVIDENCE
        </p>
        <h2 className="scl-card-title">A 250-Job Burst on Lambda</h2>

        <dl className="scl-stats">
          {BURST_STATS.map((stat) => (
            <div key={stat.label} className="scl-stat">
              <dt>{stat.label}</dt>
              <dd className="scl-stat-value">{stat.value}</dd>
              <dd className="scl-stat-note">{stat.note}</dd>
            </div>
          ))}
        </dl>

        <EvidenceCarousel slides={EVIDENCE_SLIDES} label={EVIDENCE_LABEL} />
      </div>
    </section>
  );
}

export default ScalabilityPage;
