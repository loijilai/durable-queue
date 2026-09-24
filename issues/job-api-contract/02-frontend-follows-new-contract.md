Status: open

# 02 — 前端：Queue 頁面改用新的 Job 合約

**What to build:** Queue 頁面看起來與現在一模一樣——一樣的列表、一樣被裁切的逐字稿
預覽、一樣的「Show more」與複製按鈕——但輪詢拿的是不含逐字稿全文的摘要。使用者按
「Show more」或複製時，前端才去取該 Job 的全文。送出新 Job 與按下 Retry 之後，
前端重抓列表，不再用寫入端點的回應覆蓋本地狀態。

見 spec：「逐字稿改由 detail 取得」、「寫入端點有自己的回應型別」。

**注意：** 與 01 在同一分支完成後一起 merge、一起部署。

**Blocked by:** 01 — 後端：Job 的讀寫回應分成三個 serializer。

- [ ] API client 的 Job 型別拆成摘要與完整兩種，分別對應 list 與 detail 的回應；兩者都不再有 `owner`。
- [ ] API client 加回取單一 Job 的函式，對應 `GET /api/jobs/{id}/`。
- [ ] 建立 Job 的函式回傳型別改為只有 `id`、`status`、`created_at`；retry 的函式不再回傳 Job。
- [ ] 送出新 Job 成功後，前端重抓列表，而不是把回應插進本地陣列。送出中與失敗的既有行為不變。
- [ ] 按下 Retry 成功後，前端重抓列表，而不是替換本地那一列。輪詢 effect 照常接手追蹤該 Job 直到終態。Retry 的錯誤訊息（例如 `409`）顯示行為不變。
- [ ] 列表渲染逐字稿預覽，裁切外觀、漸層遮罩、字級與現在一致；「Show more」出現的條件改用全文長度判斷，門檻與現在相同。
- [ ] 按下「Show more」時取回全文並展開；展開期間有載入指示，取回失敗時顯示錯誤且不破壞該列的其他內容。同一筆已取回的全文不重複請求。
- [ ] 按下複製按鈕時取回全文並寫入剪貼簿；已取回過的不重複請求，複製成功的打勾回饋行為不變。
- [ ] `AuditTrail` 仍從列表資料取得 `worker_attempts`，不需要額外請求。
- [ ] 手動驗證：送出一份 Job 走完 pending → running → succeeded，逐字稿預覽、展開、複製都正常；對一筆 failed 的 Job 按 Retry，該列回到 pending 並被輪詢追到終態。
- [ ] `./scripts/verify.sh full` 通過。
