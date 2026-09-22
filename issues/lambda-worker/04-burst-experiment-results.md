# 04 — Lambda 上的 250 jobs burst 實驗：數字與判讀

這份文件記錄 ticket 04 的實驗。ticket 明文「只記錄數字，不設成功門檻」，
所以這裡沒有通過與否的判定，只有觀測值與它們的意義。

實驗分成兩輪：

- **預跑（2026-09-21）**：因為帳號的 Lambda 併發配額而作廢，但暴露了三個
  設計層級的問題。數字記在下面，不作為 06 的證據。
- **正式（2026-09-22）**：06 的證據來源。

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

## 正式實驗：2026-09-22

### 執行前狀態

| 項目 | 值 |
| --- | --- |
| 帳號 Lambda 併發配額 | `ConcurrentExecutions` 1000、`UnreservedConcurrentExecutions` 1000 |
| Lambda `durable-queue-worker` | Active，timeout 900s、memory 2048MB，未設 reserved concurrency |
| Lambda 環境 | `TRANSCRIBER=fake`、`TRANSCRIBE_SECONDS=24`、`XDG_CACHE_HOME=/tmp` |
| ESM | `batch_size = 1`、`maximum_concurrency = 67`、Enabled |
| `durable-queue-jobs` | Visible 0 / NotVisible 0，visibility timeout 900s、`maxReceiveCount = 10` |
| `durable-queue-jobs-dlq` | 0 |
| 帳號 | 新建 `batch-submitter-04` |

Smoke test（Job 3，04:24:30.96Z Acceptance）：

- 04:24:31.06Z 被取走，04:24:55.07Z succeeded，`worker_attempts` 長度 1。
- `DurableQueue/Worker/QueueWaitSeconds` 在 04:24 產生一個資料點，
  Maximum **0.101s**、SampleCount 1。

這次的 0.101s 不是冷啟動代價：ticket 03 的部署驗證剛跑過一份 Job，Lambda 還有
一個 warm 環境。這個環境在 burst 開始時也還在（見下面的「67 個環境」）。

### 參數

| 參數 | 值 |
| --- | --- |
| Load Model Execution Time | 24s |
| Burst 大小 | 250 |
| 提交併發 | 20 |
| ESM `maximum_concurrency` | 67 |
| 帳號 Lambda 併發配額 | 1000 |

### 送出

T0 = 第一份 Acceptance = **2026-09-22T04:25:14.389Z**（Job 4）。本節所有「T0+」
都從這一刻算起。這次送出的 job id 為 4–253，以下數字只涵蓋這 250 份。

250 份全部 Acceptance，`status_code != 201` 的筆數為 0。238 份在 T0+6.4s 內
Acceptance；最後三份分別在 T0+13.4s、T0+13.5s、T0+35.4s，是個別請求慢，不是
送出速度整體變慢。Batch Submitter 的總耗時因此是 37.8s（預跑為 9.3s）。

### 觀測值

| 項目 | 觀測值 |
| --- | --- |
| Job 終態 | succeeded **250**、failed **0** |
| 第一份 Acceptance → 最後一份完成 | **127.8s**（04:25:14.389Z → 04:27:22.233Z） |
| T0 → Worker Count 第一次抵達 67 | **T0+41.5s**（04:25:55.9Z，由 log 重建，見下）；metric 為 04:25 那一分鐘的 Maximum = 67 |
| Worker Count（`ConcurrentExecutions`）峰值 | **67**（每分鐘 Maximum：04:25 = 67、04:26 = 66） |
| 第一份 Job 的 Queue Wait | **3.795s**（Job 4，含一次冷啟動） |
| `Throttles` 總和（04:24–04:27） | **0** |
| Lambda `Errors` 總和 | 0 |
| DLQ | **0**（每分鐘 Maximum 全為 0，實驗後查詢亦為 0） |
| 實際執行次數 | 250 份的 `worker_attempts` 長度全為 1 |
| 重複投遞 | 無。250 次 pickup 對應 250 個相異 job id |
| Lambda 環境 | 67 個相異 host：66 次冷啟動 + smoke test 留下的 1 個 warm 環境 |
| 冷啟動 Init Duration | min 1.56s、median 1.91s、max 2.26s |

Queue Wait 的分布（取自 Lambda log group 的 `job picked up by worker` 行，
250 個資料點）：

| 統計量 | 值 |
| --- | --- |
| min | 0.042s |
| p50 | 45.192s |
| p90 | 82.931s |
| p99 | 97.531s |
| max | 98.107s |
| mean | 47.232s |

```
  0- 10s  29 #############################
 10- 20s  27 ###########################
 20- 30s  22 ######################
 30- 40s  28 ############################
 40- 50s  23 #######################
 50- 60s  35 ###################################
 60- 70s  22 ######################
 70- 80s  27 ###########################
 80- 90s  22 ######################
 90-100s  15 ###############
```

分布大致平均地鋪在 0–98s 之間，沒有預跑那種以 900 秒為間距的分群。這是固定
容量下消化 backlog 的樣子：67 個 Worker、每份約 24 秒，250 份排成大約四輪，排在
越後面的 Job 等得越久。mean 與 p50 接近，這次的平均值不會誤導。

最小值 0.042s 是 Job 5，由那個 warm 環境取走，沒有冷啟動。Job 4 雖然最早
Acceptance，但由冷啟動的環境執行，所以是 3.795s。

### Worker Count 是怎麼抵達 67 的

`ConcurrentExecutions` 只有一分鐘的解析度，看不出 04:25 那一分鐘內發生了什麼。
下表由 Lambda log 重建：每次 invocation 從 `START` 減掉 `Init Duration`（Lambda
把 init 時間算進 concurrency）到 `END`；waiting 為已 Acceptance、還沒被取走的
Job 數（由 Acceptance 時間與 Queue Wait 推得）。

```
T0+ 3s  accepted 121  waiting 116  workers 22  envs 22
T0+ 6s  accepted 238  waiting 211  workers 27  envs 27
T0+ 9s  accepted 247  waiting 219  workers 29  envs 29
T0+12s  accepted 247  waiting 216  workers 37  envs 37
T0+15s  accepted 249  waiting 211  workers 39  envs 39
T0+18s  accepted 249  waiting 208  workers 45  envs 45
T0+21s  accepted 249  waiting 197  workers 60  envs 60
T0+24s  accepted 249  waiting 188  workers 61  envs 61
T0+27s  accepted 249  waiting 188  workers 56  envs 61
T0+30s  accepted 249  waiting 181  workers 41  envs 61
T0+33s  accepted 249  waiting 171  workers 50  envs 61
T0+36s  accepted 250  waiting 166  workers 53  envs 61
T0+39s  accepted 250  waiting 152  workers 60  envs 61
T0+42s  accepted 250  waiting 148  workers 66  envs 67
T0+45s  accepted 250  waiting 138  workers 60  envs 67
T0+48s  accepted 250  waiting 125  workers 64  envs 67
```

以 5 秒為間隔取樣，T0+42s 之後到佇列清空前，同時執行數落在 54–66 之間。重建出
的峰值是 67，出現在 04:25:55.9Z（T0+41.5s），而且只維持了一瞬間。

### 與 ticket 預期的形狀對照

ticket 不設門檻，這裡只把觀測值放在四項預期旁邊。

| 預期 | 觀測 |
| --- | --- |
| Job 在 Acceptance 後幾秒內就開始執行 | 成立。第一份 3.8s，其中約 1.9s 是冷啟動；Throttles 為 0。 |
| Worker Count 直接抵達上限 67 並停在那裡 | **不完全成立**，見下。 |
| 超出上限的 Job 在佇列等待 | 成立。Backlog 峰值 210（dashboard，每分鐘 Maximum）。 |
| 全程零失敗 | 成立。failed 0、DLQ 0、每份只執行一次。 |

**Worker Count 不是「直接」抵達 67。** T0+6s 時已有 238 份 Acceptance、211 份
在等，所以爬升的速度不受 Job 送進來的速度限制。但環境數是逐步長上去的：T0+3s
22 個、T0+18s 45 個、T0+21s 61 個，然後停在 61 將近 20 秒，到 T0+41.5s 才一次補
滿到 67。這是 ESM 對 SQS 的 scale-up 行為，不是配額或設定造成的：Throttles 為
0，帳號配額 1000。

**抵達 67 之後也不是「停在那裡」。** 每一輪 Job 結束到 ESM 送下一則訊息之間有
空檔，同時執行數因此在輪與輪之間下降，最低一次是 T0+30s 的 41（環境數仍是
61）。每分鐘的 Maximum（67、66）把這段起伏抹平了，dashboard 上看起來就是一條
貼著上限的平線。

### Dashboard 截圖

| 檔案 | 內容 |
| --- | --- |
| `frontend/public/evidence/lambda-burst-queue.png` | 上方 widget：Backlog / Received by poller，04:23–04:30Z |
| `frontend/public/evidence/lambda-burst-workers.png` | 下方 widget：Worker Count / Queue Wait，04:23–04:30Z |

兩張都由 `GetMetricWidgetImage` 產生，metric 定義直接取自線上 dashboard
`durable-queue` 的 widget（即 Terraform 宣告的那一組），只加上時間範圍與尺寸。

看這兩張圖時要注意三件事：

- **Worker Count 的線停在 04:26。** 04:27 那一分鐘仍有 Worker 在執行（最後一份
  04:27:22Z 結束），但到 04:36Z 查詢時，這一分鐘的 `ConcurrentExecutions` 資料點
  始終沒有出現。
- **Queue Wait 那條線是每分鐘的平均值**（04:25 為 21.3s、04:26 為 68.7s），
  不是分布。分布以上面的表與直方圖為準。
- **Received by poller 峰值 57，沒有超過 67。** 預跑時它是 208，因為 ESM 在被
  throttle 的情況下還是先把訊息領走。這次沒有 throttle，領走的訊息數沒有超出
  上限。SQS 這幾條線的時間戳看起來大約晚了一分鐘：04:27 那一點的 Backlog 還是
  73，但 04:27:15Z 時 250 份都已經不是 pending。

### 證據檔案

| 檔案 | 內容 |
| --- | --- |
| `burst-results.json` | `batch_submitter.py` 的輸出，250 筆全部 `status_code = 201` |
| `burst-pickups.json` | 250 筆 pickup 記錄（timestamp、job_id、queue_wait_seconds） |
