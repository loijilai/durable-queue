Status: done

# 08 — Durability 頁的三張卡涵蓋一次執行的三種結局

**What to build:** Durability 頁 stepper 的三張卡依序講一次執行可能的三種結局——成功、Worker 整台 crash、暫時性錯誤——合起來就是這個 queue 的 durable 設計。第三張卡原本假設「Worker 執行時間超過 visibility timeout」，這在 Lambda 下不成立，改為「暫時性錯誤 → ChangeMessageVisibility → retry」。DLQ 不講。

**Blocked by:** None — can start immediately.

- [x] 第一張（成功）與第二張（crash / visibility timeout）不變。
- [x] 第三張改為暫時性錯誤：Worker 縮短訊息的 visibility，SQS 在 backoff 之後重送。term 為「Retry with Backoff + Jitter」，數字與程式碼一致：base 30s、上限 300s、equal jitter、最多執行 4 次，之後 Job 標為 failed。
- [x] 第三張的 arch 圖與 timeline 以 excalidraw 重畫，版面與前兩張的 arch 圖相同，只換標註。原本「worker stuck → duplicate」的 arch 圖與 race condition timeline 刪除，沒有任何地方再引用。
- [x] 原本獨立的 Step 5（retry）卡片與它的 CSS 示意圖刪除。
- [x] Step 4（race condition & idempotency）保留，動機改為「SQS 是 at-least-once，同一份 Job 可能送達兩次」；「At-least-once delivery」這個 term 移到這裡。
- [x] eyebrow 依序為 STEP 1–4。
- [x] `./scripts/verify.sh full` 通過（含前端 lint 與 build），並在本機瀏覽器確認頁面與三張卡的切換、timeline 開合正常。
