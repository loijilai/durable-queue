# 07 — Scaling policy 的參數推導

每個參數的完整算式，供 `infra/worker_autoscaling.tf` 與 `infra/shared.tf` 的
comment 指回這裡。原則：能回溯到 02 的量測或一個寫下來的下游限制，不得為選定
的常數。

## Visibility timeout（`infra/shared.tf` 的 `celery_visibility_timeout`）

輸入：`issues/scaling-control-loop/02-measure-execution-time-results.md`

> At the Admission Limit (14400s = 4.00h), the model projects Execution Time
> ≈ 352.1s (5.9 min).

安全係數：**2**。理由（兩個都寫下來，不是憑感覺）：

1. 02 的線性模型是從 4 個樣本（最長 2h08m ≈ 7693s）外推到 Admission Limit
   （14400s）——這是外插而非內插，模型在取樣範圍外的誤差沒有實測資料佐證。
2. `durable_queue/jobs/transcribers.py` 的 `_transcribe_chunk_with_retry` 對
   每個音訊分段（`DEFAULT_CHUNK_SECONDS = 1200`）有 in-process 重試，最多
   `CHUNK_MAX_ATTEMPTS = 3` 次，backoff 為 `min(2**(attempt-1), 10)` 秒。在
   Admission Limit 下一份 Job 有 14400/1200 = 12 個分段，即使只有一個分段觸發
   到滿三次重試，也會多花 1+2 秒的 sleep（外加兩次額外的 API 呼叫時間）；02
   量測到的樣本沒有 retryable error，這段耗時不在模型裡。

計算：352.1 × 2 = 704.2s，取整到 720s（12 分鐘，SQS 的整數秒沒有進位限制，
取 60 的倍數只是方便閱讀）。

不變式（`durable_queue/durable_queue/settings.py` 已有註解）：
`visibility_timeout` 必須 > 最長 Execution Time，否則仍在執行的 Job 會被判定
死亡而重新投遞給第二個 Worker。720 > 352.1，成立且留有一倍以上餘裕。

## Scaling Ceiling（`infra/worker_autoscaling.tf` 的 `worker_scaling_ceiling`）

兩個獨立的下游限制，取兩者推算結果中遠低於兩者的值。

### 限制一：資料庫連線數

`infra/database.tf` 的 RDS instance class 是 `db.t4g.micro`（1 GiB 記憶體）。
PostgreSQL 在 RDS 的預設 `max_connections` 公式（AWS 文件
[Maximum number of database connections](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html)）：

```
LEAST({DBInstanceClassMemory/9531392}, 5000)
```

`DBInstanceClassMemory` 是扣掉 OS 與 RDS 管理程序保留後的可用記憶體，對
1 GiB 這個級距的機型，AWS 文件指出保留比例顯著（原文：「When ... running on
a small DB instance class ... RDS reserves a significant portion of the
available memory」）。1 GiB 機型的實測預設值落在 80–90 這個範圍（可在部署後
以 `SHOW max_connections;` 直接確認）；此處取保守值 **80** 作為預算基礎。

連線消耗方：
- API service：`infra/api.tf` 的 `aws_ecs_service.api` desired_count = 2，
  gunicorn 指令未帶 `--workers`，預設 1 個 worker process，每個 task 用掉的
  連線數視為 1 → 共 2。
- 一次性 migrate task：執行期間額外 1 個連線。
- 操作餘裕（人工用 psql 連進去檢查、Terraform apply 期間的瞬時重疊）：預留
  10。

保留 2 + 1 + 10 = 13，剩餘預算 80 − 13 = 67 個連線可以分給 Worker。Worker 沒
有連線池（Django 預設 `CONN_MAX_AGE=0`），每個 task 至多同時佔用 1 個連線，
因此這個限制本身允許到 67 個 Worker。

### 限制二：轉錄 API（OpenAI Whisper）rate limit

在 platform.openai.com → Settings → Limits 核對本帳號的實際值：audio 端點
**500 RPM**（requests per minute），與其他端點的限制池分開計算。

先前這裡引用的是 OpenAI 文件的 Tier 1 預設值 50 RPM，並註明「這是帳號 tier
相關的數字…部署前應核對實際值；50 RPM 是這裡計算的輸入，不是本專案能控制的
常數」。核對後實值為 500 RPM，因此下面的結論隨之改變——這個修訂做得到，正是
因為當初把它記成一個有出處的輸入，而不是一個常數。

請求頻率的計算依據 02 的 phase share（同一份量測結果文件）：

> transcribe: 79.8%（average of each sample's own share of its total）

在 Admission Limit 下：transcribe phase 總時長 ≈ 352.1s × 0.798 ≈ 281.0s，
分攤到 14400/1200 = 12 個分段，平均每個分段（= 每一次 Whisper API 呼叫）
耗時 ≈ 281.0/12 ≈ 23.4s。也就是說，一個持續處理 Admission-Limit-長度影片的
Worker，穩態下每 23.4s 發出一次請求 → 每個 Worker ≈ 60/23.4 ≈ 2.56 RPM。

N 個 Worker 同時都在跑最長的 Job（最壞情況）時，聚合請求率 ≈ N × 2.56 RPM。
要求這個值不超過限制的一半（保留一倍餘裕給分段重試與非均勻到達）：

```
N × 2.56 ≤ 250   →   N ≤ 97.6
```

### 不是限制：Fargate On-Demand vCPU 配額

ap-northeast-1 的實際配額為 30 vCPU（`service-quotas get-service-quota
--service-code fargate --quota-code L-3032A538`）。Worker 每個 1 vCPU、API
兩個各 0.5 vCPU，實務上最多約 28 個 Worker。

**這個數字不進 Scaling Ceiling。** Ceiling 的意義是「成長要停在傷到下游之前」；
配額是行政限制，可申請調高，碰到它該做的是提工單，而不是讓它決定設計。記在
這裡只是為了讓容量長不上去時，能立刻分辨是設計在擋還是配額在擋。

### 取值

兩個下游限制分別允許到 67（資料庫連線）與 97（轉錄 API，N ≤ 97.6 無條件
捨去）。取低者，Scaling Ceiling = **67**：

- 67 × 2.56 ≈ 172 RPM，在 ≤ 250 RPM 的目標之內。
- 67 個連線用滿資料庫的連線預算，這正是它成為瓶頸的意思。

修訂記錄：先前此處取 9，輸入是 50 RPM 的 Tier 1 預設值。核對到實值 500 RPM
後，瓶頸從轉錄 API 移到資料庫連線數，ceiling 由 9 改為 67。要讓 ceiling 再往
上，下一步是資料庫（更大的 instance class 或連線代理），而不是 OpenAI。

超過 67 個 Worker 份的工作留在 Backlog 等待——這是刻意的：讓延遲上升去保護
下游，而不是讓資料庫或轉錄 API 因為容量衝過頭而失效。

## 擴容 / 縮容門檻

見 `infra/worker_autoscaling.tf` 內對應 resource 上方的 comment：

- 擴容門檻（Backlog > 1）：推導自系統自身的定義而非量測——Interactive
  Submitter 一次只送出 1 個 Job，min capacity=1 的常駐 Worker 會在同一個
  60s 取樣窗口內取走它，因此 Backlog 不會被單一 Job 推過 1。任何時候
  Backlog > 1 就代表有不只一個 Job 在排隊，這正是 burst 的定義。
- 縮容條件（Backlog + In-flight == 0，連續 3 分鐘）：兩個非負的 SQS metric
  相加後 <= 0，數學上等同兩者皆為 0——精確為 0 才能保證縮容不會砍到正在
  執行的 Job（ADR-0006）。
