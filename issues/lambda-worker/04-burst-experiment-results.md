# 04 — Lambda 上的 250 jobs burst 實驗：數字與判讀

這份文件記錄 ticket 04 的實驗。ticket 明文「只記錄數字，不設成功門檻」，
所以這裡沒有通過與否的判定，只有觀測值與它們的意義。

實驗分成兩輪：

- **預跑（2026-09-21）**：因為帳號的 Lambda 併發配額而作廢，但暴露了三個
  設計層級的問題。數字記在下面，不作為 06 的證據。
- **正式（ticket 03 部署後執行）**：06 的證據來源。

---

## 預跑：2026-09-21

### 執行前狀態

| 項目 | 值 |
| --- | --- |
| Lambda `durable-queue-worker` | Active，timeout 900s、memory 2048MB，image 更新於 05:38:38Z |
| Lambda 環境 | `TRANSCRIBER=fake`、`TRANSCRIBE_SECONDS=24`、`XDG_CACHE_HOME=/tmp` |
| ESM | `batch_size = 1`、`maximum_concurrency = 67`、Enabled |
| `durable-queue-jobs` | Visible 0 / NotVisible 0，visibility timeout 900s、`maxReceiveCount = 4` |
| `durable-queue-jobs-dlq` | 0 |

Smoke test（Job 2，06:25:05.29Z 送出）：

- 06:25:07.82Z 被取走，06:25:31.84Z succeeded，`worker_attempts` 長度 1。
- `DurableQueue/Worker/QueueWaitSeconds` 在 06:25 產生一個資料點，
  Maximum **2.540s**、SampleCount 1。

這份 smoke test 確認 Queue Wait 的量測路徑（Worker 的 log 行 → metric filter →
metric）在換到 Lambda log group 之後仍然是通的，而不是等 burst 跑完才發現沒資料。
2.540s 同時就是閒置系統的冷啟動代價。

### 參數

| 參數 | 值 |
| --- | --- |
| Load Model Execution Time | 24s |
| Burst 大小 | 250 |
| 提交併發 | 20 |
| ESM `maximum_concurrency` | 67 |
| 帳號 Lambda 併發配額 | **10** |

### 送出

T0 = 2026-09-21T06:26:03.74Z，250 份全部 Acceptance，送出耗時 9.3s。
`status_code != 201` 的筆數為 0。

### 為什麼這一輪作廢

```
$ aws lambda get-account-settings
"ConcurrentExecutions": 10, "UnreservedConcurrentExecutions": 10
```

帳號的 Lambda 併發配額是 10，AWS 對新帳號的下修值（此配額的 AWS 預設值為 1000）。
ESM 的 `maximum_concurrency = 67` 因此從未生效，實際的 Scaling Ceiling 是 10。

量到的完成時間會是「配額 10 之下的完成時間」，不是這份 spec 的設計在 67 之下的
表現。拿去和舊架構的 16 分鐘對照沒有意義，也不能作為 06 的證據。

### 觀測值

實驗在 07:01:03Z 人為中止，沒有跑到 250 份全部抵達終態。中止的理由是這一輪已經
作廢，繼續跑只會多花時間，而要觀察的三個現象在中止前都已經重複出現過三次。

| 項目 | 觀測值 |
| --- | --- |
| 送出 | 250 份全部 Acceptance，耗時 9.3s（06:26:03.74Z 起） |
| 中止時的 Job 狀態 | succeeded 125、pending 125、failed **0** |
| Worker Count（`ConcurrentExecutions`）峰值 | **10** |
| DLQ | **0** |
| 重複投遞 | 無。125 次 pickup 對應 125 個相異 job id |
| 完成時間 | 未量到——250 份沒有全部完成 |

Queue Wait 的分布（取自 Lambda log group 的 `job picked up by worker` 行，
125 個資料點）：

| 統計量 | 值 |
| --- | --- |
| min | 0.075s |
| p50 | 953.624s |
| p90 | 1865.601s |
| p99 | 1889.513s |
| max | 1891.192s |
| mean | 934.118s |

分布呈現三個互相分離的群，中間是兩段幾乎沒有資料的空白：

```
   0- 108s    42 筆   ← 第一波，burst 送出後立即執行
 900-1008s    43 筆   ← 第二波，第一次 visibility timeout 到期後
1800-1896s    40 筆   ← 第三波，第二次 visibility timeout 到期後
```

群與群的間距正好是 900 秒，也就是佇列的 visibility timeout。**這張分布圖就是
「系統靠訊息重送而不是靠 ESM 推進」的直接證據。**

mean 934.118s 落在第一群與第二群之間的空白處，沒有任何一份 Job 的實際等待接近
這個值。這佐證了 ticket 把「平均與最大值」改成「p50 與最大值，或直接貼分布圖」
的判斷。

### 證據檔案

| 檔案 | 內容 |
| --- | --- |
| `prerun-dashboard.png` | dashboard widget，06:24–07:02Z，由 `GetMetricWidgetImage` 以 Terraform 宣告的同一組 metric 產生 |
| `prerun-burst-results.json` | `batch_submitter.py` 的輸出，250 筆全部 `status_code = 201` |
| `prerun-pickups.json` | 125 筆 pickup 記錄（timestamp、job_id、queue_wait_seconds） |

`prerun-dashboard.png` 重現了與上一次容量實驗相同的可讀性問題：左軸同時容納
In-flight Job（峰值 208）與 Worker Count（固定 10），後者被壓在圖的底部幾乎看不
出在動。而這次最重要的那條線正是 Worker Count。Worker Count 應該移到右軸。

### 三個與 spec 不符的發現

這些發現與配額無關，換成配額 67 之後依然成立。

**一、In-flight Job 不等於 Worker Count。**

spec 的「Lambda handler」一節寫：ESM `batch_size = 1`，因此「Worker 數量 =
In-flight Job 數量 = 容量單位」這個等式仍然成立。實測推翻了它。

ESM 的 poller 領取訊息的速度與能不能執行無關，它會預先把訊息拉進 buffer。領取
把訊息從 visible 翻成 not visible，於是：

```
06:26:32Z  Backlog=191  In-flight=58    ConcurrentExecutions=10
06:27:06Z  Backlog=134  In-flight=104   ConcurrentExecutions=10
06:28:14Z  Backlog=0    In-flight=210   ConcurrentExecutions=10
```

`ApproximateNumberOfMessagesNotVisible` 量的是「ESM 領走了多少」，不是「多少
Worker 在執行」。它可以遠大於 `maximum_concurrency`。唯一能代表 Worker Count 的
是 `AWS/Lambda ConcurrentExecutions`。

**二、Backlog 不再代表「還有多少工作沒做」，story 20 的停擺特徵因此失效。**

spec 的 user story 20：「Backlog above zero while Worker Count is zero」是停擺的
辨識特徵。實際發生的停擺是：

```
06:28:14Z – 06:41:32Z   Backlog=0   In-flight=208   Worker Count=0   DLQ=0
```

Backlog 是零，因為訊息都在 ESM 手上。dashboard 上四條線沒有一條能把這個狀態與
「事情做完了」區分開來。停擺在 Lambda 架構下的正確特徵是
**In-flight Job 大於零而 Worker Count 為零**。

**三、等待會消耗 retry 次數。**

06:28 到 06:41 的 13 分鐘內，Lambda 沒有被呼叫過一次，也沒有 throttle——ESM 被
連續 throttle 之後退避到停止，連試都不再試。系統是靠訊息的 900s visibility
timeout 到期、重新變 visible 才恢復推進的，不是靠 ESM 自己。

每一次這樣的重送都讓 `ApproximateReceiveCount` 加 1。`maxReceiveCount = 4`，所以
一份從未失敗、只是等不到容量的 Job，最多經歷四輪就會進 DLQ。

spec 的 user story 4 明文要求「Jobs that wait in the Backlog because of the
Scaling Ceiling must not consume retry attempts」。預跑當時的設定不滿足它；
ticket 03 把重試計數改為 Job 實際被執行的次數，並把 `maxReceiveCount` 拉到 10。

**DLQ 的實測結果：未觀測到。** 實驗在 `ApproximateReceiveCount` 達到 3、DLQ 仍為
0 時中止，沒有跑到第四次重送。所以「等待會消耗 retry 次數」這件事本身已經證實
（三次重送、每次都是純粹的等待，沒有任何一份 Job 失敗過），但「Job 因此進入 DLQ」
只是依 `maxReceiveCount = 4` 的推論，不是觀測值。文件不把推論寫成實測。

依中止時的節奏推算，若繼續跑，第四個週期會在 07:11Z 前後消化約 40 份，其餘約 85
份會在 07:26Z 前後進 DLQ。這個數字**沒有被驗證**。

### 實驗後的處置

07:04:41Z 對 `durable-queue-jobs` 執行 `purge-queue`，刪除當時還在佇列中的 125 則
訊息；07:05:16Z 確認 visible 與 not visible 皆為 0，DLQ 仍為 0。

對應的 125 份 Job 因此永遠停在 pending。這是人為中止實驗的預期結果，不是系統行為：
它們的訊息被刪除，沒有任何 Worker 會再取走它們。

帳號的 Lambda 併發配額已調升為 1000，ESM `maximum_concurrency` 改回 RDS 連線預算推導出的 67。部署完成後 Lambda function、ESM、佇列與 dashboard 全部保留不動，正式實驗用同一套設定。

---

## 正式實驗：待執行

前置條件：ticket 03 部署完成——`maxReceiveCount` 10、重試改數實際執行次數。
帳號的 Lambda 併發配額在預跑後調升為 1000，ESM `maximum_concurrency` 因此改回
RDS 連線預算推導出的 67，不再被配額壓低。

_待執行_
