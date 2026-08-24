Status: done

# 05 — Worker 跑上 Fargate

**What to build:** 把 Worker 從「開一台虛擬機、跑一段 shell 腳本」換成容器編排上的一個
service。這張票結束時，透過既有 API 送出的 Job，會由 Fargate 上的 Worker 取走並完成。

API 此時**仍然留在原本的 Auto Scaling Group 上**。這個混合狀態是刻意的：它可以運行、
可以驗證，而且讓這張票與 06 各自塞得進一個 context window。

同時建立真實的佇列與它的 dead-letter queue。DLQ 帶有上限的投遞次數，讓一則永遠不會
成功的訊息停止消耗容量，而不是無限迴圈。應用層的重試發出的是新訊息，不會增加既有
訊息的投遞計數，所以兩層重試不會互相累加 —— 這是刻意的分層，不是重複。

容量此時是固定的，**不設 scaling policy**（那是 07）。Worker 的 Celery 併發數設為 1：
放棄多工的成本效率，換取容量訊號的物理意義 —— 不可見訊息數精確等於 In-flight Job 數。

Task 規格需要明確涵蓋 CPU 與暫存磁碟，不能只想著記憶體：執行過程包含一段 CPU 密集的
重新編碼與本機檔案寫入，不是純粹的 I/O 等待。

**Blocked by:** 01, 03

- [x] Worker 以容器編排的 service 形式運行，容量固定
- [x] 透過既有 API 送出的 Job 由該 service 取走並抵達終態
- [x] 真實佇列與 DLQ 建立，投遞次數有上限
- [x] Worker 的 Celery 併發數為 1
- [x] Task 規格明確宣告 CPU 與暫存磁碟，且其數值可回溯到 02 的量測
- [x] Worker 的權限為最小必要，且不再依賴虛擬機的身分
- [x] 環境變數對帳檢查指向新的設定宣告來源（使用 01 建立的替換點）
- [x] 尚未建立任何 scaling policy
- [x] `./scripts/verify.sh full` 通過
