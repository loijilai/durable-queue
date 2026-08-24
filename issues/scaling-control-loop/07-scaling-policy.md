Status: open

# 07 — Scaling policy

**What to build:** 這是整個 feature 的核心：讓容量真的接上一個訊號。這張票結束時，
Backlog 上升會使 Worker 數量上升，Backlog 被消化後容量會縮回，全程沒有人介入。

三個決定在假定了慣例做法的讀者眼中都會像是做錯了，實作時必須完整保留：

- **用 step scaling，不用 target tracking。** target tracking 假設它的指標隨容量上升
  而下降，像 CPU 使用率那樣。Backlog 由 submitter 送進來多少決定，與 Worker 有幾個
  沒有這種關係，硬套會震盪。
- **最小容量是 1，不是 0。** 擴容門檻是為吸收 burst 而設的，Interactive Submitter 的
  單一 Job 永遠達不到它；從 0 出發那份 Job 會無限等待。最小容量服務互動延遲，
  scaling policy 服務批次吞吐 —— 兩種 submitter，兩個機制。
- **縮容同時檢查 Backlog 與 In-flight Job。** Backlog 為空不代表系統閒置，而容器停止
  的寬限期上限遠短於一份 Job。只看 Backlog 就縮容會砍掉執行中的工作。因為 05 把併發
  設為 1，不可見訊息數直接就是 In-flight Job 數，這個條件不需要任何額外機制。

Scaling Ceiling 從下游容量推導 —— 資料庫連線上限與轉錄 API 的 rate limit —— 取遠低於
兩者的值。超出的工作留在 Backlog 等待：刻意讓延遲上升以保護下游。

visibility timeout 同樣從 02 的量測推導。它是一個張力而非自由參數：太短會讓仍在執行的
Job 被投遞給第二個 Worker，太長會拉長 Worker 猝死後的復原時間。

**所有參數都必須能回溯到 02 的量測或一個寫下來的下游限制，不得為選定的常數。**

**Blocked by:** 02, 05

- [ ] Worker 依 Backlog 以 step scaling 擴容，未使用 target tracking
- [ ] 最小容量為 1
- [ ] 縮容條件同時檢查 Backlog 與 In-flight Job 兩者皆低
- [ ] Scaling Ceiling 的數值可回溯到寫下來的下游容量限制
- [ ] visibility timeout 的數值可回溯到 02 的量測
- [ ] 手動送出一小批 Job 可觀察到容量上升，消化後觀察到容量縮回
- [ ] 縮容過程中沒有 In-flight Job 被中止
- [ ] 每個參數的推導依據記錄在基礎設施程式碼或此 feature 目錄中
- [ ] `./scripts/verify.sh full` 通過
