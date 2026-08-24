---
status: accepted (not yet implemented)
---

# 一個 Worker 一份 Job，預取倍數為一

一個 Worker 其實可以同時多工處理數份 Job —— Execution Time 的大部分都花在等待下游
API —— 而且這樣每個容器的使用效率會高得多。我們刻意不這麼做。當一個 Worker 只處理
一份 Job、預取倍數為一時，三個數量會收斂成同一個數字：運行中的容器數、In-flight Job
數、以及容量決策增減的單位。於是每一個容量訊號的意義，都與它表面看起來的意義相同。

## Consequences

我們付出的代價是 Worker 等待轉錄 API 時閒置的 CPU。換回來的是：不可見訊息數精確等於
In-flight Job 數，這正是 ADR-0006 的縮容條件之所以能在不增添任何機制的情況下正確運作
的原因；以及 Backlog 真的是 Backlog，而不是已經被某個 Worker 囤進本地緩衝區的工作 ——
這正是 Backlog 指標不會對讀取它的 policy 說謊的原因。

要注意的是，預取倍數只要大於一，無論併發數如何選擇，Backlog 訊號都會壞掉：被預取的
訊息會轉為不可見，於是 Backlog 看起來被消化了，實際上工作只是移動到一個觀測不到的
地方。
