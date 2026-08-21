---
status: accepted (not yet implemented)
---

# Observability 由內建指標與 structured log 構成，不做 tracing

系統中的每一個 metric，若非受管服務已經在發布，即是由 log 行經 metric filter 導出。
應用程式不發送任何屬於自己的 metric。佇列與編排平台的內建指標回答「現在健不健康」；
以 job id 為鍵的 JSON structured log 回答「這一份 Job 發生了什麼事」；單一 dashboard
把兩者放在同一條時間軸上，讓兩者之間能做因果推論。Execution Time 花在哪些階段的分解，
以臨機查詢對 log 取得，而不預先聚合成 metric。

Distributed tracing 刻意排除。tracing 的價值來自深且分岔的同步呼叫鏈；這個系統只有
兩個服務，中間隔著一個佇列，而以 job id 串接的 structured log 已經提供了 tracing 在
這個拓撲下所能給的一切。這是對「在系統目前的形狀下邊際價值多少」的判斷，不是宣稱
tracing 在一般情況下沒有必要 —— 服務數量成長時應當重新檢視。
