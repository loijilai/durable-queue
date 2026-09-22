import EvidenceCarousel, {
  type EvidenceSlide,
} from "../components/EvidenceCarousel.tsx";
import ExcalidrawDiagram from "../components/ExcalidrawDiagram.tsx";
import { twoSubmittersScene } from "../lib/diagramScenes.ts";

/* 兩張都是同一次 burst 的 dashboard widget，放在這裡是為了證明這個系統有在
   監控，不是要讀者自己讀圖 —— 所以不附圖說，結論寫在上面的一段話裡。
   讀圖的細節（每分鐘解析度、最後一分鐘的資料點沒出現）留給口頭說明。 */
const EVIDENCE_SLIDES: EvidenceSlide[] = [
  {
    src: "/evidence/lambda-burst-queue.png",
    alt: "Dashboard widget covering 04:23–04:30 UTC: the Backlog jumps to about 210 at 04:25 and drains to zero by 04:28, while messages received by the poller stay below 67 per minute",
  },
  {
    src: "/evidence/lambda-burst-workers.png",
    alt: "Dashboard widget covering 04:23–04:30 UTC: Worker Count rises to 67 at 04:25 and reads 66 at 04:26, where the line ends; the per-minute average Queue Wait rises from about 21 to about 69 seconds",
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
          這一段只回答一個問題 —— 250 份同時進來，多久做完 —— 標題就是答案。 */}
      <div className="scl-evidence">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          THE EVIDENCE
        </p>
        <h2 className="scl-card-title">
          250 Jobs at Once, All Done in 128 Seconds
        </h2>

        <p>
          Each Job runs for 24 seconds. Lambda scales to its ceiling of 67
          concurrent Workers. The longest wait was 98 seconds, and no Job
          failed.
        </p>

        <EvidenceCarousel slides={EVIDENCE_SLIDES} label={EVIDENCE_LABEL} />
      </div>
    </section>
  );
}

export default ScalabilityPage;
