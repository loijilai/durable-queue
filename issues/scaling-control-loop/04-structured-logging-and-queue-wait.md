Status: open

# 04 — Structured logging 與 Queue Wait 的發出

**What to build:** 讓系統能回答「這一份 Job 發生了什麼事」，以及「它等了多久才被
取走」。

應用程式的日誌改為 JSON 結構化輸出，每一行帶 job id。Worker 在取得一份 Job 時，額外
輸出這份 Job 的等待時間 —— 從 Acceptance 到被取走之間的間隔（Job 的建立時間已經存在
於資料表，不需要新欄位）。這個發出掛在 task 的生命週期 signal 上，不侵入業務邏輯。

**為什麼不用佇列內建的「最舊訊息年齡」指標**：它的定義是最舊的*未刪除*訊息的年齡，
而 Worker 是延遲確認，In-flight Job 的訊息尚未刪除。該指標因此是等待時間加上已執行
時間，正好把我們刻意分開的兩項又混回去。這是這張票存在的原因。

執行過程的各階段也各自輸出耗時，好讓 Completion Latency 劣化時能分辨原因是排隊還是
執行。失敗則記錄其分類原因。

這張票只負責把訊號發出來；把它變成 metric 是 08 的事。

**Blocked by:** None — can start immediately.

- [ ] 應用程式日誌為 JSON 結構化輸出，每行帶 job id
- [ ] Worker 取得 Job 時輸出等待時間欄位，且有測試斷言該行的發出與其內容
- [ ] 下載、重新編碼、轉錄三個階段各自輸出耗時
- [ ] 失敗記錄其分類原因，可據以區分下游節流與輸入問題
- [ ] 應用程式未呼叫任何 metric 發布介面
- [ ] 在本機 stack 的日誌輸出中可實際觀察到上述所有欄位
- [ ] `./scripts/verify.sh full` 通過
