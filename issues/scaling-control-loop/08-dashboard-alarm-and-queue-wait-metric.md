Status: open

# 08 — Dashboard、alarm 與 Queue Wait metric filter

**What to build:** 讓系統能被看見。這張票結束時，一個人打開一張圖就能回答「現在健不
健康」，以及「剛才那次容量變化有沒有真的產生它應該產生的效果」。

**這張票刻意排在 07 之前不依賴它**：先有觀測，才有根據去設定 policy 的門檻。

三件事：

- **Queue Wait 的 metric filter。** 把 04 發出的等待時間欄位從 log 導成 metric。
  應用程式仍然不發送任何 metric —— 系統中的每一個 metric，若非受管服務內建，即由
  log 行導出。這條紀律讓 observability 不會變成一個需要維持存活的元件。
- **單一 dashboard，四條線同一時間軸**：Backlog、In-flight Job、Worker 數量、
  Queue Wait。同一條時間軸是重點，因為要做的是因果推論而不是分別看四個數字。
  另加「最舊未完成 Job 年齡」作為 Completion Latency 的觀測線 —— 注意它的正名：
  它包含已執行時間，不是 Queue Wait。
- **單一 alarm**：最舊未完成 Job 年齡超過門檻。

執行階段的耗時分解**不預先聚合為 metric**，改以臨機查詢對 log 取得。這是刻意的：
observability 不應該為了我們很少問的問題累積常駐成本。

**Blocked by:** 04, 05

- [ ] Queue Wait 由 log 欄位經 metric filter 導出，非由應用程式發送
- [ ] 單一 dashboard 呈現 Backlog、In-flight Job、Worker 數量、Queue Wait 於同一時間軸
- [ ] 「最舊未完成 Job 年齡」亦呈現，且其標示反映它包含已執行時間
- [ ] 單一 alarm 建立於最舊未完成 Job 年齡之上
- [ ] 執行階段耗時的分解可用臨機查詢取得，且該查詢被記錄下來以便重複使用
- [ ] 未建立任何預先聚合的階段耗時 metric
- [ ] `./scripts/verify.sh full` 通過
