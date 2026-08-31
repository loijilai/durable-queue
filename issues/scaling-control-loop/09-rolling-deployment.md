Status: open (rolling update + zero-downtime config done; real-push zero-downtime observation still pending — see checklist)

# 09 — CI/CD 改為滾動更新

**What to build:** 把部署流程的最後一步從虛擬機實例更換，換成容器服務的滾動更新。
這張票結束時，推送到主線會走完測試、建置映像、套用基礎設施、執行遷移 task、滾動更新
服務，全程零停機。

**這是等價替換，範圍不得擴大。** 藍綠部署、金絲雀、部署編排服務刻意不隨之引入 ——
它們沒有任何需求需要回答，而引入它們會稀釋這個 feature 的敘事焦點。零停機由宣告式的
最低健康百分比設定達成，而不是由一段手寫的流程達成。

遷移的一次性 task（06 建立）插在基礎設施套用之後、服務更新之前。

**Blocked by:** 06

- [x] 部署最後一步為服務的滾動更新，並等待服務穩定後才視為成功——`aws ecs
      update-service --force-new-deployment` 後接 `aws ecs wait
      services-stable`，新任務跑不起來時這步會逾時失敗
- [x] 最低健康百分比設定使更新過程中服務不中斷——`aws_ecs_service.api` /
      `aws_ecs_service.worker` 宣告 `deployment_minimum_healthy_percent = 100`、
      `deployment_maximum_percent = 200`
- [x] 遷移 task 在基礎設施套用之後、服務更新之前執行（06 已建立此順序，本票未變動）
- [x] 實例更換相關的流程與設定自 CI/CD 中移除——06 已刪除 ASG / launch template /
      開機腳本，本票確認 CI/CD、`deploy.sh` 中不存在殘留引用
- [x] 未引入藍綠部署、金絲雀或部署編排服務——零停機完全由上述宣告式設定達成
- [ ] 一次實際推送可觀察到零停機——需在合併後對 master 實際推送一次觀察，非本次
      實作階段可驗證，留給部署後人工確認
