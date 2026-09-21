Status: open

# 06 — 前端改寫 Scalability 頁與首頁

**What to build:** 網站讀者看到的是現在實際運行的系統：SQS 觸發 Lambda，ESM 的併發上限是 10，沒有自製的 control loop。可擴展性的主張是「形狀」——Job 在 Acceptance 後幾秒內就開始執行、Worker Count 直接抵達上限並停住、超出上限的 Job 在佇列等待、全程零失敗——以 04 的數字與截圖作為證據。

**Blocked by:** 04 — 在 Lambda 上跑 250 jobs burst 實驗並記錄數字.

- [ ] Scalability 頁改寫為 SQS → ESM → Lambda、併發上限 10 的敘事。上限直接寫 10，不解釋它的來源。
- [ ] control loop 互動圖元件刪除，沒有任何頁面再引用它。
- [ ] 證據截圖輪播換成 04 存進前端資產目錄的 dashboard 截圖，並呈現 04 記錄的形狀數字：第一份 Job 的 Queue Wait、Worker Count 抵達上限的時間與峰值、失敗與 DLQ 數。不與舊架構的完成時間對照。
- [ ] 首頁的架構與 workload 描述改為 Lambda Worker，移除 ECS worker 與 step scaling 的字樣。
- [ ] 其他頁面（例如 HA 頁、Security 頁）中提到 worker Fargate service 或 autoscaling 的地方同步修正；所有頁面不再引用 CONTEXT.md。
- [ ] `./scripts/verify.sh full` 通過（含前端 lint 與 build），並在本機瀏覽器確認頁面正常顯示。
