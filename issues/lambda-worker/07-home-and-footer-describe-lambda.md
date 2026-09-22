Status: open

# 07 — 首頁與頁尾描述 Lambda Worker，aws-infra 圖與 drawio 同步

**What to build:** 首頁的技術堆疊、部署管線與架構圖描述的是現在的系統：API 跑在 ECS Fargate，Worker 是 SQS 觸發的 Lambda，沒有 Celery。架構圖的 drawio 原始檔由使用者維護，前端顯示的 SVG 一律從它匯出，兩者保持同步。

**Blocked by:** None — can start immediately.

- [ ] 技術堆疊的 APPLICATION 層改為「Django REST Framework · SQS」，移除 Celery 圖示；ORCHESTRATION 層改為「ECS Fargate · Lambda · ALB」，detail 補一句 Worker 是 Lambda。
- [ ] 部署管線的最後一步由「roll ECS services」改為「roll API + update Lambda」。
- [ ] aws-infra SVG 由使用者目前版本的 drawio 原始檔以 draw.io CLI 匯出；drawio 原始檔的內容不做任何修改。首頁 alt text 依新匯出的圖重寫；圖的常數旁註明圖源位置與重新匯出的指令。
- [ ] 頁尾的 STACK 欄移除 Celery。
- [ ] Celery 圖示元件及其 registry 項目刪除，沒有任何地方再引用。
- [ ] `./scripts/verify.sh full` 通過（含前端 lint 與 build），並在本機瀏覽器確認首頁與頁尾正常顯示。
