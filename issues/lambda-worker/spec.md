# Lambda Worker

## Problem Statement

目前 Worker 是一個常駐在 ECS/Fargate 上的 Celery 進程，靠 poll SQS 取得 Job，容量則交給一套自己維護的 step scaling control loop（Backlog alarm → +2 Worker、閒置 alarm → 縮回 1）。

這套設計讓 Batch Submitter 的吞吐量被 control loop 的爬升速度卡住：以 Load Model（每份 Job 24 秒）送出 250 份 Job，需要約 16 分鐘才消化完。實際運算量只需要約 1.5 分鐘，其餘時間都花在「每 60 秒 cooldown 只加 2 個 Worker」的爬升，以及 Fargate 冷啟動上。Scaling Ceiling 雖然是 67，但從 1 爬到 67 要約 33 分鐘，burst 在容量到位之前就結束了。

真實轉錄的實測顯示，一支 2 小時的影片約 3 分鐘可以完成，完全落在函式運算平台單次執行的時間限制內。對這種「一份 Job、一段有上限的執行、然後結束」的工作形狀，維護常駐 poll loop 加上自製的 control loop，是在不需要的地方增加了複雜度與延遲。

## Solution

把 Worker 從 ECS/Fargate 換成 AWS Lambda，由 SQS event source mapping 直接觸發。容量由平台依 Backlog 自動擴張，Scaling Ceiling 變成一個固定設定（`maximum_concurrency = 67`），整套 step scaling control loop 刪除。

同時拿掉 Celery：API 直接把 `{"job_id": ...}` 送進 SQS，Lambda handler 解讀這則訊息並執行 Job。重試語義收斂成只有 SQS 一層。API 維持在 ECS/Fargate 加 ALB 上不變。

所有與新架構衝突的既有決策（ADR 引用、程式碼註解、CONTEXT.md 詞彙、前端敘事、架構圖、README）一律清除或改寫。這份 spec 的決策優先於過去的決策。

> _Contradicts ADR-0006（縮容只在 Backlog 與 In-flight Job 皆為 0 時才安全）、ADR-0007（Worker 數量來自 Container Insights）、ADR-0008（Celery 應用層與 SQS 基礎設施層兩個獨立的重試計數器）—— 依本次決策直接清除，不另寫 supersede 記錄。_

## User Stories

### Batch Submitter

1. As a Batch Submitter, I want a burst of several hundred Jobs to start executing within seconds of Acceptance, so that the whole batch finishes in roughly the time its execution needs rather than the time a control loop needs to ramp up.
2. As a Batch Submitter, I want up to the Scaling Ceiling of Jobs to execute concurrently as soon as they are in the Backlog, so that throughput is not throttled by a fixed step size.
3. As a Batch Submitter, I want Jobs beyond the Scaling Ceiling to wait in the Backlog instead of being rejected or failed, so that a large batch is absorbed without losing any Job.
4. As a Batch Submitter, I want Jobs that wait in the Backlog because of the Scaling Ceiling not to consume retry attempts, so that waiting never pushes a healthy Job into the DLQ.

### Interactive Submitter

5. As an Interactive Submitter, I want my single Job to start executing without waiting for any scale-out decision, so that Queue Wait stays short even when the system was idle.
6. As an Interactive Submitter, I want a cold start of a few seconds to be the only cost of an idle system, so that the extra wait is negligible next to an Execution Time measured in minutes.
7. As an Interactive Submitter, I want to see my Job move from pending to running to a terminal state exactly as before, so that the change of compute platform is invisible to me.
8. As an Interactive Submitter, I want retrying a failed Job to behave exactly as before, so that the retry button still re-queues the Job.

### Job 執行與重試

9. As a Submitter, I want a Job that fails with a permanent error (invalid media, video exceeds the Admission Limit, configuration error) to become failed on the first attempt, so that no retry is wasted on an input that can never succeed.
10. As a Submitter, I want a Job that fails with a retryable error (downstream throttling, timeout, connection failure) to be retried with a backoff, so that a transient blip does not fail my Job.
11. As a Submitter, I want a Job to have at most four attempts in total (the first plus three retries), so that retry behaviour matches what the system promised before.
12. As a Submitter, I want a Job whose last attempt still fails with a retryable error to become failed with the error recorded, so that I see a terminal state instead of a Job silently disappearing into the DLQ.
13. As a Submitter, I want an unclassified error to fail the Job immediately, so that a bug is surfaced rather than retried.
14. As a Submitter, I want a redelivered message for a Job that is already succeeded or failed to have no effect, so that duplicate delivery never overwrites a terminal Job.
15. As a Submitter, I want the Transcript to remain all-or-nothing, so that a Job never ends up with a partial Transcript.
16. As a Submitter, I want videos up to the existing four-hour Admission Limit to still be accepted, so that the platform change does not shrink what I can submit.

### 維運者（dashboard 與可觀測性）

17. As an operator, I want one dashboard widget that shows Backlog, In-flight Jobs, Worker Count, and Queue Wait on the same time axis, so that I can reason about whether capacity is affecting waiting time.
18. As an operator, I want Worker Count to show how many Lambda invocations are executing, so that I can see whether the Scaling Ceiling of 67 is being hit.
19. As an operator, I want Queue Wait to keep being derived from the Worker's structured log line, so that the application still knows nothing about CloudWatch.
20. As an operator, I want "Backlog above zero while Worker Count is zero" to be the recognisable sign of a stalled system, so that I can detect a stall from two unambiguous counts.
21. As an operator, I want the Oldest Unfinished Job Age widget, its alarm, and the execution phase saved query removed, so that the dashboard carries no metric whose meaning mixes Queue Wait with Execution Time.
22. As an operator, I want every log line emitted while a Job executes to carry its job id, so that I can follow one Job through the logs as before.
23. As an operator, I want the per-stage timing log lines (download, re-encode, transcribe) to keep being emitted, so that I can still inspect where Execution Time goes when I need to.
24. As an operator, I want Container Insights turned off, so that the ECS cluster no longer pays for a metric nothing reads.
25. As an operator, I want a Job that exhausts every SQS delivery without the handler ever recording a result to end up in the DLQ, so that a message that crashes the Worker is kept for manual inspection.

### 開發者（本機與測試）

26. As a developer, I want `docker compose up` to still run a worker against the local elasticmq queue, so that I can submit a Job locally and see it complete.
27. As a developer, I want the local worker to call exactly the same handler as the deployed Lambda, so that local behaviour cannot drift from production behaviour.
28. As a developer, I want the handler to be tested by feeding it an SQS event, so that tests exercise the real invocation contract rather than internals.
29. As a developer, I want the API tests to assert that a Job is enqueued only after the database transaction commits, so that the Worker can never receive a job id that does not exist yet.
30. As a developer, I want a test that pins the message format the API sends, so that the API and the handler cannot silently disagree on the message contract.
31. As a developer, I want `./scripts/verify.sh quick` and `./scripts/verify.sh full` to keep passing, so that the repository-owned harness remains the single source of truth.
32. As a developer, I want the environment-variable parity check to compare the code against the Lambda function's environment instead of the removed ECS task definition, so that a missing variable is still caught before deploy.
33. As a developer, I want no Celery, kombu, or flower dependency left in the project, so that nobody reads Celery-specific code or configuration that no longer runs.

### 部署

34. As a deployer, I want the CD pipeline to update the Lambda function to the newly built image after the database migration, so that the Worker never runs code ahead of the schema.
35. As a deployer, I want the CD pipeline to wait until the function update has finished, so that a broken image fails the pipeline instead of failing silently.
36. As a deployer, I want the API and the Worker to keep sharing one image built once per commit, so that the two roles cannot run different code.
37. As a deployer, I want the CD role to have exactly the permissions needed to manage the Lambda function and its event source mapping, and no longer the permissions for the removed worker service and autoscaling, so that the role stays least-privilege.
38. As a deployer, I want the renamed queue and DLQ to be created by Terraform, so that no resource name is tied to a library that is no longer used.

### 驗證與文件

39. As the project owner, I want the 250-Job burst experiment re-run on Lambda with the Load Model, and its numbers recorded, so that the effect of this change is documented with evidence.
40. As a reader of the site, I want the Scalability page and the home page to describe SQS triggering Lambda with a fixed Scaling Ceiling, so that the site matches the running system.
41. As a reader of the site, I want the control-loop diagram removed and the evidence screenshots replaced with the new burst experiment, so that no page shows a mechanism that no longer exists.
42. As a future contributor, I want CONTEXT.md to define Worker as one concurrently executing Lambda invocation, so that the vocabulary matches the system.
43. As a future contributor, I want the architecture diagrams and README to show Lambda instead of the worker Fargate service and autoscaling, so that the documentation does not mislead.
44. As a future contributor, I want code comments that cite ADR-0006, ADR-0007, ADR-0008 or the removed control loop deleted or rewritten, so that no comment justifies code by a decision that has been overturned.

## Implementation Decisions

### 範圍

- 只換 Worker。API 維持 ECS/Fargate 加 ALB，包括一次性 migrate task。
- 正式環境維持 `TRANSCRIBER=fake`（Load Model，24 秒）。切換到真實轉錄不在這份 spec 內。
- Admission Limit 維持 14400 秒。

### 訊息契約與 enqueue

- Celery、kombu、flower 從依賴與設定中移除，包括 broker 設定、visibility timeout 環境變數，以及 Celery 相關設定測試。
- API 端新增一個 enqueue 函式，介面為「給一個 job id，把它送進 Job 佇列」。實作是用 boto3 對佇列送出純 JSON body：`{"job_id": <int>}`。
- 建立 Job 與 retry 兩個呼叫點，都改用這個 enqueue 函式，並維持「在 DB commit 之後才送出」的順序保證。
- 佇列位置透過環境變數提供給 API（佇列 URL），本機指向 elasticmq。
- API task role 的 SQS 權限收斂成對新佇列的 `SendMessage`（加上實際需要的最小集合），移除 `ListQueues`。

### Lambda handler

- 新增一個 Lambda handler 模組，作為 Worker 的唯一入口。它取代原本的 Celery task 與 task 基底類別。
- 冷啟動時，handler 模組先從 Secrets Manager 取得 Django settings 所需的機密值（DB 密碼、`SECRET_KEY`、Google OAuth client），寫入環境變數，再初始化 Django。這取代 ECS task definition 的 `secrets` 注入。之所以在 handler 自己解析，是因為 Lambda 沒有同等的注入機制，而把機密放進 Lambda 環境變數會以明文出現在函式設定上。
- ESM `batch_size = 1`：一次 invocation 只處理一則訊息，也就是一份 Job。「Worker 數量 = In-flight Job 數量 = 容量單位」這個等式因此仍然成立，也不需要 partial batch failure 回報。
- 每次 invocation 的流程：
  1. 解析訊息 body 取得 job id，並把 job id 設進 log context，讓期間每一行 log 都帶 job id。這取代原本的 Celery signal handler。
  2. 呼叫既有的 `mark_running`。回傳空值（Job 已是終態）時直接正常結束，訊息被刪除。
  3. 呼叫轉錄器，成功則 `mark_succeeded`，正常結束。
  4. 失敗時依錯誤分類處理：
     - **永久錯誤**與**未分類錯誤**：`mark_failed`，記錄 `failure_reason`，正常結束。訊息被刪除，不重送。
     - **暫時性錯誤**（`TranscriptionRetryableError` 家族、`ConnectionError`、`TimeoutError`）：
       - 若 `ApproximateReceiveCount` 已達最後一次（4）：`mark_failed`，正常結束。
       - 否則：用該訊息的 receipt handle 呼叫 `ChangeMessageVisibility`，把 visibility 縮短成退避秒數（指數退避加 jitter，依 receive count 計算，上限遠小於 900 秒），然後拋出例外，讓 SQS 在退避時間後重送。
- 既有的 `failure_reason` 分類與 "job failed" log 行保留。"job picked up by worker" 那行帶 `queue_wait_seconds` 的 log 保留，metric filter 依賴它。
- 轉錄器內部的 chunk 級重試（`CHUNK_MAX_ATTEMPTS`）不變。
- Lambda 環境設定 `XDG_CACHE_HOME=/tmp`（或等效方式關閉 yt-dlp cache），因為 Lambda 只有 `/tmp` 可寫。
- 服務層（`mark_running` / `mark_succeeded` / `mark_failed` / `retry_job`）與 Job 模型不變，沒有 schema 變更。`worker_attempts` 的 host 欄位改記錄 invocation 所在的主機名稱，語意不變。

### 本機 poll shim

- 新增一個 Django management command，作為本機專用的 worker。它對 elasticmq long-poll，每收到一則訊息，就組出與 Lambda SQS event 相同形狀的 event（含 body、receipt handle、`ApproximateReceiveCount`），呼叫同一個 handler。handler 正常結束就刪除訊息，拋出例外就不刪。
- docker-compose 的 worker service 改跑這個 command，並建立同名的本機佇列。
- 這個 shim 只存在於本機開發環境，正式環境沒有任何 poll loop。

### Image

- 沿用同一份後端 Dockerfile，加裝 `awslambdaric`。API 與 Worker 繼續共用同一個 ECR image 與 tag。
- Lambda 以 `package_type = Image` 部署，用 `image_config` 覆寫 entrypoint 與 command，指向 handler。

### Infra（Terraform）

- **刪除**：worker ECS task definition、worker ECS service、worker 的 execution / task IAM role、worker 的 ECS log group，以及整個 worker autoscaling（scalable target、兩個 step scaling policy、兩個 alarm）。
- **新增 Lambda function**：
  - timeout 900 秒、記憶體 2048MB、ephemeral storage 1024MB。
  - 放在 private subnets，沿用 worker security group（egress 走既有 NAT，可連 RDS 與外網）。
  - 環境變數：非機密設定照舊（`TRANSCRIBER`、`TRANSCRIBE_SECONDS`、Postgres 連線資訊等），機密以 secret ARN 形式提供給 handler 自行解析。
  - 自己的 CloudWatch log group，保留 14 天。
- **Lambda execution role**：VPC 存取所需的網路介面權限；CloudWatch Logs 寫入；對 Job 佇列的 `ReceiveMessage`、`DeleteMessage`、`GetQueueAttributes`、`ChangeMessageVisibility`；讀取 app secret 與 RDS master user secret 的 `GetSecretValue`。
- **ESM**：來源為 Job 佇列，`batch_size = 1`，`scaling_config.maximum_concurrency = 67`。Scaling Ceiling 的推導（RDS `db.t4g.micro` 連線預算）保留並移到這裡的註解。不設 reserved concurrency。
- **SQS**：佇列改名為 `durable-queue-jobs`，DLQ 改名為 `durable-queue-jobs-dlq`。visibility timeout 900 秒，`maxReceiveCount = 4`，DLQ 保留 14 天。
- **ECS cluster**：只剩 API，關閉 Container Insights。
- **Observability**：
  - dashboard 只保留一個 widget，四條線：Backlog（`ApproximateNumberOfMessagesVisible`）、In-flight Jobs（`ApproximateNumberOfMessagesNotVisible`）、Worker Count（`AWS/Lambda ConcurrentExecutions`，以 function name 為 dimension）、Queue Wait（右軸）。
  - Queue Wait metric filter 改掛在 Lambda log group，pattern 與 namespace 不變。
  - 刪除 Oldest Unfinished Job Age widget、`oldest-job-age-high` alarm、`execution-phase-breakdown` saved query，以及以 visibility timeout 推導 alarm 門檻的 local。
- **Bootstrap CD role**：移除 worker service、worker IAM role、autoscaling 相關權限；新增管理這個 Lambda function、ESM、Lambda execution role 的 `iam:PassRole`、Lambda log group 所需權限。
- 共用 locals 中與 Celery 相關的 broker URL 與 visibility timeout 常數移除或改名，讓 visibility timeout 只剩佇列自己的設定。

### CD 與部署腳本

- `Deploy worker service` 步驟改為：以本次 image tag 更新 Lambda function code，然後等待 function 更新完成。順序維持在 migrate task 之後。
- 手動部署腳本同步修改。

### Harness 與檢查腳本

- 環境變數對帳檢查改成解析 Lambda function 的環境設定作為 Worker 的部署來源。
- 其他 repo contract / architecture 檢查若引用 Celery task 模組或 worker task definition，一併更新。

### 文件與前端

- **CONTEXT.md**：
  - Worker 重新定義為「一個同時執行中的 Lambda invocation；一次只處理一份 Job」。
  - Scaling Ceiling 改為由 ESM `maximum_concurrency` 實作。
  - Interactive / Batch Submitter 段落由「兩套獨立容量機制」改寫為「一套容量機制同時服務兩者，閒置的代價是冷啟動」。
  - 「task」一詞多義段落刪除 Celery task，ECS task 限定指 API。
  - In-flight Job 中「縮容會砍到執行中 Job」的警告刪除。
- **前端**：Scalability 頁與首頁改寫為 SQS 觸發 Lambda 加固定 Scaling Ceiling 的敘事；刪除 `ControlLoop` 元件；證據截圖換成新 burst 實驗的結果。
- **架構圖與 README**：同步改為 Lambda，移除 worker Fargate service 與 autoscaling。
- **註解清理**：所有引用 ADR-0006、ADR-0007、ADR-0008、control loop、Celery 行為（`acks_late`、prefetch、`autoretry_for`）作為理由的註解，一律刪除或改寫。

## Testing Decisions

好的測試只驗證外部可觀察的行為：Job 在資料庫的最終狀態、handler 對 SQS 的回應（正常結束或拋出例外、呼叫了哪個 SQS API 與參數），不驗證內部函式的呼叫順序。

### Seam 1：Lambda handler 的呼叫介面（主要 seam）

測試直接呼叫 handler，傳入 SQS event（body 為 `{"job_id": ...}`，attributes 含 `ApproximateReceiveCount`，並附 receipt handle）。轉錄器以 patch 替換，SQS client 以假物件替換。

要涵蓋的情境：

- 轉錄成功：Job 變成 succeeded，Transcript 與 `finished_at` 寫入，handler 正常結束。
- 永久錯誤：第一次就 failed，錯誤訊息寫入，handler 正常結束，沒有呼叫 `ChangeMessageVisibility`。
- 未分類錯誤：第一次就 failed，handler 正常結束。
- 暫時性錯誤、receive count 未達上限：Job 不是終態，handler 拋出例外，且以 receipt handle 和退避秒數呼叫了 `ChangeMessageVisibility`。
- 暫時性錯誤、receive count 達上限（4）：Job 變成 failed，handler 正常結束。
- 重複投遞到已經 succeeded 或 failed 的 Job：Job 不變，轉錄器沒有被呼叫，handler 正常結束。
- job id 出現在執行期間的每一行 log 上，包括 "job picked up by worker" 行帶有 `queue_wait_seconds`。

Prior art：現有的 Celery task 測試（以 `TestCase` 建立 Job、patch 轉錄器、驗證 Job 最終狀態）與 log 測試。這兩份測試會改寫到這個 seam 上。

### Seam 2：API 送出 Job（沿用既有 seam）

- API 測試由 patch Celery 的 `delay` 改為 patch enqueue 函式：建立 Job 與 retry failed Job 時，enqueue 函式以 job id 被呼叫。
- 驗證 enqueue 發生在 transaction commit 之後（以 Django 的 on-commit 測試機制觸發）。
- enqueue 函式本身一個小測試：送出的訊息 body 是 `{"job_id": <id>}`。這是 handler 解析的同一份契約。

Prior art：現有的 API 測試（patch dispatch、驗證狀態碼與呼叫參數）。

### 不寫單元測試的部分

- Terraform（Lambda、ESM、SQS、dashboard、IAM）：由 `./scripts/verify.sh full` 的 Terraform validate 涵蓋，實際行為由部署後的 burst 實驗觀察。
- 本機 poll shim：只做「收訊息 → 組 event → 呼叫 handler → 依結果刪除訊息」，由本機 `docker compose up` 手動送一份 Job 驗證。
- 服務層與並發測試：不變，繼續保留。
- 轉錄器測試：不變。

### 刪除的測試

- Celery 設定測試整份刪除。

### 驗證實驗

- 部署後以 Batch Submitter 腳本在 Lambda 上送出 250 份 Job（Load Model，24 秒），記錄全部完成時間與 Worker Count 峰值。只記錄數字，不設成功門檻。

## Out of Scope

- 把 API 移到 Lambda、API Gateway 或 Function URL。
- 把正式環境切換成真實轉錄器，以及在 Lambda 上實測 4 小時影片的 Execution Time。
- 調降 Admission Limit。
- RDS Proxy 或提高 RDS 規格，也就是提高 Scaling Ceiling。
- Provisioned concurrency 或任何常駐容量。
- 新的 alarm 與通知管道（SNS、email）。系統停擺的判斷目前只靠 dashboard 上的 Backlog 與 Worker Count。
- 為被推翻的 ADR 撰寫 supersede 記錄。
- 保留舊佇列裡的訊息：改名時佇列會被刪除重建，部署當下佇列中的訊息會遺失，這在 build-and-destroy 的學習環境中可以接受。
