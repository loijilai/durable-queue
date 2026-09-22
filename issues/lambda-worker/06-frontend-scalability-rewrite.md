Status: done

# 06 — Scalability 頁改寫為 SQS → ESM → Lambda

**What to build:** 讀者在 Scalability 頁看到的是現在實際運行的系統：SQS 經 event source mapping 觸發 Lambda，併發上限 67，沒有自製的 control loop。證據區只回答一個問題：250 份 Job 同時進來，多久做完。以 04 的數字作為答案、dashboard 截圖證明有監控，其餘細節留給口頭說明。

**Blocked by:** 04 — 在 Lambda 上跑 250 jobs burst 實驗並記錄數字.

- [x] eyebrow「SCALE OUT」與主標「Throughput Scales With the Worker Pool」不變；副標改為「SQS Drives Lambda Up to 67 Concurrent Workers」。上限直接寫 67，不解釋它的來源（不談 RDS 連線預算）。
- [x] workload 圖（兩種 Submitter 那張 excalidraw）上的「worker pool (ECS service)」「scale 1 → 67」改為 Lambda / ESM、最多 67 concurrent 的字樣。圖下說明文字不變，不另加機制說明。
- [x] control loop 互動圖元件與它專用的樣式刪除，不以任何新圖或新元件替代；沒有任何頁面再引用它。
- [x] 證據區只回答「250 份 Job 同時進來，多久做完」：標題「250 Jobs at Once, All Done in 128 Seconds」，一段說明文字交代每份 24 秒、Lambda 擴到 67 的上限、最長等待 98 秒、零失敗。沒有數字卡。
- [x] 沿用證據輪播元件放 04 存進前端資產目錄的兩張 dashboard 截圖，用途是證明有監控，不附圖說；讀圖細節（每分鐘解析度、最後一分鐘的資料點沒出現、Queue Wait 是平均值）與「24 秒約等於 8 分鐘影片」、第一份 Job 的 3.8s、41.5s 抵達 67 都留給口頭說明。
- [x] 不放 Queue Wait 直方圖、不放從 log 重建的圖、不與舊架構的完成時間對照。
- [x] 舊的 control loop 錄影（RecordingSlot）整段移除、不留 placeholder；舊實驗的三張證據截圖從資產目錄刪除。
- [x] 頁面程式碼不再引用 CONTEXT.md。
- [x] `./scripts/verify.sh full` 通過（含前端 lint 與 build），並在本機瀏覽器確認頁面正常顯示。
