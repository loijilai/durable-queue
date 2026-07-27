# Frontend Roadmap

> 對應 [Backend Roadmap](backend.md) 的「四、Presentation（呈現層）」階段。前端要展示 durable queue 的關鍵設計決策（async job、狀態輪詢、auth、retry、scalability、HA）給面試官看，不是單純把功能刻完。

## 背景與目標

`durable-queue` 目前是純後端專案，尚無前端。這份 roadmap 的目的是規劃一個給面試官看的 demo 前端，涵蓋四大主題。視覺風格套用既有的 [DESIGN.md](../../DESIGN.md) 設計系統。

整個前端頁面必須用英文。

**技術選型（已與使用者確認）**：React + Vite + TypeScript，本地跑（`npm run dev` 打本地 Django）。

## 前置準備事項

- [x] **CORS 設定**：`django-cors-headers`，白名單 `http://localhost:5173`，未開 `CORS_ALLOW_CREDENTIALS`（JWT 走 header，不需要）。

---

## 功能清單（依四大主題）

### 1. Authentication

- [x] 登入 / 註冊表單頁面，打真實的 `/api/auth/token/`、`/api/auth/register/` endpoint。Access + refresh token 都存 `sessionStorage`（[authStorage.ts](../../frontend/src/lib/authStorage.ts) `saveTokens()`），access token 另外同步一份到 React state 供 UI 即時反應——已知簡化版（不防 XSS，只縮小跨分頁/非 XSS 情境下的曝險面），production 版本會走 access 純記憶體 + refresh HttpOnly cookie + CSRF 防護。
- [x] 「Inspect my token」面板：前端當場用瀏覽器內建方式（`atob` 手刻，非後端 API、非 `jwt-decode` 套件）解碼 JWT payload，秀出 exp/iat/user_id 等欄位給面試官看，並顯示距離過期的即時倒數，藉此具體展示「stateless」這個概念。
- [x] **Google 登入**（下一步）：串接既有後端 `GET /api/auth/google/login/` → `GET /api/auth/google/callback/`。注意目前 `GoogleCallbackView` 是直接回傳 JSON `{access, refresh}`，不是 redirect 回前端——這個 callback 是走整頁導頁（瀏覽器直接打，不是 fetch），跟 SPA 的整合方式（callback 完要怎麼把 token 交回前端 React state）要在開工前先講清楚設計。
- [x] manual refresh

Notes: 為了降低 MVP 的實作成本，目前由 OAuth callback 使用 URL fragment 將 JWT 傳給 SPA，前端讀取後立即清除 URL，並將 access 與 refresh token 儲存在 sessionStorage。這避免 token 進入伺服器 access log，也避免長期持久化；已知代價是 token 仍可被同源 JavaScript 存取，因此存在 XSS token exfiltration 風險。產品成熟後會將 refresh token 遷移至 HttpOnly Cookie。

### 2. 核心功能頁面：Distributed Queue & Async Pattern

- [x] URL 提交表單：貼 YouTube URL → 呼叫真實 `POST /api/jobs/`，立刻拿到 job id。
- [x] Job 狀態 timeline：PENDING → RUNNING → SUCCEEDED/FAILED，用輪詢真實 `GET /api/jobs/{id}` 更新，不是假動畫。分岔畫法：Pending → Running 線性，走到 terminal state 後 Succeeded/Failed 並排呈現互斥分支，箭頭串接。
- [x] 文案用「Job created, now processing asynchronously」（英文）。
- [x] **transcription job list（下一步）**：顯示目前使用者所有 job 的列表（不只是剛建立的那一個），對應 `GET /api/jobs/`（`JobCreateView` 本身是 `ListCreateAPIView`，已經有 list 能力，前端還沒接）。
- [x] retry：串接既有後端 `POST /api/jobs/{id}/retry/`（`JobRetryView`），只對 `FAILED` 狀態的 job 顯示 retry 按鈕。

### 2-1. Durability Walkthrough

- [x] `/concurrency` 路由現在渲染 `DurabilityWalkthroughPage`：把 at-least-once / visibility timeout / retry(backoff+jitter) / concurrency / idempotency / broker-vs-DB 串成七個節點的因果鏈（每個 solution 都因為上一個 solution 開出新問題而存在），每節 Problem → Requirement → Solution 三段式，配一個對應的小 CSS/SVG diagram。
- [x] Scroll-triggered reveal（`IntersectionObserver`，一次性，捲上去不重播）。
- [x] Nav label 改成「Durability Walkthrough」，Home 卡片同步更新。

### 3. High Availability

> 核心論點：**無狀態層（API / worker）已經跨 2 AZ、ASG `desired=2`，真的具備 HA**（[compute.tf:158-206](../../infra/compute.tf#L158-L206)）。用兩個失敗場景把「已經蓋好的 HA」演出來，並標示刻意保留的 SPOF。

- [x] **場景 A — Worker 崩潰不丟工作**（durability，最貼專案主題）：
  - 操作：提交 job → 處理到一半 SIGKILL 掉那台 worker → 任務被重新投遞到另一台 worker → 最終 SUCCEEDED，無人工介入、無資料遺失。
  - 前端呈現：job list 即時 polling，畫面上看到該 job 從 RUNNING 退回、被另一台 worker 接手（靠 `worker_attempts` 序列顯示「換人處理」）再走到 SUCCEEDED。
  - 支撐機制：`acks_late=True` at-least-once 重投 + `mark_running` 冪等 guard（已 succeeded/failed 就跳過）（[tasks.py:14-27](../../durable_queue/jobs/tasks.py#L14-L27)、[services.py:6-19](../../durable_queue/jobs/services.py#L6-L19)）。
  - [ ]️ demo 前置：Redis broker `visibility_timeout` 預設 1 小時，不改 kill 完要等一小時才重投。demo 前要調短（30-60s）。
- [x] **場景 B — API 掉一台自動復原**：
  - 操作：AWS console 手動 terminate 一台 API EC2 → ALB `/health/` health check 標記 unhealthy、流量全導到另一台 → 前端不中斷 → ASG 幾分鐘後自動補一台。
  - 前端呈現：demo 全程頁面持續可用（持續 polling 不中斷），佐證無狀態層 HA + ALB health check + ASG self-healing。
  - 支撐機制：ALB target group health check（[alb.tf:14-27](../../infra/alb.tf#L14-L27)）、API ASG 跨 2 AZ self-healing（[compute.tf:158-181](../../infra/compute.tf#L158-L181)）。
- [x] HA 架構圖：AWS 架構圖（drawio 匯出 SVG，放 `frontend/public/aws-infra.svg`）嵌在場景 B，縮圖可點擊放大（共用 `DiagramLightbox`，含 zoom/pan）。
- [x] **刻意保留的 SPOF 標示**（答辯武器，主動講取捨）：RDS `multi_az=false`（[database.tf:31](../../infra/database.tf#L31)）、Redis 單節點（[database.tf:53-59](../../infra/database.tf#L53-L59)）、單一 NAT（[network.tf:67-81](../../infra/network.tf#L67-L81)）。生產環境會：RDS Multi-AZ standby、ElastiCache replication group + AOF、每 AZ 一個 NAT。並誠實點出 durability 缺口：**佇列本身就在單節點 Redis 上**，broker 一掛在途任務就沒了，真要 durable 會考慮 SQS 或 mirrored RabbitMQ。

### 4. Scalability（Scale out worker / API）

> 核心論點：**queue 解耦 producer/consumer，worker 可獨立線性水平擴展**。這頁不是靜態投影片，要用一個可重現的吞吐 demo 把「線性擴展」演出來（場景 C）。

- [ ] **場景 C — 水平擴展 = 吞吐線性成長**：
  - 操作腳本：一次提交 N 個 job（例如 20），記錄 2 個 worker 跑完的耗時 T；把 worker ASG `desired` 從 2 調到 4（[compute.tf:184-206](../../infra/compute.tf#L184-L206)），再跑一次同樣 N 個，時間約砍半。
  - 前端呈現：job list 即時 polling，畫面上同時有多個 job 從 PENDING → RUNNING → SUCCEEDED 並行跳動；配一個「worker 數 vs 完成耗時」的對照數字（T@2workers vs T@4workers），把線性關係講出來。
  - 依賴 `worker_attempts` 欄位（見下方共用前置）：畫面顯示每個 job 由哪台 worker 處理，一眼看出負載被多台分擔。
  - 支撐機制：queue 解耦（[celery.py](../../durable_queue/durable_queue/celery.py)）、`select_for_update()` 行鎖讓多 worker 併發搶 job 不重複（[services.py:6-19](../../durable_queue/jobs/services.py#L6-L19)）。
- [ ] 旁邊放 scalability 架構圖：ALB → API ASG（×2）→ Redis broker → worker ASG（×2），標出「無狀態層可任意 scale out」。
- [ ] **擴展瓶頸的誠實標示**（答辯用）：worker 線性擴展到某點後，瓶頸轉移到 RDS 連線/寫入吞吐、外部轉錄 API 的 rate limit、單節點 Redis。下一步會是 read replica、連線池（PgBouncer）、對外部 API 做 backpressure/批次。

### 共用前置：讓失敗/擴展 demo「看得見」

- [ ] **前端 job status polling**（場景 A/B/C 全部依賴）：job list 定期輪詢 `GET /api/jobs/`，讓狀態轉換即時跳動——§2 的 timeline 已有輪詢基礎，這裡擴到整個 list。
- [x] **後端 `worker_attempts` 欄位**（場景 A/C 讓畫面可讀）：`TranscriptionJob.worker_attempts`（`JSONField(default=list)`），`mark_running` 在 guard 後 append `{host, at}`——每次 (re)delivery 一筆，記錄完整接手序列（不只最後一次）。前端顯示認領歷史。

---

> 路線圖隨進度更新。完成一項時把 `[ ]` 改成 `[x]`。
