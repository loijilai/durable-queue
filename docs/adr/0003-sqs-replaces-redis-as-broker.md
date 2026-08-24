---
status: accepted (not yet implemented)
---

# SQS 取代 Redis 成為 broker

Redis 與 SQS 都能提供這個系統需要的投遞語意 —— at-least-once、visibility timeout、
Worker 死亡後重新投遞 —— 所以投遞語意分不出高下；在尖峰不過數百份 Job 的規模下，
吞吐量也分不出高下。真正做出決定的是：驅動容量決策的 Backlog 訊號，以及餵給 dashboard
的佇列指標，在 SQS 是免費且受管的；換成 Redis 就得自己建置並維運一個發布器。而且
Redis 是我們目前唯一一個沒有其他東西依賴的有狀態元件。

## Considered options

另一個選項是保留 Redis，定時把佇列長度發布到監控系統。它可行，但代價是我們得自己
擔起「容量決策所依賴的那個訊號」的可用性責任，而換回來的好處說不出一個名字。

## Consequences

Celery 的 result backend 是刪除而非遷移：它有設定但從來沒有人讀取，因為 Job 狀態的
真相在 Postgres。移除 Redis 因此是一個元件的消失，不是替換。我們失去 Celery 的遠端
控制與事件機制，Flower 這類工具會失效 —— 它們本來就沒在用。應用程式碼完全不動；
這件事本身就是證據，說明 Celery 這層抽象值得它的成本。
