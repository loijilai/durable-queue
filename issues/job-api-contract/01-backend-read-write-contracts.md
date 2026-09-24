Status: open

# 01 — 後端：Job 的讀寫回應分成三個 serializer

**What to build:** 打 Job API 的人會拿到四種不同形狀的回應，各自只說它該說的事。
list 回摘要，帶一段逐字稿預覽但不帶全文；detail 回全文；建立 Job 回 `201` 加一個
只有 `id` / `status` / `created_at` 的最小 body 與 `Location`；retry 回 `202` 加
`Location`、沒有 body。`owner` 從所有回應消失。OpenAPI schema 如實反映這四種形狀。

見 spec：「三個 serializer」、「逐字稿改由 detail 取得」、「寫入端點有自己的回應型別」。

**注意：** 這張票單獨部署會讓線上前端壞掉（它仍預期舊的回應形狀）。與 02 在同一分支
完成後一起 merge、一起部署。

**Blocked by:** None — can start immediately.

- [ ] `JobSummarySerializer` 供 list 使用，欄位為 `id`、`video_url`、`status`、`error`、`created_at`、`finished_at`、`worker_attempts`、`transcript_preview`、`transcript_length`；不含 `transcript` 全文，不含 `owner`。
- [ ] `transcript_preview` 為逐字稿全文的前 500 字，`transcript_length` 為全文長度；Job 尚無逐字稿時兩者皆為 `null`。有測試固定這兩個欄位在「無逐字稿」、「短於 500 字」、「長於 500 字」三種情況下的值。
- [ ] `JobDetailSerializer` 供 detail 使用，欄位為 `id`、`video_url`、`status`、`transcript`、`error`、`created_at`、`finished_at`、`worker_attempts`；不含 `owner`。
- [ ] `JobRefSerializer` 供 create 的回應使用，欄位為 `id`、`status`、`created_at`。
- [ ] `JobCreateView` 以 `get_serializer_class()` 依 `request.method` 分流：`GET` 用 summary，`POST` 的輸入驗證與回應用對應的 serializer。可寫入欄位仍只有 `video_url`，客戶端無法指定 `status` 或 `owner`。
- [ ] `POST /api/jobs/` 回 `201`，body 為 `JobRefSerializer`，並帶 `Location` header 指向該 Job 的 detail URL。有測試斷言 header 與 body 的欄位集合。
- [ ] `POST /api/jobs/{id}/retry/` 回 `202`、無 body、帶 `Location` header 指向該 Job 的 detail URL。有測試斷言回應沒有內容。
- [ ] retry 的既有行為不變：非 `failed` 狀態回 `409`、他人的 Job 回 `404` 且不改動該 Job、成功時在 commit 之後才 enqueue。
- [ ] `@extend_schema` 更新到與實際回應一致，特別是 retry 的 `202` 標為無內容、create 的 `201` 指向 `JobRefSerializer`；產生 schema 時不出現新的警告。
- [ ] 既有測試中斷言 `owner` 或舊回應欄位的部分全部更新；authz 的保證改用不依賴 `owner` 欄位的方式驗證（他人 Job 回 `404`、list 只含自己的 Job）。
- [ ] `./scripts/verify.sh full` 通過。
