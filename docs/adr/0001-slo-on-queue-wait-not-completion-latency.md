---
status: accepted (not yet implemented)
---

# 服務水準目標訂在 Queue Wait，而非 Completion Latency

Completion Latency 是 Queue Wait 加上 Execution Time，而 Execution Time 由送進來的
影片長度決定 —— 執行期間沒有任何系統行為能移動它。對端到端的完成時間做承諾，等於
承諾一個容量決策防守不了的數字：一支夠長的影片，即使 Backlog 為空也會破線。因此我們
把目標訂在 Queue Wait，這是我們手上每一根容量控制桿都直接作用的量，另一項則改用
Admission Limit 去限制。

## Consequences

Completion Latency 仍然被觀測與繪製 —— 它才是 submitter 實際感受到的東西 —— 但它是
診斷用的指標，不是承諾。當它劣化時，把它拆成兩項就能立刻分辨原因是容量（可以處理）
還是輸入長度（那是 Admission Limit 的問題，不是維運問題）。
