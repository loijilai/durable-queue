---
status: accepted (not yet implemented)
---

# Queue Wait 從 Worker 的 log 量測，不使用佇列內建指標

量測 Queue Wait 最直覺的候選是 broker 內建的「最舊訊息年齡」指標，但它的文件定義是
「最舊的**未刪除**訊息的年齡」—— 而因為 Worker 是延遲確認，In-flight Job 的訊息仍然
處於未刪除狀態。該指標因此回報的是 Queue Wait 加上已經過的 Execution Time，正好把
ADR-0001 費力分開的兩項又混了回去。改為由 Worker 在取得一份 Job 時，把等待時間寫成
structured log 行上的一個欄位，再以 log metric filter 將該欄位轉為 metric。

## Consequences

「最舊未刪除訊息年齡」仍然呈現在 dashboard 上，但正名為「最舊未完成 Job 年齡」——
這讓它成為 Completion Latency 的合理代理，也就是 ADR-0001 降級為觀測的那個東西。
應用程式不直接發送任何 metric；系統中的每一個 metric，若非受管服務內建，即由 log 行
導出。
