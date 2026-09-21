Status: open

# 05 — 前端改寫 Scalability 頁與首頁

**What to build:** 網站讀者看到的是現在實際運行的系統：SQS 觸發 Lambda，由平台依 Backlog 擴張到固定的 Scaling Ceiling，沒有自製的 control loop。可擴展性的主張以 03 的 burst 實驗數據與截圖作為證據。

見 spec：「文件與前端」中的前端一項。

**Blocked by:** 03 — 在 Lambda 上重跑 250 jobs burst 實驗並記錄數字.

- [ ] Scalability 頁改寫為 SQS → ESM → Lambda、`maximum_concurrency = 67` 的敘事，說明 Scaling Ceiling 仍由 RDS 連線預算推導。
- [ ] control loop 互動圖元件刪除，沒有任何頁面再引用它。
- [ ] 證據截圖輪播換成 03 的 dashboard 截圖，並呈現 03 記錄的完成時間與 Worker Count 峰值。
- [ ] 首頁的架構與 workload 描述改為 Lambda Worker，移除 ECS worker 與 step scaling 的字樣。
- [ ] 其他頁面（例如 HA 頁、Security 頁）中提到 worker Fargate service 或 autoscaling 的地方同步修正。
- [ ] `./scripts/verify.sh full` 通過（含前端 lint 與 build），並在本機瀏覽器確認頁面正常顯示。
