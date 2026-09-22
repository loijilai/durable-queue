Status: done

# 05 — README、架構圖與註解清理，刪除 CONTEXT.md

**What to build:** repo 裡的文件、架構圖與程式碼註解都描述「SQS 觸發 Lambda Worker、ESM 併發上限 10」的系統。沒有任何地方再描述 ECS worker、step scaling control loop 或 Celery，也沒有任何地方引用已經不存在的檔案。CONTEXT.md 是不再維護的過時文件，直接刪除。依本次決策直接清除，不另寫 supersede 記錄。

**Blocked by:** 03 — 對齊 Lambda 併發上限，重試改數真正的執行次數.

- [x] 刪除 CONTEXT.md，並移除所有指向它的引用（AGENTS.md 的語言規則、Batch Submitter 腳本的 docstring 等）。`docs/agents/` 下的檔案是逐字保留的 skill seed，不修改。前端頁面中的引用留給 06。
- [x] README 與架構圖（AWS 基礎設施、C4、部署管線等 diagram 原始檔及其產出）改為 Lambda，移除 worker Fargate service 與 autoscaling。
- [x] 全 repo（`issues/` 目錄本身除外）搜尋任何 ADR 編號、任何指向 `issues/` 下檔案的路徑，以及 control loop、step scaling、Celery、`acks_late`、prefetch、`autoretry_for`；相關註解一律刪除或改寫，不留下指向不存在檔案的引用（前端頁面內容除外，留給 06）。
- [x] `./scripts/verify.sh full` 通過。
