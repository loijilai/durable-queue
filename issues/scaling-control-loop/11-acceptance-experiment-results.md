# 11 — 驗收實驗：執行前寫定的參數與通過條件，以及判讀結果

這份文件分成兩半。**上半在實驗執行之前寫定，執行後不修改**；下半在執行之後填入。
這個順序就是這次驗收之所以是驗收測試、而不是展示的全部理由。

---

## 前置聲明：實驗跑在 Load Model 上

容量實驗不跑真實轉錄（ADR-0010）。`infra/shared.tf` 的 `transcriber = "fake"`，
`transcribe_seconds = 24`。

被替換掉的是**不受測的元件**：真實轉錄的耗時隨挑到哪些影片而變動，而且一次數百份
Job 的 burst 裡每一份都向下游計費。受測的是佇列的吸收能力與控制迴路。

真實轉錄的正確性**不由這次實驗宣稱**，另以少量真實 Job 單獨驗證，記錄在本文最後
一節，與容量結論分開報告。

## Load Model 的取值與它的偏離

ticket 原文寫的是「Execution Time 由設定指定為 02 量測得到的平均值」，也就是
91.871s（02 四個樣本 total_seconds 的平均：23.747 / 36.979 / 118.801 / 187.957）。
**這次實驗沒有用這個值，用的是 24s。這是一個偏離，寫在這裡而不是藏起來。**

- **取的是什麼**：02 四個樣本中最短的一支（8m34s 的影片）實測的 total 23.747s，
  取整為 24。它仍然是 02 實際量到的一個數，不是為了配合時間預算捏造的常數。
- **為什麼偏離**：以平均值 91.871s 執行，一次實驗約需 **29 分鐘**，峰值 31 個
  Worker——後者超過本帳號 30 vCPU 的 Fargate 配額。時間預算是一個真實的限制，
  把它寫出來，比讓一份文件宣稱用了平均值、實際跑的是別的數字要好。
- **代價是什麼**：這場實驗代表的工作負載組成從「02 的樣本平均」變成「02 樣本中
  最短的那一支」。因此**不能**用這次的結果去宣稱平均長度影片下的吞吐或容量絕對
  值。六條通過條件裡，只有第 3 條（Queue Wait 峰值）的數值與這個取值相關，而它的
  門檻本來就是從這個取值推導出來的，其餘五條與 Execution Time 的絕對值無關，
  判讀不受影響。
- **什麼情況下該回頭用平均值**：當有人要拿這份實驗去回答「這套容量能撐多少真實
  流量」時。那是一個不同的問題，需要用 91.871s 重跑一次，並先把 vCPU 配額調高。

## 執行前寫定的參數

| 參數                           | 值                                    |
| ------------------------------ | ------------------------------------- |
| Load Model Execution Time（T） | 24s                                   |
| Burst 大小（N）                | 250                                   |
| 提交併發                       | 20                                    |
| Scaling Ceiling（C）           | 67                                    |
| 最小容量                       | 1                                     |
| 擴容門檻                       | Backlog > 1                           |
| 縮容條件                       | Backlog + In-flight == 0，連續 3 分鐘 |

## 六條通過條件

| #   | 條件                                | 證據                                                                                                                                 |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | burst 期間無 Job 被拒絕             | `batch_submitter.py` 的輸出 JSON：`status_code != 201` 的筆數為 0                                                                    |
| 2   | Worker 數量在擴容門檻被觸發後上升   | `describe-scaling-activities` 的 scale-out 記錄 + dashboard 上 RunningTaskCount 由 1 上升                                            |
| 3   | Queue Wait 在 burst 期間上升，Backlog 歸零後回到基線（≤ 5s） | `DurableQueue/Worker` 的 `QueueWaitSeconds`（Maximum）時間序列 |
| 4   | Backlog 回到零之後容量縮回          | `describe-scaling-activities` 的 scale-in 記錄；RunningTaskCount 回到 1                                                              |
| 5   | 縮容過程中沒有 In-flight Job 被中止 | Logs Insights：`job picked up by worker` 依 job_id 分組，沒有任何 job_id 出現 2 次（沒有重複投遞）；且 250 份 Job 全部到達 SUCCEEDED |
| 6   | 全程無 Job 進入 dead-letter queue   | `celery-dlq` 的 `ApproximateNumberOfMessages` 全程為 0                                                                               |

**條件 3 的修訂（2026-08-31，burst 送出之前）**：原文為「Queue Wait 峰值不超過
既定門檻」。本專案選定了 SLI（Queue Wait，ADR-0001）但未訂 SLO，任何數字門檻都只能
從實驗自身的模型反推，那是在驗收模型而不是系統；為了讓測試有東西可比而現在發明一個
SLO，比沒有更糟。改為不依賴 SLO 的形式：問的是等待為暫時或永久，而非快慢。基線 5s
的來源是量測——burst 前 smoke test 的單一 Job 實測 Queue Wait 0.644s。

容量軌跡的模型預測保留為**觀測**、不作為判準：ceiling（67）遠大於這個 burst 需要的
容量，限制因素是擴容速率（每分鐘 +2）；依此軌跡模擬 250 × 24s，最後一份 Job 應在第
819s 被取走，峰值 17 個 Worker。實測值記在下方判讀結果裡，與模型對照。

---

## 執行前的起始狀態（實驗前記錄）

送出 burst 之前的狀態必須是乾淨的，否則條件 1 與條件 6 的判讀會被前一次的殘留污染。
2026-08-31 08:23Z 記錄：

| 項目                       | 值                                                                    |
| -------------------------- | --------------------------------------------------------------------- |
| worker task definition     | `durable-queue-worker:5`，`TRANSCRIBER=fake`、`TRANSCRIBE_SECONDS=24` |
| api task definition        | `durable-queue-api:5`                                                 |
| ECS service 狀態           | worker 1/1、api 2/2，各只有一個 deployment（滾動更新已完成）          |
| `celery` 佇列              | Messages 0 / NotVisible 0                                             |
| `celery-dlq`               | Messages 0                                                            |
| `./scripts/verify.sh full` | passed                                                                |

單一 Job 的 smoke test（job id 204，08:22:07Z 送出）：08:22:35Z 之前到達 SUCCEEDED，
`worker_attempts` 長度 1。同一份 Job 在 `DurableQueue/Worker/QueueWaitSeconds` 產生了
一個資料點（Maximum 0.644s，SampleCount 1）——這順帶確認了條件 3 所依賴的整條路徑
（Worker 的 log 行 → metric filter → metric）在 burst 之前就是通的，而不是在實驗
之後才發現它從來沒有資料。

這份 smoke test 的 Job 不屬於 burst，判讀時以 T0（burst 送出時刻）之後的時間窗
排除它。

## 判讀結果

執行時間（UTC）：2026-08-31 09:10:22Z 送出 burst → 09:33:57Z 觀察到縮容完成
image tag：`latest`（`durable-queue-worker:5` / `durable-queue-api:5`）

| # | 條件 | 判讀 | 觀測值 / 證據 |
| --- | --- | --- | --- |
| 1 | burst 期間無 Job 被拒絕 | **通過** | `burst-results.json`（本目錄）：250 筆全部 `status_code = 201`，非 201 筆數 0。送出耗時 6.1s（09:10:22.239 → 09:10:28.388） |
| 2 | Worker 數量在擴容門檻被觸發後上升 | **通過** | scaling activities：1 → 3 → 5 → 7 → 9 → 11 → 13 → 15 → 17，自 09:14:33Z 起每步約 120s |
| 3 | Queue Wait 上升後回到基線（≤ 5s） | **通過** | 峰值 1031.66s（09:27Z）；burst 全部消化後以一份探測 Job 量測基線 **0.074s** |
| 4 | Backlog 回到零之後容量縮回 | **通過** | Backlog 與 In-flight 於 09:33Z 皆為 0；`worker-idle` alarm 於 09:33:57Z 觸發，desired count 設回 1 |
| 5 | 縮容過程中沒有 In-flight Job 被中止 | **通過** | Logs Insights：`jobs=250, total_picks=250, max_picks=1`（無重複投遞）；`job failed` 0 筆；API 查詢 `worker_attempts > 1` 的 Job 0 筆；250 份全部 SUCCEEDED |
| 6 | 全程無 Job 進入 dead-letter queue | **通過** | `celery-dlq` 的 `NumberOfMessagesSent` 全程 Sum = 0；`ApproximateNumberOfMessages` = 0 |

**六條全部通過。**

輔助觀測（不在通過條件內）：`QueueWaitSeconds` 各分鐘的 SampleCount 加總恰為 250，
與 Logs Insights 的 pickup 計數相互印證。最舊未完成 Job 年齡峰值 1005s，低於
`oldest-job-age-high` 的 1440s 門檻，該 alarm 全程未觸發——與執行前寫下的預期一致。

### 容量軌跡與模型的對照（觀測，非判讀）

| 項目 | 模型預測 | 實測 |
| --- | --- | --- |
| 最後一份 Job 被取走的時刻 | 819s | **1031.7s**（+26%） |
| 峰值 Worker 數 | 17 | **17** |
| 每次 step adjustment 的間隔 | 90s | 約 120s |

峰值容量與模型一致，抵達它的速度比模型慢：模型假設每步 90s（cooldown 60s + task
啟動 30s），實際約 120s。差異全部落在擴容速率，消化時間因此等比例拉長。

### 擷取畫面與錄影

四張截圖存在本目錄，時間軸皆為 UTC、涵蓋 09:05–09:34：

| 檔案 | 內容 |
| --- | --- |
| `backlog-inflight.png` | dashboard 主 widget：Backlog 09:11 衝到 245 後單調下降、09:28 歸零；Queue Wait（右軸）線性上升至 16.9 min；In-flight 09:29 歸零；Worker Count 全程緩升 |
| `oldest-unfinished-job.png` | 最舊未完成 Job 年齡，峰值約 16.8 min，明顯低於圖上 1440s 的 alarm 門檻虛線，09:29 掉回 0 |
| `sqs1.png` | SQS 內建指標：Visible 245→0、NotVisible 峰值 13、Delayed 全程 0、EmptyReceives 在消化完之後才竄高（Worker 空轉，容量已多於工作） |
| `sqs2.png` | `NumberOfMessagesSent` 在 09:10 有唯一一個尖峰、值為 **250**——條件 1 的獨立佐證，250 份全部進了佇列 |

錄影：_待補_

**這批截圖暴露了 dashboard 的一個可讀性問題**：`backlog-inflight.png` 的左軸同時
容納 Backlog（峰值 245）與 Worker Count（峰值 17），後者被壓在圖的底部幾乎看不出
在動。四條線同一時間軸的目的是做因果推論，而現在最重要的那條因果（容量上升 →
Backlog 下降）在圖上最不明顯。Worker Count 應該移到右軸，或另開一個 widget。

### 與預期不符之處

1. **擴容速率比模型慢**：每步約 120s 而非 90s，最後一份 Job 的等待因此是 1031.7s
   而非 819s。系統行為正確，是模型太樂觀。
2. **這個差異會讓修訂前的條件 3 判為失敗**（舊門檻 1000s，實測 1031.7s）。條件 3
   在 burst 送出之前就已修訂，理由與這個結果無關；但結果正好證實了當時的判斷——那個
   門檻檢驗的是擴容速率的估計，不是系統。修訂後的條件問「等待是暫時的還是永久的」，
   與估計誤差無關，1031.7s 的峰值與 0.074s 的回復都在同一次實驗裡被觀測到。
3. **條件 3 需要一份 burst 後的探測 Job 才能判讀**：`QueueWaitSeconds` 只在 Worker
   取得 Job 時發出，burst 消化完之後沒有新 Job，metric 就沒有資料點，看不到「回到
   基線」。因此於 09:39:27Z 送出一份探測 Job（id 455）量得 0.074s。這是條件寫法的
   缺口，不是系統的缺口：條件裡應直接寫明「以一份 burst 後的 Job 量測基線」。

## 真實轉錄的正確性（分離的實驗，不由上面的結果支持）

方法：_待填_
Job 數：_待填_
結果：_待填_

## 基礎設施的處置

**未銷毀，保留。** 這是人為決定，不是遺漏——ticket 的「實驗結束後基礎設施完全銷毀」
因此不勾選。ADR-0010 要求的可重現性由基礎設施程式碼本身滿足（`terraform apply` →
`deploy.sh`），與這一次是否銷毀無關。
