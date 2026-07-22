# Frontend Roadmap

> 對應 [Backend Roadmap](backend.md) 的「四、Presentation（呈現層）」階段。前端要展示 durable queue 的關鍵設計決策（async job、狀態輪詢、auth、retry、scalability、HA）給面試官看，不是單純把功能刻完。

## 背景與目標

`durable-queue` 目前是純後端專案，尚無前端。這份 roadmap 的目的是規劃一個給面試官看的 demo 前端，涵蓋四大主題。視覺風格套用既有的 [DESIGN.md](../../DESIGN.md) 設計系統。

整個前端頁面必須用英文。

**技術選型（已與使用者確認）**：React + Vite，本地跑（`npm run dev` 打本地 Django）。

## 前置準備事項

- [ ] **CORS 設定**：屬於後端改動，本輪 roadmap 不做，先列為前置準備事項，前端開發前需先完成。
- [ ] **Concurrency demo log**：2-1 節需要的兩個 thread 交錯時間戳記 log，需使用者手動跑一次併發測試產生，非前端自動產生。

---

## 功能清單（依四大主題）

### 1. Authentication

- [ ] 登入 / 註冊表單頁面，打真實的 `/api/auth/token/`、`/api/auth/register/` endpoint。
- [ ] 顯示過程經歷哪些步驟。
- [ ] 「Inspect my token」面板：前端當場用瀏覽器內建方式（非後端 API）解碼 JWT payload，秀出 exp/iat/user_id 等欄位給面試官看，並顯示距離過期的即時倒數，藉此具體展示「stateless」這個概念。

### 2. 核心功能頁面：Distributed Queue & Async Pattern

- [ ] URL 提交表單：貼 YouTube URL → 呼叫真實 `POST /api/jobs/`，立刻拿到 job id。
- [ ] Job 狀態 timeline：PENDING → RUNNING → SUCCEEDED/FAILED，用輪詢真實 `GET /api/jobs/{id}` 更新，不是假動畫。
- [ ] 文案用「Job created, now processing asynchronously」（英文）。

### 2-1. Concurrency Issues（併發問題）

> 定位為「靜態教學卡片」而非即時 API demo，分三步驟展開：

- [ ] 展示真實程式碼（`select_for_update` 鎖的實作 + 併發測試程式碼）。
- [ ] 展示 sequence diagram（先用 placeholder 頂著，待補真圖）。
- [ ] 展示真實跑出來的測試 log（兩個 thread 的時間戳記，證明鎖真的序列化了寫入）——這份 log 需要使用者手動產生（見前置準備事項）。

### 3. Scalability（Scale out worker / API）

- [ ] 「Generate Load」按鈕：一次觸發約 20~50 個 job 建立請求（前端連續呼叫既有的單一 job API，不新增後端 bulk endpoint）。
- [ ] Queue 深度即時圖表：用輪詢既有 job 列表 API，統計「pending + running」數量畫成隨時間變化的圖，直觀呈現「負載進來、worker 慢慢消化」的 backpressure 現象。
- [ ] 明確標示：這個深度是「DB 狀態的代理指標」，不是 Redis/Celery broker 的真實 queue 深度；並附文字說明「真正的 ASG 擴縮要花幾分鐘，無法在 demo 中即時展示，這裡展示的是真實可觀察的 buffering 行為」。
- [ ] 旁邊放 scalability 架構圖（placeholder 頂著）。

### 4. High Availability

> 先用 placeholder，本輪不做。定位為「投影片式」靜態區塊，不假裝做了 HA：

- [ ] 架構圖（placeholder 頂著）。
- [ ] 「目前 single-AZ，已知 SPOF」的標示。
- [ ] Multi-AZ 路徑打勾清單：RDS standby、ElastiCache replica、ASG 跨 AZ（此項目前已實作，可打勾）。
- [ ] 一句話說明：刻意延後到 K8s 階段一併做，因為屆時 broker 也會換成 SQS，HA 拓樸要整套重新評估，這是判斷力的呈現而非逃避。

---

> 路線圖隨進度更新。完成一項時把 `[ ]` 改成 `[x]`。
