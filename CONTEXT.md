# durable-queue

一個非同步轉錄服務：使用者送出 YouTube URL，系統承接這份工作的責任，並在使用者不必
保持連線的情況下產出逐字稿。這份文件是這個專案的詞彙表 —— 我們使用的字，以及我們
刻意不使用的字。

## Language

### 工作本身

**Job**：
一份轉錄工作的單位 —— 一個影片 URL，屬於一位 submitter，走過固定的生命週期。系統的
durability 承諾是對 Job 做出的，不是對建立它的那個請求。
_Avoid_: task、工作項、request

**Acceptance**：
系統承接一份 Job 責任的那一刻。當且僅當 submitter 收到帶有 job id 的 `201` 時，這份
Job 才算被 accept。在那之前系統什麼都沒承諾；在那之後，弄丟這份 Job 就是缺陷。
_Avoid_: submission、建立、enqueue

**Admission Limit**：
系統願意接受的影片長度上限。它存在的目的，是讓 Execution Time 被系統自己選定的數字
所限制，而不是被 submitter 剛好送來什麼所決定。
_Avoid_: 長度上限、cap、quota

**Chunk**：
一份 Job 的音訊被切出的固定長度片段，大小設計成單次下游轉錄請求容納得下。Chunk 是
Job 的實作方式，本身永遠不是一份 Job —— 不完整的 Chunk 集合產不出 Transcript。
_Avoid_: segment、片段、part

**Transcript**：
一份 Job 的完整文字輸出。全有或全無：一份 Job 要嘛有，要嘛沒有。

### 誰在送工作

**Interactive Submitter**：
使用網頁介面的人。一次送一份 Job，時機不可預測，在意的是那一份 Job 的延遲。
_Avoid_: user、網頁使用者

**Batch Submitter**：
在固定時間一次送出大量 Job 的排程服務。在意的是吞吐量，不在意任何單一 Job 的延遲。
_Avoid_: cron、排程器、bot

這兩者是系統之所以有兩套獨立容量機制的原因：一套服務 Interactive Submitter 的延遲，
另一套服務 Batch Submitter 的吞吐。把它們混為一談，整個設計就會塌掉。

### 時間

**Queue Wait**：
從一份 Job 的 Acceptance 到 Worker 取走它之間的時間。這是系統的服務水準指標，因為它
是一份 Job 的總耗時當中，唯一能被容量決策移動的部分。
_Avoid_: latency、延遲、lag

**Execution Time**：
從 Worker 取走一份 Job 到它抵達終態之間的時間。主要由影片長度決定，因此是被
Admission Limit 所限制，而非被系統所控制。
_Avoid_: 處理時間、runtime

**Completion Latency**：
Queue Wait 加上 Execution Time —— submitter 實際感受到的時間。它會被觀測與呈現，
但永遠不會成為服務水準承諾的對象，因為系統手上沒有任何控制桿能移動它的第二項。
_Avoid_: 端到端時間、周轉時間

### 容量

**Backlog**：
已被 accept 但還沒有任何 Worker 取走的 Job 數量。容量決策所反應的領先訊號。
_Avoid_: queue depth、佇列深度、待處理數

**In-flight Job**：
已被 Worker 取走但尚未完成的 Job。與 Backlog 截然不同：Backlog 為空不代表系統閒置，
把兩者當成同一件事，會導致在工作正在執行時把容量抽掉。
_Avoid_: 執行中的 task、active job

**Worker**：
一個轉錄容量的單位。一個 Worker 同時只處理一份 Job，因此 Worker 的數量、In-flight
Job 的數量、以及容量決策增減的單位，三者是同一個數字。
_Avoid_: consumer、執行器、node

**Scaling Ceiling**：
系統願意運行的 Worker 數量上限，由 Worker 下游依賴的容量推導而來，而非由 compute
平台能供給多少而定。碰到它是預期中的事：超出的工作在 Backlog 等待，而不是把下游
壓垮。
_Avoid_: max capacity、上限

### 一詞多義的釐清

「task」這個字在這個專案的周邊指涉三件互不相關的事，因此永遠不單獨使用：

- **Celery task** —— Worker 執行的那個應用層函式。
- **ECS task** —— Worker 實際運行時所在的容器編排單位。
- 一份工作的單位 —— 請說 **Job**。

### 實驗

**Load Model**：
真實轉錄的替身，其 Execution Time 由設定指定而非由影片決定。當受測的性質是系統的
容量行為時使用，好讓量測結果不被實驗並不研究的那些變異所干擾。真實轉錄的正確性另外
單獨驗證。
_Avoid_: fake、mock、stub
