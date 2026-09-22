Status: open

# 09 — HA 移到 Appendix，路線縮為五站

**What to build:** 面試時走的主路線只剩五站（Authentication、Distributed Queue、Durability、Scalability、Security）。HA 頁的 Worker Crash 情境與 Durability 頁重複，刪除；剩下的 API tier 內容與 Security 頁的 Pipeline Identity & Secret Management 一起移到一個不在主路線上的補充頁，只從頁尾進入，被問到時能直接跳到那一章。

**Blocked by:** None — can start immediately.

- [ ] 新增 `/appendix` 頁：eyebrow「APPENDIX」、標題「Beyond the Route」、無副標，兩章沿用原 HA 頁 chapter index 的樣式，各有可直接連結的錨點：
  - `01 API AVAILABILITY`：原 HA 頁 Scenario B 的全部內容（Zero Downtime Deploy 含即時 probe、API Crash、Draining vs Unhealthy 對照表、兩支錄影與其 provenance 註記），標題維持「Two Ways to Lose an API Task」，頁面上不再出現「Scenario」一詞。
  - `02 PIPELINE IDENTITY & SECRET MANAGEMENT`：原 Security 頁該區塊原封搬過來；第 5 步的 caption 補上 CI 以 `update-function-code` 讓 Worker Lambda 指向同一份 image。
- [ ] `/high-availability` route 與 HA 頁刪除，不做 redirect。Worker Crash 情境（demo job、polling、docker compose 操作說明）全部刪除；AuditTrail 元件保留（Queue 頁仍在用）。
- [ ] Security 頁只剩 Infra 與 App 兩區，編號 01、02，標題「Security Control」不變。
- [ ] nav 與頁尾的 THE ROUTE 欄移除 High Availability；首頁 route 區的 eyebrow 改為「FIVE SECTIONS, IN ORDER」，卡片重編為 01–05。
- [ ] 頁尾新增一欄「APPENDIX」，兩個連結分別直達兩章的錨點。Appendix 不出現在 nav 與首頁。
- [ ] 沒有任何頁面或元件再引用已刪除的 HA 頁；不再使用的樣式刪除。
- [ ] `./scripts/verify.sh full` 通過（含前端 lint 與 build），並在本機瀏覽器確認 Appendix 兩章、錨點連結、Security 頁與五站路線正常顯示。
