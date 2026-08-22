Status: open

# 06 — API 跑上 Fargate

**What to build:** 把 API 也移到容器編排上，並刪除舊的運算層。這張票結束時，公開端點
完全由 Fargate 提供服務，而 Auto Scaling Group、launch template、機器開機腳本與
ElastiCache 都不再存在於基礎設施程式碼中。

**理由與 Worker 不同，值得分開陳述**：Worker 遷移是為了讓容量決策有一根粒度正確的
控制桿；API 遷移純粹是簡化 —— 它目前的部署方式是開一台虛擬機、對它跑一段 shell 腳本，
而 task definition 是同一件事的宣告式版本。不要從這兩張票推論出一個從來不是論據的
對稱性。

API 的容量固定，**不設 scaling policy**：沒有任何量測指出需要它，而「沒有證據就加
機制」正是這個專案試圖避免的習慣。

資料庫遷移從 API 的啟動指令中抽出，成為一次性的 task。這修正的是一個既有的競爭條件
（數個實例可能同時執行遷移），而滾動部署只會讓它更容易發生。

兩個角色繼續共用同一份映像，只有啟動指令不同 —— 這與現行兩個 launch template 只有
啟動指令不同的結構完全對應，是同一個設計換一層抽象重新表達。

**Blocked by:** 05

- [ ] 公開端點由容器編排上的 service 提供，容量固定
- [ ] 資料庫遷移為獨立的一次性 task，不在任何服務的啟動指令中
- [ ] API 與 Worker 共用同一份映像，僅啟動指令不同
- [ ] Auto Scaling Group、launch template、機器開機腳本自基礎設施程式碼中刪除
- [ ] `check_env_parity.py` 裡對應舊機器開機腳本的死程式碼一併移除（`DOCKER_ENV_RE`、
      指向 `user_data.sh.tftpl` 的 `USER_DATA_SOURCE` 等，連同引用它們的既有測試）——
      05 已把檢查換指向新的設定宣告來源，這些留在原地就是死碼
- [ ] ElastiCache 自基礎設施程式碼中刪除
- [ ] API service 沒有 scaling policy
- [ ] 端到端可用：登入、送出 Job、查詢狀態、重試皆正常
- [ ] `./scripts/verify.sh full` 通過
