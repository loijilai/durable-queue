Status: open

# 03 — HA 頁改說現行機制，並標註錄影的年代

**What to build:** 讓 HA 頁描述現在實際提供高可用性的機制，同時誠實交代兩支錄影拍的是
哪一版部署。

這頁不是換名詞而已，機制真的變了。舊的是 ASG instance refresh 配 50% minimum healthy：
兩個裡先抽掉一個。現在的 ECS service 是 `deployment_minimum_healthy_percent = 100`、
`deployment_maximum_percent = 200`：新 task 必須先通過 health check，舊 task 才下線，健康
容量從不掉到一半。新機制比舊的強，值得寫出來 —— failed requests 一樣是 0，但過程中容量
沒有缺口。

兩支錄影拍的是 EC2/ASG console，不重錄。這頁的賣點就是「對真實 AWS 錄的」，所以寧可承認
錄影比程式碼舊，也不能讓文字退回去配合錄影 —— 那等於讓頁面對現行 infra 說謊。錄影旁邊
加一句來源聲明，說明它示範的是同一個設計的前一版實作。

這句話要有自己的位置，不要併進 `RecordingSlot` 現有的 description 欄位：description 說的
是「這支影片在演什麼」，來源聲明說的是「這份證據有多舊」，是不同性質的資訊，視覺層級也
該不同。做成 optional，讓 Scalability 頁那支（錄的就是 SQS + ECS 上的驗收實驗）完全不受
影響。

除了 graceful 那段的 minimum healthy 之外，其餘要改的事實：ungraceful 那段的
`ASG self-healing` 改成 ECS service scheduler 補回 desired count；對照表的 trigger 從
`EC2 terminate` 改成 StopTask、從 instance refresh 改成滾動更新。ALB health check 的
`interval 10s × unhealthy threshold 2` ≈ 20s 偵測窗口沒有變，不要動。

標題 `Surviving Instance Loss` 改為 `Surviving Task Loss`：ECS 之後沒有 instance 了，而
CONTEXT.md 對詞彙一向嚴格。首頁 route card 04 鏡射的是同一句，一起改。

**Blocked by:** 01 — 這頁的 lightbox 開的就是 01 那張架構圖。文字先改完會變成 ECS 的敘述
配一張 EC2 的圖，這張票就不是自己可驗收的。

- [ ] `RecordingSlot` 有一個 optional 的來源聲明欄位，未傳入時不渲染任何東西
- [ ] 兩支 HA 錄影標註它們拍的是同一設計在 EC2/ASG 上的前一版部署；Scalability 頁那支
      沒有變化
- [ ] graceful 那段描述的是 100% minimum healthy 的滾動更新，不再宣稱 50%
- [ ] ungraceful 那段與對照表描述的是 ECS service scheduler 與 StopTask
- [ ] ALB 偵測窗口的數字未被更動
- [ ] h1 與首頁 route card 04 同步改為 `Surviving Task Loss`
- [ ] 全頁搜尋不到 EC2、ASG、instance refresh
- [ ] `./scripts/verify.sh full` 通過
