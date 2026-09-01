Status: open (實驗已執行，六條通過條件全數通過；錄影、真實轉錄的分離驗證、基礎設施銷毀未完成 — see checklist)

# 11 — 執行驗收實驗並擷取證據

**What to build:** 這個 feature 的驗收測試。不是展示 —— 通過條件在執行之前就寫定了，
逐條判讀，不通過就是不通過。

流程：`terraform apply` → 送出 burst → 觀察 → `terraform destroy`。

**使用 Load Model，其 Execution Time 由設定指定為 02 量測得到的平均值。** 真實轉錄
在這裡是糟糕的量測工具：它的耗時隨挑到哪些影片而變動，而且數百份 Job 的 burst 裡每
一份都會向下游計費。把實驗不研究的元件替換掉，是結果可歸因的前提 —— 而這項替換要
明確寫出來，不是藏起來。

**通過條件（引自 spec，不得在執行後修改）：**

1. burst 期間無 Job 被拒絕
2. Worker 數量在擴容門檻被觸發後上升
3. Queue Wait 在 burst 期間上升，並在 Backlog 歸零後回到 burst 前的基線
4. Backlog 回到零之後容量縮回
5. 縮容過程中沒有 In-flight Job 被中止
6. 全程無 Job 進入 dead-letter queue

真實轉錄的正確性**另外**以少量真實 Job 單獨驗證，絕不以這次容量實驗為依據來宣稱。
兩個實驗證明不同的事，就當作兩件事來報告。

**Blocked by:** 06, 07, 08, 10

- [x] 完整流程可從基礎設施程式碼重現，無任何手動步驟
- [x] 實驗以 Load Model 執行，其執行秒數可回溯到 02
- [x] 六條通過條件逐條判讀並記錄結果
- [ ] dashboard 的擷取畫面與錄影產出
- [ ] 真實轉錄的正確性以少量真實 Job 單獨驗證，並與容量實驗分開報告
- [ ] 實驗結束後基礎設施完全銷毀
- [x] 判讀結果記錄在此 feature 目錄中

判讀結果：`11-acceptance-experiment-results.md`，六條通過條件全數通過。

未勾選的三項及其原因：

- **dashboard 的擷取畫面與錄影產出**：四張截圖已產出並記錄，錄影待補。
- **真實轉錄的正確性以少量真實 Job 單獨驗證**：尚未執行。`OPENAI_API_KEY` 目前沒有
  進到基礎設施（app secret 與 worker task definition 都沒有這一項），雲端要跑真實
  轉錄需先補這條路徑。
- **實驗結束後基礎設施完全銷毀**：人為決定保留，不是遺漏。
