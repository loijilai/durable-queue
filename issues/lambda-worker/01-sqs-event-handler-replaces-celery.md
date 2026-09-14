Status: open

# 01 — Worker 改為 SQS event handler，移除 Celery（本機端到端）

**What to build:** 在本機 `docker compose up` 後，從網頁送出一份 Job，它照常走完 pending → running → succeeded，但整條路徑已經沒有 Celery：API 在 DB commit 之後把 `{"job_id": <id>}` 以純 JSON 送進 SQS（本機為 elasticmq），本機專用的 poll shim 收到訊息後，組出與 Lambda SQS event 相同形狀的 event，呼叫 Worker handler 執行 Job。handler 就是之後 Lambda 的入口，重試語義只剩 SQS 一層。

見 spec：「訊息契約與 enqueue」、「Lambda handler」、「本機 poll shim」、「Testing Decisions」。

**注意：** 這張票單獨部署會讓正式環境的 ECS worker 失效（它仍執行 `celery` 指令）。與 02 在同一分支完成後一起 merge、一起部署。

**Blocked by:** None — can start immediately.

- [ ] API 建立 Job 與 retry failed Job 時，都透過新的 enqueue 函式送出訊息，且只在 transaction commit 之後送出；API 測試 patch 這個函式驗證呼叫參數與 on-commit 順序。
- [ ] enqueue 函式送出的訊息 body 為 `{"job_id": <int>}`，有測試固定這份契約；佇列位置由環境變數提供。
- [ ] handler 接受 SQS event（`batch_size = 1` 的形狀，含 body、receipt handle、`ApproximateReceiveCount`），測試直接餵 event 並檢查 Job 最終狀態與 handler 對 SQS 的回應。
- [ ] 轉錄成功：Job 變成 succeeded，Transcript 與 `finished_at` 寫入，handler 正常結束。
- [ ] 永久錯誤與未分類錯誤：第一次就 failed、記錄錯誤與 `failure_reason`，handler 正常結束，不呼叫 `ChangeMessageVisibility`。
- [ ] 暫時性錯誤（`TranscriptionRetryableError` 家族、`ConnectionError`、`TimeoutError`）且 receive count 未達 4：Job 不進終態，handler 以 receipt handle 和退避秒數（指數退避加 jitter，遠小於 900 秒）呼叫 `ChangeMessageVisibility` 後拋出例外。
- [ ] 暫時性錯誤且 receive count 達 4：Job 變成 failed，handler 正常結束。
- [ ] 重複投遞到已是 succeeded / failed 的 Job：Job 不變、轉錄器未被呼叫、handler 正常結束。
- [ ] 執行期間每一行 log 都帶 job id（取代 Celery signal），"job picked up by worker" 行仍帶 `queue_wait_seconds`，"job failed" 行仍帶 `failure_reason`。
- [ ] 本機 poll shim 是 Django management command：對佇列 long-poll、呼叫同一個 handler，handler 正常結束才刪除訊息；docker-compose 的 worker service 改跑它，並建立對應的本機佇列。
- [ ] Celery、kombu、flower 從依賴移除；Celery app 模組、Celery settings、broker 與 visibility timeout 環境變數、Celery 設定測試全部刪除。
- [ ] 架構邊界檢查與環境變數對帳更新為新的模組與環境變數，`.env.example` 同步。
- [ ] 手動驗證：本機 `docker compose up` 後從網頁送出一份 Job 並完成；製造一次暫時性錯誤可觀察到重送後才 failed。
- [ ] `./scripts/verify.sh full` 通過。
