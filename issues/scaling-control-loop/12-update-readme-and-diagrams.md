Status: done

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

- [x] 架構敘述與圖反映實際的運算層、佇列與容量機制
- [x] 「兩條獨立擴展軸」的宣稱由 11 的證據支撐，或改寫為它實際能支撐的說法
- [x] Deep dive 涵蓋服務水準指標的選擇理由，而非僅描述機制
- [x] 技術棧表格與本機開發說明反映新的 broker 與運算層
- [x] 文中所有指向 ADR 與此 feature 目錄的連結有效
- [x] 退役 `5-scale-out` 這張圖：`frontend/src/assets/diagrams/5-scale-out.excalidraw`、
      `docs/diagrams/rendered/5-scale-out.png`、`scripts/check_repo_contract.py` 的兩筆
      `DIAGRAM_ASSETS` 宣告、以及 README 對該圖的引用，四者一起處理
- [x] `./scripts/verify.sh full` 通過

**備註（來自 `issues/scalability-page-narrative/01`）**：`/scalability` 頁面已經不再使用
`5-scale-out` 這張圖，前端的 `scaleOutScene` export 已移除。但 `.excalidraw` 原始檔沒有一併
刪除，因為它仍被 `check_repo_contract.py` 宣告為既有資產，而它的 render 仍是 README 這一段的
插圖——單獨刪掉原始檔會讓 `verify.sh full` 出現 REPO004。四者要一起退役，而那正是這張票的範圍。

**實作時的決定與偏離**

- README 改為**入口 + 索引**：四個 deep dive 各壓成一段，連到 walkthrough 網站對應頁面。
  網站（Vercel，與可銷毀的 AWS infra 分離）是敘事的 source of truth，README 不再維持
  第二份會漂移的長篇論證。
- **不連任何 ADR**（人為決定）。因此「文中所有指向 ADR 與此 feature 目錄的連結有效」
  這條是**真空成立** —— README 裡沒有這種連結，不是漏做。
- 「兩條獨立擴展軸」由**改寫**而非由 11 的證據支撐：ADR-0011 決定 API tier 不設 scaling
  policy，11 也沒測 API 擴展，那句話撐不起來。改成非對稱的誠實版本。
- Deep dive 3 講的是 **Backlog（致動訊號）與 Queue Wait（SLI）的分工**，而不只是
  「Queue Wait 不含 Execution Time」。scaling policy 實際讀 `ApproximateNumberOfMessagesVisible`
  （`infra/worker_autoscaling.tf:28`），兩者不等同；控制迴路不能建在只有傷害發生後才存在
  的量上。這比 ticket 原本要求的角度更貼近實際做了的事。
- **退役範圍超出 ticket 所寫的四件套**：README 是 `docs/diagrams/rendered/*.png` 的唯一
  消費者，改寫後八張全部成為孤兒（`3-worker-stuck-duplicate.png` 在此之前就已經是了）。
  整個 `docs/diagrams/rendered/` 目錄與 `DIAGRAM_ASSETS` 的九筆宣告一併刪除，`.excalidraw`
  原始檔保留（前端在用）。理由與退役 `5-scale-out` 相同。
- `docs/diagrams/README.md` 並不存在 —— 它只是 `check_repo_contract.py:164` 的 Violation
  錨點路徑，沒有真正的 manifest 文件要改。
- README 的 Live demo badge 原先指向 `durable-queue.loijilai.site`（ALB 的網域，現在沒有
  A record，且每次 `terraform destroy` 後都會死），改指前端 `app.loijilai.site`。
- Architecture 的第二張圖用 `frontend/public/evidence/backlog-inflight.png`（實測 dashboard，
  非示意圖），並在正文直接寫明 11 記下的可讀性缺陷：Worker Count 與 Backlog 共用左軸。

**留在外面的事**（不屬於這張票）

- dashboard widget 的軸線修正（Worker Count 移到右軸），需重跑一次 burst。
- submission-time 的影片長度准入（spec 的 User Story 4）。現況是 `jobs/transcribers.py:244`
  的 Worker 端執行期失敗，因此**沒有**寫進 README 的 Functional requirements。
