Status: open

# 02 — 量測 Execution Time 並產出模型

**What to build:** 目前 spec 裡有三個參數是空的：scaling policy 的擴容門檻、
visibility timeout、以及 Load Model 的執行秒數。它們必須從量測推導，而不是選定。
這張票產出那份量測。

受測對象是真實轉錄流程，取 3–5 支長度差異大的影片（約 5 / 20 / 60 / 120 分鐘），
各跑一次，分別記錄下載、重新編碼、轉錄呼叫三個階段的耗時。

產出是**一條模型，不是一個分佈**：

```
Execution Time ≈ a + b × video_duration
```

以及三個階段各自的佔比。樣本數會誠實寫出來 —— 用少量樣本宣稱百分位數是不誠實的，
而一條有斜率的模型比一個假的 p95 更有用，因為它能回答「多長的影片對應多久」。

這趟量測同時回答一個既有的未知數：下游轉錄 API 在這個使用模式下會不會觸發 rate
limit。答案會成為 Scaling Ceiling 的推導依據之一。

**Blocked by:** None — can start immediately.

- [ ] 3–5 支長度差異大的影片各完成一次真實轉錄，逐支記錄三個階段的耗時
- [ ] 產出線性模型的兩個係數，以及三個階段的佔比
- [ ] 明確記錄樣本數，且文件中不出現以此樣本推得的百分位數
- [ ] 記錄下游 API 在此使用模式下是否觸發 rate limit，以及觀察到的任何節流跡象
- [ ] 記錄依此模型，Admission Limit 上限的影片對應多長的 Execution Time
- [ ] 量測結果存放在此 feature 目錄下，供 07 與 11 直接引用
