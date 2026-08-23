Status: done

# 02 — 量測 Execution Time 並產出模型

**What to build:** 目前 spec 裡有三個參數是空的：scaling policy 的擴容門檻、
visibility timeout、以及 Load Model 的執行秒數。它們必須從量測推導，而不是選定。
這張票產出那份量測。

受測對象是真實轉錄流程，取以下 4 支長度差異大的影片，各跑一次，分別記錄下載、重新編碼、
轉錄呼叫三個階段的耗時：

| 長度    | URL                          |
| ------- | ---------------------------- |
| 2h08m   | https://youtu.be/N5AQFYtqx8Q |
| 8m34s   | https://youtu.be/mBePcvqLX88 |
| 20m43s  | https://youtu.be/UNzCG3lw6O0 |
| 58m45s  | https://youtu.be/sMujMp4h_EY |

量測用的計時 harness 放在 `scripts/`，作為一支獨立於 `jobs/` 生產程式碼邊界之外的
一次性工具 —— 不受 `check_architecture.py` 的 import 邊界規則約束，也不透過應用程式
的 Celery task 執行，而是直接呼叫 `jobs/transcribers.py` 內的下載／切片／轉錄函式並
插入計時點。

產出是**一條模型，不是一個分佈**：

```
Execution Time ≈ a + b × video_duration
```

以及三個階段各自的佔比。樣本數會誠實寫出來 —— 用少量樣本宣稱百分位數是不誠實的，
而一條有斜率的模型比一個假的 p95 更有用，因為它能回答「多長的影片對應多久」。

這趟量測同時回答一個既有的未知數：下游轉錄 API 在這個使用模式下會不會觸發 rate
limit。答案會成為 Scaling Ceiling 的推導依據之一。

**Blocked by:** None — can start immediately.

- [x] 轉錄的測試script可以寫在scripts底下
- [x] 上述 4 支影片各完成一次真實轉錄，逐支記錄三個階段的耗時
- [x] 產出線性模型的兩個係數，以及三個階段的佔比
- [x] 明確記錄樣本數，且文件中不出現以此樣本推得的百分位數
- [x] 記錄下游 API 在此使用模式下是否觸發 rate limit，以及觀察到的任何節流跡象
- [x] 記錄依此模型，Admission Limit 上限的影片對應多長的 Execution Time
- [x] 量測結果存放在此 feature 目錄下，供 07 與 11 直接引用

**結果：** 見 [execution-time-samples.json](./execution-time-samples.json)（原始樣本）與
[02-measure-execution-time-results.md](./02-measure-execution-time-results.md)（模型與報告）。
