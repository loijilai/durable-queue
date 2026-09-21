Status: open

# 03 — 對齊 Lambda 併發上限，重試改數真正的執行次數

**What to build:** 部署之後，一次送進 250 份 Job 不會被 throttle：ESM 的 `maximum_concurrency` 與帳號的 Lambda 併發配額對齊為 10。一份只是在佇列裡等待容量的 Job，不會因為等待而被扣重試次數，也不會因此進 DLQ——Job 是否已用完重試次數，改由它實際被執行的次數決定，不再由 SQS 的投遞次數決定。dashboard 上 Worker Count 看得清楚，也不再把「被 ESM 領走的訊息數」標成 In-flight Jobs。

背景：預跑（`04-burst-experiment-results.md`）實測到 ESM 設 67、帳號配額 10 時，超出的呼叫全部被 throttle，ESM 退避到停止，系統只靠 900 秒的 visibility timeout 到期重送才繼續推進；每次重送都讓 `ApproximateReceiveCount` 加 1，而 handler 把它當成重試計數器。

**Blocked by:** None — can start immediately.

- [ ] ESM 的 `maximum_concurrency` 為 10。註解說明 10 來自帳號的 Lambda 併發配額，並保留依 RDS `db.t4g.micro` 連線預算推導出的 67，作為配額調升後的目標值。
- [ ] Job 佇列的 `maxReceiveCount` 為 10。DLQ 只用來收「handler 每次都沒能記錄結果」的訊息，不再兼任重試上限。
- [ ] handler 判斷「這是最後一次嘗試」時，依據 Job 實際被執行的次數（`worker_attempts` 的筆數），不再依據 `ApproximateReceiveCount`。說明「receive count 就是重試計數器」的註解一併改寫。
- [ ] 測試：投遞次數已經很高、但實際執行次數未達 4 的 Job 遇到暫時性錯誤時，不會變成 failed，handler 縮短 visibility 後拋出例外。
- [ ] 測試：實際執行次數達 4 的 Job 遇到暫時性錯誤時變成 failed，handler 正常結束。既有依 receive count 撰寫的 handler 測試改為依實際執行次數。
- [ ] dashboard 拆成兩個 widget，時間範圍一致、上下對齊：一個放 Backlog 與「被 ESM 領走的訊息數」（`ApproximateNumberOfMessagesNotVisible`，改名為不暗示「執行中」的名稱，例如 Received by poller）；另一個放 Worker Count（`ConcurrentExecutions`）與 Queue Wait（右軸）。
- [ ] visibility timeout 維持 900 秒，與 Lambda timeout 一致。
- [ ] `./scripts/verify.sh full` 通過。
- [ ] 部署到正式環境後：ESM 的 `maximum_concurrency` 查得到 10、佇列的 redrive policy 查得到 `maxReceiveCount` 10；送出一份 Job 由 Lambda 執行至 succeeded，兩個 dashboard widget 皆有資料。
