Status: done

# 03 — 證據：截圖與實機錄影

**What to build:** 讓「這件事真的發生過」這個宣稱有東西撐著。

迴路圖負責讓人懂，這一區負責讓人信。順序不能倒，所以它排在迴路圖之後。

素材來自 2026-08-31 的驗收實驗（`issues/scaling-control-loop/11-acceptance-experiment-results.md`）。
那次的基礎設施已經銷毀，這些截圖與錄影是僅存的證據，不會有新的——因此截圖**原圖照放，
不修改內容**。

**兩張截圖**，各回答一個不同的問題：

- **主圖**：四條線的 dashboard（`backlog-inflight.png`）。回答「Backlog 消化掉了嗎」。
  下方的圖說只當 legend，逐條說明四條線分別是什麼：藍 = Backlog（已 accept 但還
  沒有 Worker 取走）、橘 = In-flight Job（已被取走、還沒完成）、綠 = Worker 數、
  紅 = Queue Wait（右軸）。就這樣，不加判讀。
- **輔圖**：`sqs2.png` **裁切出最左邊那一格**（每分鐘取走的訊息數，2 → 33）。回答
  「Backlog 下降是因為容量變多嗎」。這一格是主圖最弱的地方——綠線被壓在圖底幾乎
  看不出在動——的補強。

截圖現在位於 `issues/` 底下，不在 frontend 的 build 範圍內，需要放進 frontend 自己的
資源目錄，沿用既有慣例。

**錄影卡片**：`https://youtu.be/-sCn0tKnO98`，即同一次執行的實機錄影，標明這一點。
YouTube 卡片的元件目前是 High Availability 頁裡的區域函式，需要抽成共用元件；HA 頁
改用抽出後的版本，呈現與行為不變。這是這次唯一一處超出 `/scalability` 的改動。

**Blocked by:** 01

- [x] 主圖與裁切後的輔圖由 frontend 自己的資源提供，頁面在無外部網路的情況下也能顯示
- [x] 主圖的圖說是四條線的 legend，使用 `CONTEXT.md` 的詞彙，不含判讀
- [x] 輔圖只包含最左邊那一格，並說明它回答的是哪個問題
- [x] 錄影卡片指向該影片，並標明是同一次執行的實機錄影
- [x] YouTube 卡片成為共用元件，High Availability 頁改用它且呈現不變
- [x] `./scripts/verify.sh full` 通過
