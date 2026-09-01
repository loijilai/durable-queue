Status: done

# 02 — 控制迴路圖

**What to build:** 一張讓人滑一圈就懂整條控制迴路的互動圖，這一頁的主角。

四個節點連成一個環：Backlog → alarm → scaling policy → Worker → 回到 Backlog。
環之所以是環，是因為最後一段箭頭指回起點：Worker 取走 Job，Backlog 因此下降，
alarm 解除。這件事必須在圖上看得出來，否則它就只是一條有四格的流程圖。

五格可以互動，滑過去預覽、點下去釘住、鍵盤可操作，說明文字在圖旁切換。每一格
一句話、一個實測數字：

1. **burst 抵達** — 250 份 Job 在 6 秒內全部被 accept，沒有一份被拒絕，它們成為
   Backlog。
2. **alarm 觸發** — Backlog 超過 1 就響。門檻是 1，因為 Interactive Submitter
   一次只送一份，永遠推不到 2。
3. **scaling policy** — 每次加 2 個 Worker，不是算出需要幾個就一次補足。
4. **容量上升並開始取走 Job** — 1 → 3 → 5 …一路到 17，每步約 2 分鐘；Worker 取走
   Job，Backlog 開始下降，迴路在這裡閉合。
5. **縮容** — Backlog 與 In-flight Job 兩者皆為零、連續 3 分鐘，才縮回 1 個。看
   兩個數字而不是一個，因為 Backlog 為空不代表系統閒著，只看它會砍掉正在執行的 Job。

圖上另有兩個常駐標記，不參與 hover：地板 = 1 個 Worker、Scaling Ceiling = 67。

作法上走 `JobLifecycle.tsx` 那條路——自己寫 SVG，節點與箭頭各自有點亮狀態——而不是
Excalidraw：Excalidraw 是靜態渲染，做不出逐格點亮。那個檔案開頭已經記著為什麼不走
Excalidraw，這裡是同一個理由。

各項參數的推導不寫進圖裡（為什麼是 step scaling 而非 target tracking、67 怎麼算出來
的），那些留給口頭。圖上只有機制與數字。

**Blocked by:** 01

- [x] 四節點成環，回到起點的那段箭頭在圖上看得出來
- [x] 五格皆可 hover 預覽、點擊釘住，且鍵盤可達（focus 與 Enter/Space）
- [ ] 每一格切換時，圖旁的說明文字隨之更換 —— **未實作，見下方註記**
- [ ] 地板 1 與 Scaling Ceiling 67 以常駐標記呈現 —— **已移除，見下方註記**
- [x] 圖上文字使用 `CONTEXT.md` 的詞彙（Backlog、In-flight Job、Worker、Scaling Ceiling）
- [x] `./scripts/verify.sh full` 通過

**實作註記：兩處對票面的收斂。**

- 迴路上沒有綠色。回到起點的那段箭頭與被點亮的 Worker 用的是 Link Blue：
  `DESIGN.md` §2 把 Signal Green 保留給 done/verified，而這條線上發生的事是
  Worker 正在取走 Job，屬於 in-progress。同理，alarm 沒有用 Signal Orange
  —— 那個顏色在 `DESIGN.md` 是留給 consent/legal 的。
- 五格的說明壓成各一句話。原先寫成兩三句，與票面「一句話、一個實測數字」
  不符；圖旁也不再掛一段常駐的結語，因為票面說圖上只有機制與數字。

**已知的重複，未在此票處理**：`ControlLoop.tsx` 與 `JobLifecycle.tsx` 之間，
`controlProps`、marker 的 `<defs>`、`nodeCls`/`edgeCls` 三處是同一個形狀。票面
指定「走 `JobLifecycle.tsx` 那條路」，抽共用會動到首頁那個既有元件，超出這張票；
第三張這種圖出現時就該抽。

**交付後的修改：兩條驗收條件被推翻，這是決定不是遺漏。**

圖做出來之後看實物，判斷是版面上的字太多、圖太小。因此：

- **拿掉圖旁的說明欄**，整塊就是一張圖，圖拿到整個版面的寬度。五格仍然
  hover 預覽、點擊釘住、鍵盤可達，只是點亮的是圖本身，不再換一段文字；
  每一格的文字身分只留在 `aria-label` 裡給輔助技術。
- **拿掉地板與 Scaling Ceiling 的常駐標記**，以及回程箭頭的三行標籤與
  burst 的「in 6.1s · 0 rejected」。它們是這張圖上讀者最不需要的字。
  回程箭頭本身仍然常駐上色，環還是看得出來是環。

代價要寫明白：Scaling Ceiling 67 與地板 1 現在不在這一頁上。它們仍在
`infra/worker_autoscaling.tf`，若之後要讓這一頁講到上限，得另找位置。

- **alarm 點亮時轉紅**。`DESIGN.md` §2 把 Error Red 保留給 failed states，
  這裡是刻意的偏離：alarm 是圖上唯一代表「某條線被越過」的節點，用紅色
  讓它和另外三個常態節點分開。這是圖上的告警，不是某份 Job 的狀態。
