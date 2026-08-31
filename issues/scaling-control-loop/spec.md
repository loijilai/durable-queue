# Scaling Control Loop

## Problem Statement

這個系統宣稱自己是可擴展的，但實際上不是。

`README.md` 的 Non-functional requirements 寫著「the API tier and the worker tier
scale independently, on different signals (HTTP concurrency vs. queue depth)」，
而 Terraform 裡兩個 Auto Scaling Group 都是 `min = max = desired = 2`，沒有任何
scaling policy。也就是說：**沒有任何一個機制在讀 queue depth，也沒有任何一個機制
會因為它而改變容量。** 那句話描述的是一個意圖，不是一個實作。

這造成三個具體後果：

1. **Batch Submitter 的 burst 沒有任何東西在吸收。** 一次送進幾百個 Job，容量固定
   是兩個 Worker，Backlog 只會單調變長，而系統沒有任何機制知道這件事正在發生，更
   不會做出反應。
2. **系統對「慢」是盲的。** 全 repo 沒有任何 CloudWatch alarm、metric、structured
   logging。Job 變慢時，唯一的觀測手段是人去看資料庫。沒有任何一個數字可以回答
   「現在健不健康」，也沒有任何一個數字可以在事後回答「當時發生了什麼」。
3. **容量的抽象層級跟問題不合。** 要調整處理能力，得去操作虛擬機的數量，但問題領域
   裡的單位是 Job 和 Worker。這個落差讓「把容量接上一個訊號」這件事比它應該有的樣子
   困難，而困難正是它至今沒被做的原因。

一個叫 durable-queue 的系統，把「接受了的工作一定會完成」當作賣點，卻沒有任何機制
在保護「完成」的時間；也沒有任何觀測能力可以說出它有沒有做到。

## Solution

為系統建立一條**閉合的控制迴路**：

```
Backlog 上升 → CloudWatch alarm → scaling policy → Worker 數量上升
     ↑                                                      ↓
     └───────────────── Backlog 被消化 ←─────────────────────┘
```

以及一組足以觀測這條迴路的最小 observability。所有其他的變更，都是為了讓這條迴路
成立而做的手段，不是目的本身：

- **Broker 換成 SQS**，因為驅動這條迴路的 Backlog 訊號，以及餵給 dashboard 的佇列
  指標，在 SQS 是受管而免費的；在 Redis 則要自己建置與維運一個發布器。
- **Compute 換成 ECS/Fargate**，因為這條迴路的控制桿需要作用在 Worker 上，而不是
  虛擬機上。
- **Observability 只做兩件事**：受管服務內建的指標，以及以 job id 為鍵的 structured
  log。應用程式不主動發送任何 metric。

服務水準的承諾訂在 **Queue Wait** —— 從 Acceptance 到 Worker 取走之間的時間 ——
而不是使用者實際感受到的 Completion Latency。理由是後者包含 Execution Time，而
Execution Time 由影片長度決定，沒有任何容量決策能移動它。**只對自己控制得了的量
做承諾，對控制不了的量做觀測與准入限制。**

驗收的形式是一次**可重現的實驗**而非一個長存環境：`terraform apply` → 送出一次
burst → 擷取 dashboard → `terraform destroy`。這與這個專案「基礎設施用完即毀」的
既有約束一致，而且它比長存的 demo 更有說服力 —— 無負載時的 demo 什麼都證明不了。

## User Stories

### Interactive Submitter

1. As an Interactive Submitter, I want my single Job to start being processed
   promptly even when the system has been idle, so that I am not made to wait for
   a burst-sized Backlog to accumulate before any capacity exists.
2. As an Interactive Submitter, I want my Job to keep its place when a Batch
   Submitter burst arrives at the same moment, so that my request is not starved
   by a workload with entirely different latency needs.
3. As an Interactive Submitter, I want a Job that was accepted to eventually
   reach a terminal state even if the Worker processing it disappears, so that I
   never see a Job stuck forever in a non-terminal state.
4. As an Interactive Submitter, I want the system to reject a video that is
   longer than it is willing to process, at submission time, so that I am told
   immediately rather than after a long wait ending in failure.

### Batch Submitter

5. As a Batch Submitter, I want to submit several hundred Jobs in a short window
   without any of them being rejected, so that my scheduled run does not have to
   implement its own pacing.
6. As a Batch Submitter, I want the queue to absorb my burst as temporary
   Backlog, so that submission stays fast regardless of how much work is already
   outstanding.
7. As a Batch Submitter, I want capacity to grow in response to my burst without
   anybody intervening manually, so that a scheduled run at an unattended hour is
   handled the same as one during working hours.
8. As a Batch Submitter, I want capacity to shrink again once my burst is
   absorbed, so that the system does not carry my peak cost permanently.

### Operator — capacity

9. As an Operator, I want Worker capacity to be driven by a documented signal
   rather than by a fixed number, so that the system's claimed scalability is a
   mechanism rather than an aspiration.
10. As an Operator, I want the scale-out threshold to be a number I derived from
    a measurement, so that I can explain what it protects and what would change
    it.
11. As an Operator, I want a Scaling Ceiling derived from downstream capacity
    rather than from what the compute platform can supply, so that growth stops
    before it endangers the database or the transcription API.
12. As an Operator, I want work beyond the Scaling Ceiling to wait in the
    Backlog, so that the system degrades by getting slower rather than by
    breaking something downstream.
13. As an Operator, I want at least one Worker always running, so that the
    latency need of an Interactive Submitter is served by a different mechanism
    than the throughput need of a Batch Submitter.
14. As an Operator, I want scale-in to consider In-flight Jobs and not only
    Backlog, so that removing capacity never kills work that is already running.
15. As an Operator, I want one Job per Worker, so that the number of running
    containers, the number of In-flight Jobs, and the unit that capacity
    decisions move are all the same number.
16. As an Operator, I want capacity to be expressed as a count of Workers rather
    than a count of machines, so that the control lever matches the unit the
    problem is stated in.

### Operator — observability

17. As an Operator, I want a single dashboard showing Backlog, In-flight Jobs,
    Worker count, and Queue Wait on one time axis, so that I can see whether a
    capacity change actually produced the effect it was supposed to.
18. As an Operator, I want Queue Wait measured as the interval between Acceptance
    and pickup, so that my service level indicator excludes a term that no
    capacity decision can move.
19. As an Operator, I want an alarm on the age of the oldest outstanding Job, so
    that I am told when the system is failing to keep up rather than discovering
    it later.
20. As an Operator, I want every log line to be structured and to carry the job
    id, so that I can reconstruct what happened to one specific Job without
    reading unstructured text.
21. As an Operator, I want each phase of a Job's execution to be logged with its
    duration, so that when Completion Latency degrades I can tell whether the
    cause is queuing or execution.
22. As an Operator, I want to query the breakdown of execution phases ad hoc
    rather than maintaining pre-aggregated metrics for them, so that
    observability does not accrue standing cost for questions I ask rarely.
23. As an Operator, I want the application to publish no metrics of its own, so
    that every metric in the system is either managed by a provider or derived
    from a log line, and none of them is a component I have to keep alive.
24. As an Operator, I want failures classified by reason in the logs, so that I
    can distinguish a downstream rate limit from a broken input without opening
    each Job.

### Operator — reliability and deployment

25. As an Operator, I want a dead-letter queue with a bounded delivery count, so
    that a message that can never succeed stops consuming capacity instead of
    looping forever.
26. As an Operator, I want application-level retries and infrastructure-level
    redelivery to remain as two distinct layers, so that recognised failures and
    unrecognised process death are each handled by the mechanism suited to them.
27. As an Operator, I want the visibility timeout derived from the measured
    longest Execution Time, so that it is long enough to avoid double delivery
    and short enough that recovery from a dead Worker is not needlessly slow.
28. As an Operator, I want database migrations to run as a single one-off step
    rather than inside every instance's start-up, so that a rolling deployment
    cannot run them concurrently.
29. As an Operator, I want deployments to roll without downtime through the
    orchestrator's own mechanism, so that zero-downtime is a property of the
    declared configuration rather than of a hand-written procedure.
30. As an Operator, I want one image serving both the API and Worker roles, so
    that the build-once-run-many property the project already has is preserved
    across the migration.
31. As an Operator, I want the API tier deployed declaratively rather than by a
    shell script running on a booted machine, so that the least reproducible part
    of the system stops being the least reproducible part.
32. As an Operator, I want the API tier to have no scaling policy, so that no
    mechanism exists that no measurement asked for.

### Developer

33. As a Developer, I want the broker change to require no change to Job
    processing logic, so that the cost of the migration stays inside
    configuration and infrastructure.
34. As a Developer, I want the local stack to run without any cloud account, so
    that the development loop is unaffected by the production broker choice.
35. As a Developer, I want the environment-variable contract check to keep
    working after the machine start-up script is deleted, so that a check that
    silently stops verifying anything does not survive the migration.
36. As a Developer, I want the whole verification harness to remain a single
    entry point, so that the migration adds no new way to run checks.
37. As a Developer, I want the dead Celery result backend removed rather than
    migrated, so that configuration that nothing reads does not get carried
    forward into the new system.

### Reviewer

38. As a Reviewer, I want a recorded run showing Backlog rising, Worker count
    following, and Queue Wait returning below its threshold, so that the control
    loop is demonstrated rather than asserted.
39. As a Reviewer, I want the capacity experiment to run against a Load Model
    with a configured Execution Time, so that the result is attributable to
    capacity behaviour rather than to variance in the videos chosen.
40. As a Reviewer, I want real transcription verified separately from the
    capacity experiment, so that two different claims are supported by two
    different pieces of evidence.
41. As a Reviewer, I want the experiment's pass conditions written down before it
    is run, so that it functions as an acceptance test rather than as a
    demonstration.
42. As a Reviewer, I want each significant decision to record the alternative it
    rejected and the condition that would reopen it, so that I can judge the
    reasoning and not merely the outcome.
43. As a Reviewer, I want the known durability gaps stated as accepted decisions
    with their costs, so that I can tell deliberate scope from oversight.
44. As a Reviewer, I want the whole environment reproducible from infrastructure
    code with no manual steps, so that a system that does not exist between
    experiments is still credible.

## Implementation Decisions

所有決定的完整理由記錄在 `docs/adr/0001` 至 `0011`。此處只記錄實作層面的形狀。

### 量測先行

Scaling policy 的門檻、visibility timeout、Load Model 的執行秒數，全部是**從量測
推導出來的數字**，不是選定的常數。因此第一項工作是一個小型量測，而非設定值的猜測。

量測形式：3–5 支長度差異大的影片（約 5 / 20 / 60 / 120 分鐘），各跑一次真實轉錄，
記錄三個階段的耗時（下載、重新編碼、轉錄呼叫）。產出是一條模型

```
Execution Time ≈ a + b × video_duration
```

以及三個階段的佔比。**目標是模型不是分佈**：樣本數會誠實記錄，不會用少量樣本宣稱
百分位數。這趟量測同時回答一個既有的未知數：下游轉錄 API 在這個使用模式下會不會
觸發 rate limit。

後續所有參數都標註它從這條模型的哪一項推導而來。

### Broker

- Celery 的 broker 從 Redis 換成 SQS。Job 處理邏輯、`views` 的 dispatch 呼叫、
  `tasks` 的宣告全部不變 —— 這是設定變更，不是程式碼遷移。
- Result backend **刪除**而非遷移：它有設定但無人讀取，Job 狀態的唯一真相是資料庫。
  改為明確關閉結果儲存。
- `worker_prefetch_multiplier` 設為 1，搭配既有的 `acks_late`。這不是效能調校，
  而是**指標正確性的前提**：預取的訊息會轉為不可見，Backlog 會顯示成已消化，而工作
  其實只是移動到一個觀測不到的地方。
- 佇列設定 dead-letter queue 與有上限的接收次數。應用層的重試會發出新訊息而非增加
  既有訊息的接收次數，因此兩層重試不會互相累加。
- Visibility timeout 從量測到的最長 Execution Time 乘以安全係數推導。這是一個張力
  而非自由參數：太短會讓仍在執行的 Job 被重複投遞，太長會拉長 Worker 猝死後的復原。
- ElastiCache 整個移除。這是一個元件的消失，不是替換。

### Compute

- 兩個 Auto Scaling Group 與機器開機腳本，換成 ECS/Fargate 上的兩個 service。
- 兩個 task definition 共用同一份 image，只有啟動指令不同 —— 與現行兩個 launch
  template 只有 `run_command` 不同的結構完全對應。
- Worker 的 Celery concurrency 設為 1。刻意放棄多工帶來的成本效率，換取容量訊號的
  物理意義：不可見訊息數精確等於 In-flight Job 數。
- Task 規格從量測結果推導，需明確涵蓋 CPU 與暫存磁碟 —— 執行過程包含一段 CPU 密集
  的重新編碼與本機檔案寫入，不是純粹的 I/O 等待。
- 資料庫遷移從 API 的啟動指令中抽出，成為部署流程中的一次性 task。這修正的是一個
  既有的競爭條件（多個實例同時執行遷移），而滾動部署會放大它。
- API service 固定容量，**不設 scaling policy**。

### Scaling

- 採用 step scaling，**不用 target tracking**。target tracking 假設指標隨容量上升
  而下降；Backlog 由送進來的量決定，與 Worker 數量沒有這種關係，硬套會震盪。
- 擴容依據 Backlog；門檻設定為吸收 Batch Submitter 的 burst。
- Worker 最小容量為 1，不為 0。擴容門檻是為 burst 設定的，Interactive Submitter 的
  單一 Job 永遠達不到它；從 0 出發那個 Job 會無限等待。**最小容量服務互動延遲，
  scaling policy 服務批次吞吐 —— 兩種 submitter，兩個機制。**
- 縮容條件同時檢查 Backlog 與 In-flight Job 兩者皆低，不只看 Backlog。Backlog 為空
  不代表系統閒置，而容器停止的寬限期上限遠短於一個 Job 的執行時間。
- Scaling Ceiling 從下游容量推導：資料庫連線上限與轉錄 API 的 rate limit，取遠低於
  兩者的值。超出的部分留在 Backlog 等待 —— 刻意讓延遲上升以保護下游。

### Observability

- 應用程式**不呼叫任何 metric 發布 API**。系統中的每一個 metric，若非受管服務內建，
  即由 log 行經由 metric filter 導出。
- Queue Wait 的量測：Worker 取得 Job 時，在 structured log 中輸出等待時間欄位（Job
  的建立時間已存在於資料表）。掛在 Celery 的 task 生命週期 signal 上，不侵入業務
  邏輯。再以 log metric filter 轉為 metric。
- 佇列內建的「最舊未刪除訊息年齡」**不作為 Queue Wait 使用**：Worker 延遲確認，
  In-flight 訊息尚未刪除，因此該指標實為等待時間加上已執行時間。它仍會呈現在
  dashboard 上，但正名為「最舊未完成 Job 年齡」，作為 Completion Latency 的觀測。
- 應用程式日誌改為 JSON 結構化輸出，每行帶 job id；容器日誌交由容器平台原生的日誌
  驅動送出。
- 單一 dashboard，四條線同一時間軸：Backlog、In-flight Job、Worker 數量、Queue Wait。
  另加最舊未完成 Job 年齡作為觀測線。
- 單一 alarm：最舊未完成 Job 年齡超過門檻。
- 執行階段的耗時分解以臨機查詢取得，不預先聚合為 metric。

### 部署

- CI/CD 的最後一步從機器實例更換，改為容器服務的滾動更新並等待穩定，配合最低健康
  百分比設定。這是等價替換：**不引入藍綠部署、金絲雀或部署編排服務** —— 它們沒有
  對應的需求。
- 遷移的一次性 task 插在基礎設施套用之後、服務更新之前。

### 既有檢查的修補

- 環境變數三方對帳檢查目前將機器開機腳本寫死為對帳的第三方。該檔案在此次遷移後不再
  存在，檢查會靜默地失去意義。必須改指向 task definition 的環境變數宣告。
- 模組邊界檢查的既有規則不受此次變更影響（dispatch 仍經由既有模組），無需放寬。
- `CODING_CONVENTION.md` 中描述 Redis 角色的條目需隨之更新。

## Testing Decisions

三個接縫，各自回答一個其他接縫無法回答的問題。不新增第四個。

### 1. `./scripts/verify.sh full` —— 既有，靜態可驗證的一切

不新增入口。落在其中的新增驗證：

- **Queue Wait 的 log 發出**：Worker 取得 Job 時是否輸出帶有等待時間與 job id 的
  結構化 log 行。以既有的 Django 測試套件覆蓋。
  Prior art：`jobs/tests/test_task.py` 已用同樣方式直接呼叫 task 並斷言其副作用。
- **Celery 設定生效**：預取倍數、結果儲存關閉等設定的實際值。
  Prior art：`jobs/tests/test_service.py` 的 AAA 結構。
- **環境變數契約**：對帳檢查改指向新的設定來源後仍然有效。
  Prior art：`scripts/tests/` 下對這些檢查器本身既有的測試 —— 修改對帳目標時，
  這些測試是保護網，必須同步更新而非繞過。
- **Terraform 驗證**：既有的格式與語法檢查涵蓋新增的資源。此處誠實說明其強度：
  它驗證語法，不驗證行為。

### 2. 本機 compose stack —— 既有接縫，換一個後端

以本機 SQS 相容服務取代 Redis 容器。回答的問題是「換 broker 有沒有弄壞應用程式」，
且不需要任何雲端帳號。通過條件：`docker compose up` 後可送出 Job 並看到它到達終態。

### 3. Burst 實驗 —— 新接縫，控制迴路的驗收測試

這是唯一能驗證控制迴路的東西。它**不進 CI**（需要真實雲端環境），但它是驗收測試而
非展示：通過條件在執行之前寫定。

- **負載產生器**：取得憑證後，以固定併發在短時間內送出約數百個 Job，輸出提交時間戳。
  刻意做成最小腳本而非壓測框架 —— 受測的不是 API 的吞吐，是佇列的吸收能力。它同時
  扮演需求文件中 Batch Submitter 的角色，命名應與該角色一致。
  （repo 中存有此腳本先前版本的編譯殘留，原始檔已不存在，需重建。）
- **執行環境**：使用 Load Model，其 Execution Time 由設定指定為量測得到的平均值。
  替換掉不受測的元件，是實驗結果可歸因的前提；這項替換會明確陳述而非隱藏。
- **通過條件**（執行前寫定）：
  1. burst 期間無 Job 被拒絕；
  2. Worker 數量在擴容門檻被觸發後上升；
  3. Queue Wait 在 burst 期間上升，並在 Backlog 歸零後回到 burst 前的基線；
  4. Backlog 回到零之後容量縮回；
  5. 縮容過程中沒有 In-flight Job 被中止；
  6. 全程無 Job 進入 dead-letter queue。
- **產出**：dashboard 的擷取畫面與錄影，以及對照上述條件逐條的判讀。

### 4. 真實轉錄的正確性 —— 與實驗分離

以少量真實 Job 單獨驗證，不在容量實驗中宣稱。兩個實驗證明不同的事，分開報告。
Prior art：`jobs/tests/test_real_transcriber.py` 已覆蓋轉錄流程的錯誤分類與分段
邏輯，此處只需端到端的存在性驗證。

## Out of Scope

以下項目**明確不做**，且理由已記錄，以免日後被誤認為疏漏：

- **Transactional outbox**。資料庫提交與 broker 投遞之間的雙寫缺口存在且已知。
  記錄於 ADR-0009。
- **孤兒 Job 的定期重新投遞（reconciler）**。ADR-0009 已將其記為採用的方向，但它是
  應用程式碼而非基礎設施，這一輪的複雜度預算全部投入控制迴路。
- **Idempotency key**。重複提交會產生重複的 Job；成本是一次浪費的轉錄，不是資料
  損毀。記錄於 ADR-0009。
- **Distributed tracing**。兩個服務隔著一個佇列，以 job id 串接的 structured log
  已提供 tracing 在此拓撲下能給的全部價值。記錄於 ADR-0007。
- **資料庫連線代理**。連線上限是真實的擴展天花板，處理方式是把 Scaling Ceiling 設在
  它之下並記錄下來，而非引入新元件。
- **VPC endpoint 取代 NAT**。在基礎設施用完即毀的前提下，NAT 的成本不構成理由。
- **藍綠部署、金絲雀、部署編排服務**。滾動更新是等價替換，其餘沒有對應需求。
- **Lambda**。已評估並否決，含重新開啟這個決定的條件，記錄於 ADR-0004。
- **API tier 的 scaling policy**。沒有任何量測指出需要它。記錄於 ADR-0011。
- **長存的展示環境**。驗收形式是可重現的實驗，記錄於 ADR-0010。
- **API 吞吐的壓力測試**。受測對象是佇列的吸收能力，不是 API 的每秒請求數。
