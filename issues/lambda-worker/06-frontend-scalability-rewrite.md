Status: done

# 06 — Scalability 頁改寫為 SQS → ESM → Lambda

**What to build:** 讀者在 Scalability 頁看到的是現在實際運行的系統：SQS 經 event source mapping 觸發 Lambda，併發上限 67，沒有自製的 control loop。可擴展性的主張只放 04 實測成立的部分——Job 在 Acceptance 後幾秒內就開始執行、超出上限的 Job 在佇列等待、全程零失敗——Worker Count 則照實描述為約 40 秒爬到 67、之後隨輪次起伏，不寫成「直接抵達上限並停住」。以 04 的數字與截圖作為證據。

**Blocked by:** 04 — 在 Lambda 上跑 250 jobs burst 實驗並記錄數字.

- [x] eyebrow「SCALE OUT」與主標「Throughput Scales With the Worker Pool」不變；副標改為「SQS Drives Lambda Up to 67 Concurrent Workers」。上限直接寫 67，不解釋它的來源（不談 RDS 連線預算）。
- [x] workload 圖（兩種 Submitter 那張 excalidraw）上的「worker pool (ECS service)」「scale 1 → 67」改為 Lambda / ESM、最多 67 concurrent 的字樣。圖下說明文字不變，不另加機制說明。
- [x] control loop 互動圖元件與它專用的樣式刪除，不以任何新圖或新元件替代；沒有任何頁面再引用它。
- [x] 證據區：一排數字卡（第一份 Job 的 Queue Wait 3.8s、T0+41.5s Worker Count 抵達 67、峰值 67、failed 0、DLQ 0）＋ 沿用證據輪播元件放 04 存進前端資產目錄的兩張 dashboard 截圖。圖說註明兩個讀圖陷阱：Worker Count 的線停在 04:26（最後一分鐘的資料點沒有出現）、Queue Wait 那條線是每分鐘平均而非分布。
- [x] 不放 Queue Wait 直方圖、不放 127.8s 完成時間、不與舊架構的完成時間對照。
- [x] 舊的 control loop 錄影（RecordingSlot）整段移除、不留 placeholder；舊實驗的三張證據截圖從資產目錄刪除。
- [x] 頁面程式碼不再引用 CONTEXT.md。
- [x] `./scripts/verify.sh full` 通過（含前端 lint 與 build），並在本機瀏覽器確認頁面正常顯示。
