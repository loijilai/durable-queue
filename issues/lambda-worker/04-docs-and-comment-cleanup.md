Status: open

# 04 — CONTEXT.md、README、架構圖與註解清理

**What to build:** repo 裡的文件、架構圖與程式碼註解都描述「SQS 觸發 Lambda Worker、固定 Scaling Ceiling」的系統。沒有任何地方再描述 ECS worker、step scaling control loop 或 Celery，也沒有任何註解以 ADR-0006、ADR-0007、ADR-0008 作為理由。依本次決策直接清除，不另寫 supersede 記錄。

見 spec：「文件與前端」中 CONTEXT.md、架構圖與 README、註解清理三項。

**Blocked by:** 02 — Lambda Worker 上線，移除 ECS worker 與 autoscaling.

- [ ] CONTEXT.md：Worker 定義為「一個同時執行中的 Lambda invocation；一次只處理一份 Job」。
- [ ] CONTEXT.md：Scaling Ceiling 改為由 ESM `maximum_concurrency` 實作，推導依據不變。
- [ ] CONTEXT.md：Interactive / Batch Submitter 段落改寫為「一套容量機制同時服務兩者，閒置的代價是冷啟動」。
- [ ] CONTEXT.md：「task」一詞多義段落刪除 Celery task，ECS task 限定指 API；In-flight Job 中關於縮容的警告刪除。
- [ ] README 與架構圖（AWS 基礎設施、C4、部署管線等 diagram 原始檔及其產出）改為 Lambda，移除 worker Fargate service 與 autoscaling。
- [ ] 全 repo 搜尋 ADR-0006、ADR-0007、ADR-0008、control loop、step scaling、Celery、`acks_late`、prefetch、`autoretry_for`，相關註解一律刪除或改寫（前端頁面內容除外，留給 05）。
- [ ] `./scripts/verify.sh full` 通過。
