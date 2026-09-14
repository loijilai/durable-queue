Status: open

# 03 — 在 Lambda 上重跑 250 jobs burst 實驗並記錄數字

**What to build:** 用 Batch Submitter 腳本在正式環境一次送出 250 份 Job（Load Model，`TRANSCRIBER=fake`、每份 24 秒），記錄這次改動的實際效果，作為前端證據的來源。只記錄數字，不設成功門檻。

見 spec：「Testing Decisions → 驗證實驗」。

**Blocked by:** 02 — Lambda Worker 上線，移除 ECS worker 與 autoscaling.

- [ ] 250 份 Job 全部抵達終態，記錄從第一份 Acceptance 到最後一份完成的時間。
- [ ] 記錄 Worker Count（`ConcurrentExecutions`）峰值，並確認從未超過 67。
- [ ] 記錄 Queue Wait 的分布（至少平均與最大值），以及失敗或進 DLQ 的 Job 數量。
- [ ] 保存實驗期間的 dashboard 截圖，供 05 使用。
- [ ] 結果寫成一份 markdown 放在這個 feature 目錄下，附上與舊架構「約 16 分鐘」的對照。
