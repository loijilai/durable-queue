# Job API 讀寫合約分離

## 問題

`TranscriptionJobSerializer` 同時服務四個位置：list、detail、create 的回應、retry 的回應。
四者的需求不同，卻共用一個型別。這造成三件事。

**一、讀寫合約無法各自演進。** 想讓 list 不要回傳逐字稿全文，一改就同時改到 create
與 retry 的回應。

**二、寫入的回應塞滿佔位符。** `POST /api/jobs/` 回傳九個欄位，其中只有 `id` 與
`created_at` 帶資訊。`status` 恆為 `pending`、`transcript` / `error` / `finished_at`
恆為 `null`、`worker_attempts` 恆為空陣列、`video_url` 是呼叫者送來的回音、`owner`
是呼叫者自己。OpenAPI schema 上 create 與 get 的回應完全相同，讀規格的人無從分辨
哪些欄位在哪個情境下有意義。

**三、`202` 附帶一份會過期的狀態快照。** retry 回 `202 Accepted`，語意是「已受理，
尚未完成」，body 卻附上一份看似權威的 Job 表示。`enqueue_job` 走 `transaction.on_commit`，
worker 可能在 HTTP 回應送達前就把狀態改成 `running`。前端 `handleRetry` 拿這份 body
直接覆蓋本地那一列，於是較舊的快照蓋掉較新的資料。這個競態在目前的程式碼裡是活的，
不是理論上的。

## 決策

### 三個 serializer

| Serializer | 用在 | 欄位 |
| --- | --- | --- |
| `JobSummarySerializer` | list | `id`, `video_url`, `status`, `error`, `created_at`, `finished_at`, `worker_attempts`, `transcript_preview`, `transcript_length` |
| `JobDetailSerializer` | detail | `id`, `video_url`, `status`, `transcript`, `error`, `created_at`, `finished_at`, `worker_attempts` |
| `JobRefSerializer` | create 的回應 | `id`, `status`, `created_at` |

`owner` 從所有回應移除。queryset 已限定本人，這個欄位不帶資訊，只洩漏內部 user PK。

`worker_attempts` 與 `error` 留在 summary。前者是幾筆 `{host, at}`，很輕，且 `AuditTrail`
元件在列表上就要用。真正撐大 payload 的只有 `transcript` 一個。

### 逐字稿改由 detail 取得

輪詢每兩秒打一次 list。逐字稿全文留在 list 裡，等於每兩秒重傳一次所有已完成 Job 的全文。
把全文移到 detail，輪詢的持續成本降下來，而成本只在使用者真的要看全文時才付。

畫面不改。`.job-transcript` 以 `max-height: 120px` 裁切顯示，所以 summary 帶一段
`transcript_preview`（全文前 500 字）就足以讓那個框維持滿的、漸層遮罩與現在一致。
500 字是為了涵蓋裁切框的最大可見量而取的，不是顯示門檻。

「Show more」與複製按鈕需要全文，改成呼叫 `GET /api/jobs/{id}/`。這讓 detail view
重新有真實使用者——`ef657c8` 移除 `getJob` 之後它一直沒有呼叫者。

### 寫入端點有自己的回應型別

`POST /api/jobs/` 回 `201 Created`、`Location` 指向該 Job 的 detail URL、body 為
`JobRefSerializer`。

`POST /api/jobs/{id}/retry/` 回 `202 Accepted`、`Location` 指向該 Job 的 detail URL、
**沒有 body**。202 的語意因此回到誠實：已受理，最終狀態不在這裡，去 `Location` 讀。

前端兩處都改成重抓 list，不再用回應覆蓋本地狀態。retry 之後狀態必為非終態，
`hasActiveJob` 會變 true，既有的輪詢 effect 自己接手。

`JobCreateView` 同時是 list 與 create，以 `get_serializer_class()` 依 `request.method`
分流，並用 `@extend_schema` 明確標註 request 與 response，避免 drf-spectacular 產出
錯誤的 schema。

## 不在範圍內

- **分頁。** list 目前回裸陣列，沒有 pagination。加上去是另一次 breaking change，另案處理。
- **`worker_attempts` 的形狀。** 維持原始 audit log，不加 `attempts_since_retry`。
- **retry 改成 attempts 子資源。** `POST /jobs/{id}/retry/` 這種 RPC 風格務實且常見，
  改成子資源要多一張表與一次 migration，不值得。
- **SecurityPage 的 probe。** 維持 mock，不改成真實呼叫。

## 部署

兩張票都是 breaking change，且是同一次。後端先合會讓線上前端壞掉。
在同一個分支上完成 01 與 02，一起 merge、一起部署。
