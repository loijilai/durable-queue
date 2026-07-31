# Frontend Roadmap

> 對應 [Backend Roadmap](backend.md) 已完成的 v1 系統，把 durable queue 的關鍵設計決策（async job、狀態輪詢、auth、retry、scalability、HA、security）呈現給面試官看，不是單純把功能刻完。
>
> **v1 demo frontend 已完成並部署（2026-07-30）**；尚未勾選的項目是 demo 操作前置或下一階段要補的 scalability 分析，不阻擋 v1 交付。

## 背景與目標

`durable-queue` 已有一個給面試官看的 demo 前端，涵蓋 authentication、distributed queue、durability、HA、scalability、security 六個主題。視覺風格套用既有的 [DESIGN.md](../../DESIGN.md) 設計系統。

整個前端頁面必須用英文。

**技術選型（已與使用者確認）**：React + Vite + TypeScript；本地用 `npm run dev` 串 Django，production 部署在 Vercel（`https://app.loijilai.site`）並呼叫 AWS 上的 API。

## 前置準備事項

- [x] **CORS 設定**：`django-cors-headers`，白名單 `http://localhost:5173`，未開 `CORS_ALLOW_CREDENTIALS`（JWT 走 header，不需要）。

---

## 功能清單（依四大主題）

### 1. Authentication

- [x] 登入 / 註冊表單頁面，打真實的 `/api/auth/token/`、`/api/auth/register/` endpoint。Access + refresh token 都存 `sessionStorage`（[authStorage.ts](../../frontend/src/lib/authStorage.ts) `saveTokens()`），access token 另外同步一份到 React state 供 UI 即時反應——已知簡化版（不防 XSS，只縮小跨分頁/非 XSS 情境下的曝險面），production 版本會走 access 純記憶體 + refresh HttpOnly cookie + CSRF 防護。
- [x] 「Inspect my token」面板：前端當場用瀏覽器內建方式（`atob` 手刻，非後端 API、非 `jwt-decode` 套件）解碼 JWT payload，秀出 exp/iat/user_id 等欄位給面試官看，並顯示距離過期的即時倒數，藉此具體展示「stateless」這個概念。
- [x] **Google 登入**：串接後端 `GET /api/auth/google/login/` → `GET /api/auth/google/callback/`，callback 完成後 redirect 回 SPA 的 `/auth/google/callback`，由前端接回 token 並同步 React auth state。
- [x] **Manual refresh**：用 refresh token 呼叫 `/api/auth/token/refresh/` 換發 access token。

Notes: 為了降低 MVP 的實作成本，目前由 OAuth callback 使用 URL fragment 將 JWT 傳給 SPA，前端讀取後立即清除 URL，並將 access 與 refresh token 儲存在 sessionStorage。這避免 token 進入伺服器 access log，也避免長期持久化；已知代價是 token 仍可被同源 JavaScript 存取，因此存在 XSS token exfiltration 風險。產品成熟後會將 refresh token 遷移至 HttpOnly Cookie。

### 2. 核心功能頁面：Distributed Queue & Async Pattern

- [x] URL 提交表單：貼 YouTube URL → 呼叫真實 `POST /api/jobs/`，立刻拿到 job id。
- [x] Job 狀態 timeline：PENDING → RUNNING → SUCCEEDED/FAILED，用輪詢真實 `GET /api/jobs/{id}` 更新，不是假動畫。分岔畫法：Pending → Running 線性，走到 terminal state 後 Succeeded/Failed 並排呈現互斥分支，箭頭串接。
- [x] 文案用「Job created, now processing asynchronously」（英文）。
- [x] **Transcription job list**：用 `GET /api/jobs/` 顯示目前使用者所有 job（不只這次 session 建立的 job），並在存在 non-terminal job 時每 2 秒以單一 list request 更新整批狀態。
- [x] retry：串接既有後端 `POST /api/jobs/{id}/retry/`（`JobRetryView`），只對 `FAILED` 狀態的 job 顯示 retry 按鈕。

### 2-1. Durability Walkthrough

- [x] `/durability` 路由渲染 `DurabilityWalkthroughPage`：把 at-least-once / visibility timeout / retry(backoff+jitter) / concurrency / idempotency / broker-vs-DB 串成七個節點的因果鏈（每個 solution 都因為上一個 solution 開出新問題而存在），每節 Problem → Requirement → Solution 三段式，配一個對應的小 diagram。
- [x] Scroll-triggered reveal（`IntersectionObserver`，一次性，捲上去不重播）。
- [x] Nav label 改成「Durability Walkthrough」，Home 卡片同步更新。

### 3. High Availability

> 核心論點：**無狀態層（API / worker）已經跨 2 AZ、ASG `desired=2`，真的具備 HA**（[compute.tf:158-206](../../infra/compute.tf#L158-L206)）。用兩個失敗場景把「已經蓋好的 HA」演出來，並標示刻意保留的 SPOF。

- [x] **場景 A — Worker 崩潰不丟工作**（durability，最貼專案主題）：
  - 操作：提交 job → 處理到一半 SIGKILL 掉那台 worker → 任務被重新投遞到另一台 worker → 最終 SUCCEEDED，無人工介入、無資料遺失。
  - 前端呈現：輪詢該 job，狀態維持 RUNNING，但 `worker_attempts` 會新增第二台 worker 的接手紀錄，最後走到 SUCCEEDED。
  - 支撐機制：`acks_late=True` at-least-once 重投 + `mark_running` 冪等 guard（已 succeeded/failed 就跳過）（[tasks.py:14-27](../../durable_queue/jobs/tasks.py#L14-L27)、[services.py:6-19](../../durable_queue/jobs/services.py#L6-L19)）。
  - [ ] demo 操作前置：production 的 `visibility_timeout` 是 3600 秒；執行 crash demo 前需依 `.env.example` 把 `TRANSCRIBE_SECONDS=15`、`CELERY_VISIBILITY_TIMEOUT=30`，否則重投要等一小時。這是 demo 旋鈕，不是 production 預設。
- [x] **場景 B — API instance lifecycle**：
  - Graceful：CI/CD instance refresh 先 draining、再關舊 instance，health-gated replacement 期間維持零失敗請求。
  - Ungraceful：手動 terminate 一台 API EC2 後，在 ALB 偵測為 unhealthy 前有約 20 秒 bounded failure window；之後流量收斂到健康 instance，ASG 自動補回 desired capacity。
  - 前端呈現：`/health/` 即時 probe、成功/失敗 strip 與 uptime 數字，並附兩條真實 AWS 預錄 demo。
  - 支撐機制：ALB target group health check（[alb.tf:14-27](../../infra/alb.tf#L14-L27)）、API ASG 跨 2 AZ self-healing（[compute.tf:158-181](../../infra/compute.tf#L158-L181)）。
- [x] HA 架構圖：AWS 架構圖（drawio 匯出 SVG，放 `frontend/public/aws-infra.svg`）嵌在場景 B，縮圖可點擊放大（共用 `DiagramLightbox`，含 zoom/pan）。
- [x] **刻意保留的 SPOF 標示**（答辯武器，主動講取捨）：RDS `multi_az=false`（[database.tf:31](../../infra/database.tf#L31)）、Redis 單節點（[database.tf:53-59](../../infra/database.tf#L53-L59)）、單一 NAT（[network.tf:67-81](../../infra/network.tf#L67-L81)）。生產環境會：RDS Multi-AZ standby、ElastiCache replication group + AOF、每 AZ 一個 NAT。並誠實點出 durability 缺口：**佇列本身就在單節點 Redis 上**，broker 一掛在途任務就沒了，真要 durable 會考慮 SQS 或 mirrored RabbitMQ。

### 4. Scalability（Scale out worker / API）

> 核心論點：**queue 解耦 producer/consumer，worker 可獨立線性水平擴展**。這頁不是靜態投影片，要用一個可重現的吞吐 demo 把「線性擴展」演出來（場景 C）。

- [x] **場景 C — 水平擴展 = 吞吐線性成長**：
  - 操作腳本：本地以 Docker Compose 啟動 2 個 worker，一次提交 20 個 job 並記錄完成時間 T；把 pool scale 到 4 個 worker 後重跑同樣 batch，比較兩輪 drain time。AWS v1 的 worker ASG `max_size=2`，因此這是可重現的本地 scale-out 實驗，不冒充 production autoscaling。
  - 前端呈現：job list 即時 polling，畫面上同時有多個 job 從 PENDING → RUNNING → SUCCEEDED 並行跳動；配一個「worker 數 vs 完成耗時」的對照數字（T@2workers vs T@4workers），把線性關係講出來。
  - 依賴 `worker_attempts` 欄位（見下方共用前置）：畫面顯示每個 job 由哪台 worker 處理，一眼看出負載被多台分擔。
  - 支撐機制：queue 解耦（[celery.py](../../durable_queue/durable_queue/celery.py)）、`select_for_update()` 行鎖讓多 worker 併發搶 job 不重複（[services.py:6-19](../../durable_queue/jobs/services.py#L6-L19)）。
- [x] Scalability 架構圖：ALB → API ASG → Redis broker → worker pool，以實線/虛線 worker 區分目前容量與 scale-out 後新增容量。
- [ ] **擴展瓶頸的誠實標示**（答辯用）：worker 線性擴展到某點後，瓶頸轉移到 RDS 連線/寫入吞吐、外部轉錄 API 的 rate limit、單節點 Redis。下一步會是 read replica、連線池（PgBouncer）、對外部 API 做 backpressure/批次。

### 共用前置：讓失敗/擴展 demo「看得見」

- [x] **前端 job status polling**：Queue 頁在存在 non-terminal job 時定期輪詢 `GET /api/jobs/`；HA 頁輪詢單一 demo job；Scalability 頁輪詢當輪 batch，三者都在 terminal state 後停止。
- [x] **後端 `worker_attempts` 欄位**（場景 A/C 讓畫面可讀）：`TranscriptionJob.worker_attempts`（`JSONField(default=list)`），`mark_running` 在 guard 後 append `{host, at}`——每次 (re)delivery 一筆，記錄完整接手序列（不只最後一次）。前端顯示認領歷史。

### 5. Security

- [x] **Infrastructure security**：以 network boundary、SG authorization chain、TLS termination 三個視角呈現 public/private subnet、SG-to-SG 最小開放與 HTTPS 邊界。
- [x] **CI/CD 與 secret flow**：呈現 GitHub OIDC short-lived credential、SHA-tag image、S3 encrypted/versioned remote state，以及 Secrets Manager → EC2 instance profile → container env 的交付路徑。
- [x] **Application authorization boundary**：以真 API 驗證全域 `IsAuthenticated`、物件 ownership 隔離與不洩漏資源存在性的 401 / 404 / 200 邊界。

### 6. Frontend delivery

- [x] Vercel SPA deployment：production domain `https://app.loijilai.site`，以 rewrite fallback 支援 React Router deep link。
- [x] Production API integration：Terraform 將 frontend URL 注入 `FRONTEND_URL` 與 `CORS_ALLOWED_ORIGINS`；OAuth callback 與 CORS 都對準 production frontend。
- [x] Responsive navigation 與 mobile layout 收尾。

---

> 路線圖隨進度更新。完成一項時把 `[ ]` 改成 `[x]`。
