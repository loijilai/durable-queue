Status: done

# 02 — 所有 excalidraw 圖資產改說 SQS

**What to build:** 讓 Durability 頁的六張圖，以及 Scalability 頁那張漏網的圖，標的是實際
在跑的 broker。

這張票只換字，不動敘事。值得先講清楚為什麼可以這樣做：Durability 頁的骨架是「每一步的
解法生出下一個失敗模式」，而這條因果鏈在 SQS 上比在 Redis 上更成立 —— visibility timeout
本來就是 SQS 的原生概念，先前在 Redis 上是 Celery 模擬出來的。換完之後現有文字從「約略
成立」變成「字面成立」，所以不需要為它補一段辯護，補了反而會岔開因果鏈。

`2-1` / `2-2` / `3-1` 三張的副標 `broker / queue` 原樣保留。

六張 `.excalidraw` 在 `docs/diagrams/rendered/` 底下有對應的 PNG render，被 README 引用。
PNG 是原始檔的 render，不是獨立內容，所以跟原始檔在同一次改動裡保持一致 —— 這是「原始檔
是唯一真相」這個契約的一部分。README 的**文字與論證**不在這張票的範圍，那是
`issues/scaling-control-loop/12` 的事。

順帶修掉 Scalability 頁 `5-two-submitters` 上殘留的 `worker pool (ASG)`：那一頁的敘事
已經更新過，這是唯一漏掉的一處。同一張圖上的 `scale 1 → 67` 標註對得上
`infra/worker_autoscaling.tf`，不要動。

不要碰 `5-scale-out.excalidraw`。它已經沒有任何前端使用者，並且排定要跟它的 PNG、
`check_repo_contract.py` 的兩筆宣告、README 的引用四者一起退役 —— 那是
`issues/scaling-control-loop/12` 的範圍，單獨動它會踩到 REPO004。

**Blocked by:** None — can start immediately.

- [x] Durability 頁六張圖的 `Redis` 標籤改為 `SQS`，副標與其他文字不變
- [x] 六張對應的 `docs/diagrams/rendered/*.png` 重新產生，與原始檔一致
      —— 實際只有五張：`2-2-worker-succeed-timeline` 從來沒有 PNG render，也不在
      `check_repo_contract.py` 的宣告清單裡；補一張會是這張票沒授權的契約改動。
- [x] `5-two-submitters` 的 worker pool 標籤改說 ECS service，`scale 1 → 67` 不變
- [x] `5-scale-out.excalidraw` 未被修改
- [x] Durability 與 Scalability 兩頁在瀏覽器中渲染正常，圖上不再出現 Redis 或 ASG
- [x] `./scripts/verify.sh full` 通過
