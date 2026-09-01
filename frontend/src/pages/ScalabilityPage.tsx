import ControlLoop from "../components/ControlLoop.tsx";
import ExcalidrawDiagram from "../components/ExcalidrawDiagram.tsx";
import RecordingSlot from "../components/RecordingSlot.tsx";
import { twoSubmittersScene } from "../lib/diagramScenes.ts";

const RUN_RECORDING_URL = "https://youtu.be/-sCn0tKnO98";

const WORKLOAD_DIAGRAM_LABEL =
  "Two Submitters: the Interactive Submitter goes through the Frontend, the Batch Submitter calls the Django API directly";

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
        <h2 className="scl-card-title">Two Submitters, Two Needs</h2>

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
          兩張圖各回答一個不同的問題，圖說只說明圖上有什麼，不替讀者判讀。 */}
      <div className="scl-evidence">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          THE EVIDENCE
        </p>
        <h2 className="scl-card-title">One Run on Real AWS</h2>
        <p>
          250 Jobs submitted in a single burst on 2026-08-31, 09:10 UTC. Every
          panel below is from that one run.
        </p>

        <figure className="scl-shot">
          <p className="scl-shot-question">Did the Backlog drain?</p>
          {/* 截圖裡自帶標題與 legend，alt 只說明它是什麼，不重述線的內容 —
              那是下面 figcaption 的工作。 */}
          <img
            src="/evidence/backlog-inflight.png"
            alt="Dashboard widget covering 09:05–09:34 UTC with four series on one time axis"
          />
          <figcaption>
            <ul className="scl-legend">
              <li>
                <span className="scl-swatch scl-swatch--backlog" />
                <strong>Backlog</strong> — Jobs accepted but not yet picked up
                by a Worker.
              </li>
              <li>
                <span className="scl-swatch scl-swatch--inflight" />
                <strong>In-flight Jobs</strong> — Jobs a Worker has picked up
                but not yet finished.
              </li>
              <li>
                <span className="scl-swatch scl-swatch--worker" />
                <strong>Worker Count</strong> — how many Workers are running.
              </li>
              <li>
                <span className="scl-swatch scl-swatch--wait" />
                <strong>Queue Wait</strong>, on the right axis — the time
                between a Job being accepted and a Worker picking it up.
              </li>
            </ul>
          </figcaption>
        </figure>

        {/* 主圖最弱的地方是綠線：左軸為 245 的 Backlog 而設，17 個 Worker 被
            壓在圖底幾乎看不出在動。容量到底有沒有變多，改由這一格回答。 */}
        <figure className="scl-shot scl-shot--aux">
          <p className="scl-shot-question">
            Did the Backlog fall because capacity went up?
          </p>
          <img
            src="/evidence/sqs-messages-received.png"
            alt="Messages received per minute over the same window, rising from 2 to 33"
          />
          <figcaption>
            Messages taken off the queue per minute, from the same run: 2 at the
            start of the burst, 33 at the peak. On the dashboard above, the
            Worker Count line shares a left axis scaled for a Backlog of 245, so
            this is the panel that shows capacity moving.
          </figcaption>
        </figure>

        <RecordingSlot
          url={RUN_RECORDING_URL}
          title="The Control Loop on Real AWS"
          description="A screen recording of the same run the two panels above are taken from: the burst arrives, the Worker pool grows, the Backlog drains, and capacity scales back in."
          slotHint="burst → scale out → drain → scale in"
        />
      </div>
    </section>
  );
}

export default ScalabilityPage;
