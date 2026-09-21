Status: done

# 02 — Lambda Worker 上線，移除 ECS worker 與 autoscaling

**What to build:** 部署之後，正式環境送出的 Job 由 SQS event source mapping 觸發 Lambda 執行完成。容量由平台依 Backlog 自動擴張，最多同時 67 個 Worker（Scaling Ceiling）；ECS worker service 與整套 step scaling control loop 不再存在。dashboard 的 Worker Count 顯示 Lambda 同時執行數。

見 spec：「Image」、「Infra（Terraform）」、「CD 與部署腳本」、「Harness 與檢查腳本」，以及「Lambda handler」中關於冷啟動讀取機密值的決策。

**Blocked by:** 01 — Worker 改為 SQS event handler，移除 Celery。

- [x] 後端 image 加裝 `awslambdaric`，API 與 Worker 仍共用同一個 image 與 tag；Lambda 以 container image 部署，用 `image_config` 指向 handler。
- [x] handler 冷啟動時從 Secrets Manager 取得 DB 密碼、`SECRET_KEY`、Google OAuth client，寫入環境變數後才初始化 Django；Lambda 環境變數中只放 secret ARN，不放明文機密。
- [x] Lambda function：timeout 900 秒、記憶體 2048MB、ephemeral storage 1024MB、private subnets 加 worker security group、`XDG_CACHE_HOME=/tmp`（或等效方式讓 yt-dlp 不寫唯讀檔案系統）、自己的 log group 保留 14 天。
- [x] Lambda execution role 只有：VPC 網路介面權限、Logs 寫入、對 Job 佇列的 `ReceiveMessage` / `DeleteMessage` / `GetQueueAttributes` / `ChangeMessageVisibility`、讀取 app secret 與 RDS master user secret。
- [x] ESM：`batch_size = 1`、`maximum_concurrency = 67`，Scaling Ceiling 的推導（RDS 連線預算）寫在這裡的註解；不設 reserved concurrency。
- [x] SQS 改名為 `durable-queue-jobs` 與 `durable-queue-jobs-dlq`，visibility timeout 900 秒、`maxReceiveCount = 4`、DLQ 保留 14 天。
- [x] API task definition 帶佇列 URL 環境變數，API task role 的 SQS 權限收斂為對新佇列送訊息所需的最小集合，移除 `ListQueues`。
- [x] 刪除 worker ECS task definition、service、兩個 IAM role、ECS log group，以及 worker autoscaling 的 scalable target、兩個 policy、兩個 alarm；ECS cluster 關閉 Container Insights。
- [x] dashboard 只剩一個 widget：Backlog、In-flight Jobs、Worker Count（`AWS/Lambda ConcurrentExecutions`）、Queue Wait（右軸）；Queue Wait metric filter 改掛 Lambda log group。
- [x] 刪除 Oldest Unfinished Job Age widget、`oldest-job-age-high` alarm、`execution-phase-breakdown` saved query，以及相關的 locals。
- [x] 環境變數對帳改以 Lambda function 的環境設定作為 Worker 部署來源，測試同步更新。
- [x] CD 的 worker 部署步驟改為以本次 image tag 更新 Lambda function code 並等待更新完成，順序在 migrate task 之後；手動部署腳本同步修改。
- [x] bootstrap CD role 移除 worker service、worker IAM role、autoscaling 權限，加入管理 Lambda function、ESM、Lambda log group，以及 Lambda execution role 的 `iam:PassRole`。
- [x] `./scripts/verify.sh full` 通過。
- [x] 部署後在正式環境送出一份 Job，由 Lambda 執行至 succeeded，log 帶 job id，dashboard 四條線皆有資料。
