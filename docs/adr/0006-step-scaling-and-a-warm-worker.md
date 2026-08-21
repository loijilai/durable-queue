---
status: accepted (not yet implemented)
---

# 容量：以 Backlog 做 step scaling、保留一個常駐 Worker、上限來自下游

容量設計裡有三個決定，在假定了慣例做法的讀者眼中都會像是做錯了，因此一併記錄。

**用 step scaling，不用 target tracking。** target tracking 假設它的指標會隨著容量
上升而下降，就像 CPU 使用率那樣。Backlog 不是這種指標：它由 submitter 送進來多少決定，
與 Worker 有幾個沒有這種關係，硬套上去會震盪。要讓它能用，得先把 Backlog 除以 Worker
數量做正規化 —— 那是我們在這個規模不需要的機械裝置。

**最小容量是一，不是零。** 對一個以佇列為核心的系統，縮到零是很誘人的一步，但擴容
門檻是為了吸收 Batch Submitter 的 burst 而設定的，而 Interactive Submitter 的單一
Job 永遠達不到那個門檻。從零出發，那份 Job 會無限等待。最小容量服務的是 Interactive
Submitter 的延遲，scaling policy 服務的是 Batch Submitter 的吞吐。兩種 submitter，
兩個機制 —— 把它們併成一個，輸的那一方就會壞掉。

**上限來自下游，不是來自 compute。** Scaling Ceiling 設在遠低於資料庫連線上限與轉錄
API rate limit 的位置。超過它的工作留在 Backlog 等待。這是刻意的：我們讓延遲上升去
保護一個依賴，而不是讓那個依賴失效。

## Consequences

縮容的觸發條件是 Backlog **與** In-flight Job 兩者皆低，而不只看 Backlog。Backlog
為空不代表系統閒置 —— 一份長時間執行的 Job 背後可能什麼都沒排隊 —— 而 Fargate 的
容器停止寬限期上限只有兩分鐘，遠短於一份 Job。只看 Backlog 就縮容會砍掉執行中的
工作：durability 仍然成立，因為它會被重新投遞，但那是浪費且令人困惑的。ECS 的
task scale-in protection 是為此打造的機制，這裡用不到它，唯一的原因是 ADR-0005 讓
In-flight 數量直接可用。
