Status: open

# 03 — 把 broker 換成 SQS，在本機驗證

**What to build:** 把 Celery 的 broker 從 Redis 換成 SQS，並在本機以 SQS 相容服務
完整跑通。這張票結束時，一位開發者可以在沒有任何雲端帳號的情況下 `docker compose up`，
從 API 送出一份 Job，看著它被 Worker 取走並抵達終態。

這是設定變更，不是程式碼遷移：Job 的處理邏輯、dispatch 的呼叫、task 的宣告都不應
改動。如果這張票動到了業務邏輯，那代表做法錯了。

三件必須一起發生的事：

- **Result backend 刪除而非遷移。** 它有設定但從來沒有人讀取，Job 狀態的真相在
  資料庫。把它一起帶進新系統，等於把死設定當成資產。
- **預取倍數設為 1。** 這不是效能調校，是指標正確性的前提：被預取的訊息會轉為不可見，
  Backlog 會顯示成已被消化，而工作其實只是移動到一個觀測不到的地方。之後每一個容量
  訊號都建立在這個設定上。
- **Redis 從本機 stack 完全消失。** 這是一個元件的消失，不是替換。

**Blocked by:** None — can start immediately.

- [ ] 本機 stack 以 SQS 相容服務取代 Redis 容器，不需任何雲端憑證
- [ ] 從 API 送出的 Job 在本機環境走到終態
- [ ] Job 處理邏輯、dispatch 呼叫與 task 宣告未被修改
- [ ] Celery result backend 的設定與讀取路徑一併移除
- [ ] 預取倍數設為 1，且該設定的實際生效值有測試斷言
- [ ] 環境變數對帳檢查在新的設定清單下通過
- [ ] `./scripts/verify.sh full` 通過
