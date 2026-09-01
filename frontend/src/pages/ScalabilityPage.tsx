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
          才有辦法判斷它設計得對不對。CONTEXT.md 的兩種 Submitter 就是這一段。 */}
      <div className="scl-scenario">
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          THE WORKLOAD
        </p>
        <h2 className="scl-scenario-title">Two Submitters, Two Needs</h2>

        <p>
          Every night at a fixed hour, a Batch Submitter drops several hundred
          Jobs into the system in one go. It never waits for any of them and it
          does not care how long any single Job takes — it cares that the whole
          run finishes. Nobody is awake to add capacity for it.
        </p>

        <p>
          During the day the other kind of submitter shows up: one person, one
          Job, at an unpredictable moment. They care about exactly one thing —
          how long their Job sits in the Backlog before a Worker picks it up.
        </p>

        {/* 這一段是整頁的樞紐：它讓 min=1 從一個設定值變成一個結論。 */}
        <p className="scl-scenario-close">
          Two needs, two mechanisms — and that split is why the floor is one
          Worker rather than zero. The scale-out threshold is tuned to absorb the
          burst, so a single Job never reaches it. Starting from zero, that one
          Job would wait forever: a policy written for the Batch Submitter's
          throughput cannot also serve the Interactive Submitter's latency.
        </p>
      </div>

      {/* 02 填入：控制迴路圖 */}
      {/* 03 填入：證據（截圖與實機錄影） */}
    </section>
  );
}

export default ScalabilityPage;
