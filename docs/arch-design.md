# Durable Queue — Delivery Framework

> 面試敘事骨架，套用 HelloInterview Delivery Framework（Requirements → Core Entities → API → Data Flow → HLD → Deep Dives），並在 Requirements 之前加一段 Problem Background 交代架構選型的判斷過程。

## Problem Background

**Scenario**：User 送出一個 YouTube URL，系統要呼叫外部 API（OpenAI）把音訊轉成逐字稿（transcript）。

**為什麼不能同步做（在 HTTP request 裡直接轉錄完再回應）**：

1. 執行時間不可預期、且偏長——影片長度不一，轉錄可能幾秒到幾分鐘，取決於外部 API 延遲。
2. 依賴外部服務，會失敗、會被 rate limit——這是自己不能控制的變因。
3. HTTP request-response 有天生的時間上限——瀏覽器 timeout、ALB idle timeout（預設 60s）、使用者體感。

如果同步做：一個 request 綁住一個 web server 的 thread/connection 直到轉錄完成，等於用最貴的資源（API 服務容量）去等一件它不擅長等的事，而且沒有 retry 的自然位置——失敗了只能整個 HTTP request 重打。

**為什麼答案是「Queue」而不是其他非同步手段**：

- WebSocket / 長輪詢解決的是「client 怎麼知道完成」，不解決「工作本身在哪裡執行、失敗怎麼辦」。
- 用 queue（Celery + Redis）把「接收請求」和「執行工作」解耦：API 層只負責快速寫入 DB + 派工，worker 池才是真正花時間的地方。兩者可以各自獨立擴展（API 是 HTTP 併發驅動，worker 是 queue 深度驅動）。
- Broker 提供「未完成的工作留在系統裡、worker 掛了可以被別人接手」的機制——這是 durability 與 crash-recovery 的基礎。

**為什麼不能只用 async I/O（asyncio）取代 queue**：這是常見的追問，必須能分清楚兩者解決的是不同層次的問題。

- **asyncio 解決的是「同一個 process 內，thread 在等待外部 I/O 時不被浪費」**——本質是 process 內部的併發效率問題。
- **Queue 解決的是「這件工作還沒做完」這個事實，要不要依賴任何一個 process 存活**——本質是 durability / at-least-once delivery 的問題，兩者不衝突、不是取代關係。
- 關鍵區分點：asyncio 的 retry（`try/except` 加迴圈）只能撐過「process 還活著、但這次呼叫失敗」；一旦 process/pod 整個被殺掉（deploy、OOM、crash），連 retry 迴圈自己都消失了，沒有任何外部紀錄說「這件事還沒做完」。Queue 把這個紀錄放進 broker + DB，讓「未完成」這個狀態不依賴任何一個 process 是否存活。
- 附加效益：producer/consumer 解耦讓兩者可以獨立擴展；bounded worker pool 也提供了壓力暫存空間（backpressure）——讓 worker 依自己的消化速度處理，而不是把突發流量直接打向下游的 OpenAI API（此點目前為設計意圖，尚未做負載測試驗證）。

**Pattern 分類：Async Task Queue / Work Queue pattern**（與 email 發送服務、影片轉檔服務同一 archetype）。判斷用的 5 條特徵：

1. Producer–Consumer 解耦，中間有 broker。
2. 工作項目是持久化且可獨立重試的（不是丟了就算了）。
3. Consumer（worker）可以水平擴展，且擴展軸跟 producer 不同。
4. 需要 at-least-once + idempotency（因為 worker 會掛、會重複）。
5. 需要 visibility timeout / lease 機制處理 worker crash 後的回收。

這個專案 5 條全部命中。

---

## Requirements

**Functional**

1. User 送出一個 YouTube URL，系統立刻回傳 job id（不等轉錄完成）。
2. User 可以查詢 job 狀態（PENDING → RUNNING → SUCCEEDED / FAILED）。
3. 轉錄失敗可以 retry（自動 retry + 手動觸發）。
4. User 只能看到自己的 job（多租戶隔離）。
5. User 可以站內帳密登入，或 Google OAuth 登入。

**Non-functional**

- **Durability**：worker / API 掛掉，job 不會遺失、狀態可恢復。
- **At-least-once + idempotency**：重複執行同一個 job 不能產生錯誤結果。
- **Scalability**：API 層（HTTP 併發）和 worker 層（queue 深度）要能各自獨立 scale out。
- **Availability**：目前 single-AZ（已知 SPOF），multi-AZ 心智模型已建立、落地延後到 K8s 階段。
- **Security**：JWT-based authN/authZ、secret 不落地明文（Secrets Manager）、網路層 SG 隔離。

---

## Core Entities

- **User**
- **Job**（status, owner, attempt_count, claimed_at, created_at, finished_at）
- **Transcript**（未來：yt-dlp + OpenAI 接上後產生）

---

## API

- `POST /jobs` — 建立轉錄工作，body 帶 YouTube URL，回 `201` + job id。
- `GET /jobs/{id}` — 查詢單一 job 狀態，僅限 owner，非 owner 回 `404`（不洩漏資源存在性）。
- `GET /jobs` — 列出自己的 job（`owner` filter 天然隔離）。
- `POST /jobs/{id}/retry` — 手動 retry，僅 `FAILED` 狀態可觸發，否則 `409`；非 owner 回 `404`。
- Auth 一律走 `Authorization` header（JWT access token），不放在 request body。

---

## Data Flow

1. Client 呼叫 `POST /jobs`，API 寫入 DB（`status=PENDING`），立刻回應 job id。
2. API 呼叫 `execute_job.delay()`，經 Celery 派工到 Redis broker。
3. Worker 從 broker 取得任務（`acks_late=True`，未完成不會被提早移除）。
4. Worker 執行轉錄，成功寫回 DB `SUCCEEDED`，失敗依 `autoretry_for` / backoff+jitter 重試，達 `max_retries` 落地 `FAILED`（DB 作 dead-letter）。
5. Worker crash 或逾時未完成：`visibility_timeout` 到期後任務回到 broker，可被其他 worker 接手。
6. Client 用 `GET /jobs/{id}` 輪詢狀態，取得最終結果。

---

## High-Level Design

**架構**：Route53（子網域）+ ACM(443) → ALB（public subnet）→ EC2 api-ASG / EC2 worker-ASG（private subnet，各自獨立 scaling 軸）→ RDS Postgres（durable 狀態真相）+ ElastiCache Redis（broker + result backend）。NAT+IGW 管 private subnet 的 egress（拉 image、打外部 API）。

**分層邏輯**：

- api 與 worker 共用同一 image，用 `command:` 區分角色，各自的 ASG 依不同訊號擴縮（api 依 HTTP 併發、worker 依 queue 深度）。
- DB 是持久化真相來源，Redis 只是派工通道——這是本專案「durable」名稱的由來：即使 broker 重啟，job 狀態不丟。
- ALB 用 shallow health check（`/health/`，不碰 DB/Redis），避免下游一抖動就讓全 fleet 同時被判定 unhealthy。

![HLD](hld.png)

---

## Deep Dives

### 1. Concurrency under Distributed Queue

**問題**：多個 worker 同時搶同一個 job 會怎樣？鎖有沒有真的生效？

**我怎麼發現**：Phase 1 用 SQLite 手刻 `select_for_update(skip_locked=True)` + `transaction.atomic()`，測試全過。但 SQLite 的 `select_for_update` 其實是 no-op（`has_select_for_update=False`）——鎖從沒被真正驗證過。換成 Postgres 之後，用 `TransactionTestCase` + threads + `threading.Event` 刻意喬出交錯時序，才第一次真正測試併發行為。

**怎麼驗證 / 結論**：拿掉 `mark_failed` 的 `select_for_update`後發現——B 的「寫」仍被 A 的 `FOR UPDATE` 序列化（`FOR UPDATE` 也會擋普通 `UPDATE`），但 B 的 guard 讀到的是 stale 狀態，導致用錯誤資訊做決定（lost update）。加回鎖之後，B 的**讀**被卡到 A commit 之後才執行，guard 才看得到真相。

**核心洞見**：鎖真正保護的是 check-then-act 裡的「讀」，不是「寫」。

![Concurrency sequence](sequence-concurrency.png)

### 2. Scalability + Stateless AuthN

**問題**：API 和 worker 要能各自水平擴展，前提是什麼？

**設計**：api 與 worker 是同一 image、不同 `command:`，各自的 ASG 依不同訊號擴縮，因為擴展軸本質不同（HTTP 併發 vs queue 深度）。要讓 api 層可以隨意加減 instance 而不互相依賴，必須是 **stateless**——這正是選擇 JWT（access + refresh，放 response body，不用 session/cookie）的關鍵理由：session-based auth 需要黏 sticky session 或共享 session store，等於在 stateless 的擴展模型裡人為加了一個有狀態依賴。

**代價要能講清楚**：JWT stateless 換來的代價是難以即時 revoke（登出/停權後舊 token 在過期前仍有效）→ 用 access 短效期 + refresh 換新緩解。

![Annotated HLD: scalability](hld-annotated-scalability.png)

### 3. Security

**問題**：雲端架構下，「准不准進來」和「有沒有路可以到」是兩件事，你怎麼分別處理？

**設計**：

- **授權（准不准）＝ Security Group**：SG 引用 SG，EC2 的來源只允許 SG-alb；RDS/ElastiCache 的來源只允許 {SG-api, SG-worker}（api 與 worker 都是 client，一個都不能漏）。
- **可達性（有沒有路）＝ route table**：private subnet 出向靠 `0.0.0.0/0 → NAT`（NAT 在 public subnet）→ 再經 IGW 出 internet；NAT 只帶「由內發起」連線的回程，internet 無法主動打進來。
- **CI/CD 免長期憑證**：GitHub OIDC 換 short-lived AWS credential，bootstrap（IAM role，永久）與 app-infra（日常生滅）分開兩份 state。
- **Secret 不落地明文**：app secret 用 `aws_secretsmanager_secret` 只建容器、值帶外 CLI 注入，明文永不進 `.tf` / tfstate；user_data 裡機密欄位靠開機時 `get-secret-value` 撈，避開 IMDS 全機可讀的風險面。

![Zoom-in: Security](deep-dive-security.png)

---

## 延後項目（Placeholder，非遺漏）

- **High Availability（Multi-AZ）**：目前 subnet 綁單一 AZ，v1 是 single-AZ = SPOF。心智模型已建立（RDS Multi-AZ standby+failover、ElastiCache 跨 AZ replica、ASG 跨 AZ 分散、ALB 天生跨 AZ），但刻意延後到 K8s 階段一併處理（屆時 broker 也會從 Redis 換成 SQS，HA 拓樸會整套重新評估，此時再做才不會白工）。這是**優先序判斷**，不是能力缺口。

