Status: open

# 12 — 更新 README 與架構圖

**What to build:** 讓文件描述實際存在的系統。

README 目前在 Non-functional requirements 宣稱「the API tier and the worker tier
scale independently, on different signals」，而那句話至今沒有任何機制支撐 —— 這正是
整個 feature 的出發點。這張票排在 11 之後，是為了讓那句話終於有 11 擷取到的證據撐著，
而不是再一次描述一個意圖。

需要更新的至少有：架構敘述與圖（不再有 Auto Scaling Group 與 ElastiCache）、
Deep dive 中關於 durability 與 scalability 的段落、技術棧表格、以及本機開發的說明。

Deep dive 應該把這個 feature 的推理帶進去，而不只是換掉名詞 —— 特別是「為什麼承諾
訂在 Queue Wait 而不是使用者實際感受到的時間」。這是整份文件裡最能展現判斷力的一段，
而它現在不存在。

**Blocked by:** 11

- [ ] 架構敘述與圖反映實際的運算層、佇列與容量機制
- [ ] 「兩條獨立擴展軸」的宣稱由 11 的證據支撐，或改寫為它實際能支撐的說法
- [ ] Deep dive 涵蓋服務水準指標的選擇理由，而非僅描述機制
- [ ] 技術棧表格與本機開發說明反映新的 broker 與運算層
- [ ] 文中所有指向 ADR 與此 feature 目錄的連結有效
- [ ] 退役 `5-scale-out` 這張圖：`frontend/src/assets/diagrams/5-scale-out.excalidraw`、
      `docs/diagrams/rendered/5-scale-out.png`、`scripts/check_repo_contract.py` 的兩筆
      `DIAGRAM_ASSETS` 宣告、以及 README 對該圖的引用，四者一起處理
- [ ] `./scripts/verify.sh full` 通過

**備註（來自 `issues/scalability-page-narrative/01`）**：`/scalability` 頁面已經不再使用
`5-scale-out` 這張圖，前端的 `scaleOutScene` export 已移除。但 `.excalidraw` 原始檔沒有一併
刪除，因為它仍被 `check_repo_contract.py` 宣告為既有資產，而它的 render 仍是 README 這一段的
插圖——單獨刪掉原始檔會讓 `verify.sh full` 出現 REPO004。四者要一起退役，而那正是這張票的範圍。
