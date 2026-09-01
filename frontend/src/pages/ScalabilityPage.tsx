import ControlLoop from "../components/ControlLoop.tsx";
import EvidenceCarousel, {
  type EvidenceSlide,
} from "../components/EvidenceCarousel.tsx";
import ExcalidrawDiagram from "../components/ExcalidrawDiagram.tsx";
import RecordingSlot from "../components/RecordingSlot.tsx";
import { twoSubmittersScene } from "../lib/diagramScenes.ts";

/* 三張都來自同一次執行，各回答一個不同的問題，順序就是問題的順序：
   消化掉了嗎 → 是因為容量變多嗎 → 有 Job 被卡住嗎。 */
const EVIDENCE_SLIDES: EvidenceSlide[] = [
  {
    src: "/evidence/backlog-inflight.png",
    alt: "Dashboard widget covering 09:05–09:34 UTC with four series on one time axis",
    caption: (
      <ul className="scl-legend">
        <li>
          <span className="scl-swatch scl-swatch--backlog" />
          <strong>Backlog</strong> — Jobs accepted but not yet picked up by a
          Worker.
        </li>
        <li>
          <span className="scl-swatch scl-swatch--inflight" />
          <strong>In-flight Jobs</strong> — Jobs a Worker has picked up but not
          yet finished.
        </li>
        <li>
          <span className="scl-swatch scl-swatch--worker" />
          <strong>Worker Count</strong> — how many Workers are running.
        </li>
        <li>
          <span className="scl-swatch scl-swatch--wait" />
          <strong>Queue Wait</strong> — the time between a Job being accepted
          and a Worker picking it up.
        </li>
      </ul>
    ),
  },
  {
    src: "/evidence/sqs-messages-received.png",
    alt: "Messages received per minute over the same window, rising from 2 to 33",
    caption: "Messages taken off the queue per minute.",
  },
  {
    src: "/evidence/oldest-unfinished-job.png",
    alt: "Age of the oldest unfinished Job over the same window, peaking well below the alarm threshold",
    caption:
      "Age of the oldest unfinished Job, against the alarm threshold on the same axis.",
  },
];

const EVIDENCE_LABEL = "Screenshots from the acceptance run";

const RUN_RECORDING_URL = "https://youtu.be/-sCn0tKnO98";

const WORKLOAD_DIAGRAM_LABEL =
  "Two Submitters reach the Django API — the Interactive Submitter through the Frontend, the Batch Submitter directly — which enqueues onto SQS; the Worker pool scales from 1 to 67 to drain it";

function ScalabilityPage() {
  return (
    <section className="ha-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        SCALE OUT
      </p>
      <h1>Throughput Scales With the Worker Pool</h1>
      <p className="placeholder-body">
        A Closed Loop Between Backlog and Capacity
      </p>

      {/* 開場不從機制開始，從工作負載開始 —— 讀者要先知道這條迴路是為了誰而存在，
          才有辦法判斷它設計得對不對。CONTEXT.md 的兩種 Submitter 就是這一段。
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

      {/* 容量由 Backlog 決定，不由人去撥 —— 這張圖是這一頁的主角，
          所以緊接在工作負載之後、證據之前。 */}
      <ControlLoop />

      {/* 迴路圖負責讓人懂，這一區負責讓人信 —— 所以它排在迴路圖之後。
          素材全部來自 2026-08-31 的驗收實驗（issues/scaling-control-loop/
          11-acceptance-experiment-results.md）。那次的基礎設施已經銷毀，這些
          截圖與錄影是僅存的證據，因此原圖照放，不修改內容。
          三張圖各回答一個不同的問題，圖說只說明圖上有什麼，不替讀者判讀。
          它們疊成一疊而不是排成一列：證據多了不該讓頁面跟著變長。 */}
      <div className="scl-evidence">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          THE EVIDENCE
        </p>

        <EvidenceCarousel slides={EVIDENCE_SLIDES} label={EVIDENCE_LABEL} />

        <RecordingSlot
          url={RUN_RECORDING_URL}
          title="The Control Loop on Real AWS"
          description="A screen recording of the same run the panels above are taken from: the burst arrives, the Worker pool grows, the Backlog drains, and capacity scales back in."
          slotHint="burst → scale out → drain → scale in"
        />
      </div>
    </section>
  );
}

export default ScalabilityPage;
