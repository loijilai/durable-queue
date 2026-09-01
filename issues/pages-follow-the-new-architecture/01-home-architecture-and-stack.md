Status: done

# 01 — 首頁的架構圖與技術棧改說 SQS + ECS/Fargate

**What to build:** 讓首頁描述實際存在的系統。

首頁是整個網站的第一印象，也是唯一一張把全貌畫出來的圖所在的地方。它現在畫的是
ElastiCache Redis 與兩個 Auto Scaling Group —— 一個已經不存在的系統。讀者從這裡出發，
接下來每一頁看到的都會是矛盾。

架構圖的原始檔是未壓縮的 XML，直接編輯後用 `drawio` CLI 匯出一次即可；不需要為它補一支
build script，因為它只有一頁、沒有其他圖那種「從 master 頁衍生鏡頭頁」的邏輯。

SQS 的位置是這張圖唯一在拓撲上有意義的改動：它是 regional service，不在 VPC 裡，Worker
是經 NAT Gateway 出去打它的。把它畫在 `AWS Cloud` 框內、`VPC` 框外，而不是原地替換掉
Redis 那個方塊 —— 後者改動較小但位置是錯的，並且會跟 04 那張只講 VPC 內邊界的拓撲圖
互相打架。

`THE STACK` 那塊的 ORCHESTRATION 層要改說 ECS Fargate。`Kubernetes — next` 的低調標記
保留：ECS 到 Kubernetes 仍然是一個真實的下一步。APPLICATION 層的 Redis 圖示換成 `SQS`
字母牌而不是直接刪掉 —— 佇列是這整個專案的主題，把它從技術棧裡抹掉比留錯還糟；字母牌
的作法沿用 `BrandIcons` 既有的規則（AWS 自家服務沒有社群圖示，不自行仿畫商標），跟隔壁
CLOUD 層的 `AWS` 牌是同一套語彙。

`RedisIcon` 與 registry 裡的條目一併刪除。registry 的價值在於「這裡列的就是頁面上會出現
的」；留一顆沒人用的 Redis 圖示，下一個讀它的人會以為系統裡還有 Redis。

**Blocked by:** None — can start immediately.

- [x] 架構圖不再有 ElastiCache/Redis 與 Auto Scaling Group；運算層是 ECS/Fargate task，
      SQS 畫在 VPC 之外、由 Worker 經 NAT Gateway 抵達
- [x] 架構圖的 alt 文字描述的是圖上實際畫的東西
- [x] ORCHESTRATION 層改說 ECS Fargate，其 detail 描述的是現行的滾動更新而非 instance
      refresh；`Kubernetes — next` 標記保留
- [x] APPLICATION 層以 `SQS` 字母牌取代 Redis 圖示
- [x] pipeline 第五個 stage 的標籤與 ORCHESTRATION 層用同一個詞
- [x] `RedisIcon` 與 registry 條目刪除，footer 不再出現 Redis
- [x] 全頁搜尋不到 Redis、EC2、ASG 或 Auto Scaling
- [x] `./scripts/verify.sh full` 通過
