Status: done

# 01 — 拆掉舊 demo，立起新的敘事骨架

**What to build:** 讓 `/scalability` 這一頁講的東西，換成這個系統實際具備的能力。

這一頁目前的主張是「手動把 Worker 從 2 台加到 4 台，drain time 減半」，操作方式是
`docker compose --scale worker=N`。那個操作已經被系統自己的設計否定了——Worker 的
數量現在由 Backlog 這個訊號決定，不由人去撥。頁面留著它，等於在展示一個已經不存在
的架構。

這張票把舊的整組拆掉，並換上開場。開場不從定義開始，從情境開始：一個 Batch
Submitter 每天在固定時間丟進幾百份 Job。這個場景講完之後，讀者會自己想到「那平常
沒工作的時候呢」——這一段就在那裡收尾，說明為什麼最小容量是 1 而不是 0：擴容門檻
是為 burst 訂的，Interactive Submitter 一次送一份，永遠推不到那個門檻，從 0 出發
那份 Job 會一直等下去。

這一頁不再有任何需要登入才能做的事，因此不再讀取使用者狀態。這是刪掉 demo 的連帶
結果，不是對 authentication 的改動——`/auth`、`AuthContext` 一律不動。

迴路圖與證據區的位置這張票先留空，由 02、03 填入。

**要刪的東西**（刪乾淨，不留孤兒）：批次送出按鈕與它的 sessionStorage 對照邏輯、
兩輪 drain time 的 speedup 計算、LIVE JOB GRID、WORKERS vs DRAIN TIME 結果區、
`HOW TO RUN · WHY IT SCALES` 的 Foldout、頁面底部的 scale-out Excalidraw 圖連同它
在 scene 模組裡的 export 與 `.excalidraw` 原始檔（確認無他處引用）。

副標改為 `A Closed Loop Between Backlog and Capacity`。大標題不動。

（原訂的副標寫的是 "Queue Depth"，那是 `CONTEXT.md` 在 **Backlog** 條目下明列
要避免的說法。頁面內文用的是 Backlog，副標不能自相矛盾。）

**Blocked by:** None — can start immediately.

- [x] 未登入狀態下頁面完整呈現，沒有任何「請先登入」的提示
- [x] 情境段落以 Batch Submitter 的 burst 開場，並以「為什麼保留一個 Worker」收尾
- [x] 副標為 `A Closed Loop Between Backlog and Capacity`
- [x] 上列待刪項目全部移除，repo 內沒有殘留參照（scene export 已移除；`.excalidraw`
      原始檔保留，因為「確認無他處引用」不成立——見下方註記，已轉交
      `issues/scaling-control-loop/12`）
- [x] 這一頁不再 import 任何 auth 相關模組，且 `/auth` 與 `AuthContext` 未被修改
- [x] `./scripts/verify.sh full` 通過

**實作註記：`.excalidraw` 原始檔未刪除。** 刪除的前提「確認無他處引用」不成立，
有兩處：`scripts/check_repo_contract.py` 把它宣告在 `DIAGRAM_ASSETS`（刪檔會讓
`verify.sh full` 出現 REPO004，反而違反本票最後一條驗收），而 README 仍在使用它
配對的 render `docs/diagrams/rendered/5-scale-out.png`，README 屬於
`issues/scaling-control-loop/12` 的範圍。因此本票只移除前端對它的使用，四者的退役
已記在 12。

**副標的修訂**：原訂字串使用 "Queue Depth"，與 `CONTEXT.md` 的 **Backlog** 條目衝突，
改為 `A Closed Loop Between Backlog and Capacity`。
