---
status: accepted (not yet implemented)
---

# Worker 跑在 ECS/Fargate；Lambda 已評估並否決

我們評估過把 Worker 遷移到 Lambda，結論是遷移成本中等且完全可行。否決它的是一個硬
衝突：系統目前已經接受長達四小時的影片，而一支四小時影片的 Execution Time ——
十餘次分段轉錄呼叫，加上下載與重新編碼 —— 很可能超過 Lambda 的十五分鐘上限。它的
失敗形式是這個專案所能遭遇最糟的一種：一份已被 accept 的 Job，被中止、重新投遞、
再次被中止，最後進入 dead-letter queue，期間已經向下游 API 計費三次。採用 Lambda
就意味著把 Admission Limit 降到約九十分鐘 —— 讓執行環境的限制反過來決定產品政策。

## Considered options

Lambda 通常最大的好處是「擴展不再需要你設計」，但這個好處在此不成立：我們的
Scaling Ceiling 是由下游容量決定的（見 ADR-0006），所以無論如何都得手動推導一個
併發上限。我們會交出控制桿，卻不會因此免於思考。

## Consequences

如果 Admission Limit 日後被降到能舒服地容納在十五分鐘之內，Lambda 就會是更好的答案，
屆時應重新開啟這個決定。記錄於此，是為了不必從頭再評估一次。
