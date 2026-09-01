import ExcalidrawDiagram from "../components/ExcalidrawDiagram.tsx";
import { twoSubmittersScene } from "../lib/diagramScenes.ts";

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
        <h2 className="scl-scenario-title">Two Submitters, Two Needs</h2>

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

      {/* 02 填入：控制迴路圖 */}
      {/* 03 填入：證據（截圖與實機錄影） */}
    </section>
  );
}

export default ScalabilityPage;
