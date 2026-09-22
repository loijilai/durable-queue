Status: done

# 04 — 在 Lambda 上跑 250 jobs burst 實驗並記錄數字

**What to build:** 用 Batch Submitter 腳本在正式環境一次送出 250 份 Job（Load Model，`TRANSCRIBER=fake`、每份 24 秒、提交併發 20），記錄這次改動的實際效果，作為前端證據的來源。要證明的是「形狀」：Job 在 Acceptance 後幾秒內就開始執行、Worker Count 直接抵達上限 67 並停在那裡、超出上限的 Job 在佇列等待、全程零失敗。不與舊架構的完成時間比較。

只記錄數字，不設成功門檻。任何一項不符預期，記錄下來即可，不再調整設定重跑。

預跑之後 infra 整個拆掉重建過，資料庫是新的：預跑的帳號 `batch-submitter-03` 與它留下的 125 份 pending Job 都已不存在。正式實驗前新建一個帳號 `batch-submitter-04`。所有數字仍只取 T0 之後的時間窗，Job 狀態只查這次送出的 job id。

預跑的記錄在 `04-burst-experiment-results.md`，這次的結果寫在同一份文件的「正式實驗」一節。

**Blocked by:** 03 — 對齊 Lambda 併發上限，重試改數真正的執行次數.

- [x] 送出前確認 Job 佇列與 DLQ 皆為空，並以一份 smoke test Job 確認 Queue Wait metric 有資料。
- [x] 250 份 Job 全部抵達終態，記錄從第一份 Acceptance 到最後一份完成的時間。
- [x] 記錄 T0 到 Worker Count（`ConcurrentExecutions`）第一次抵達 67 的時間，以及 Worker Count 峰值。
- [x] 記錄第一份 Job 的 Queue Wait。
- [x] 記錄實驗期間 `Throttles` 的總和。
- [x] 記錄 Queue Wait 的分布（p50 與最大值，或直接貼分布圖），以及失敗或進 DLQ 的 Job 數量。
- [x] 保存實驗期間的 dashboard 截圖，存進前端的資產目錄，供 06 使用。
