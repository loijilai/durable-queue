Status: done

# 04 — Security ① 的拓撲圖收斂成 VPC 內的 SG 邊界

**What to build:** 讓 Security 頁第一節那張拓撲圖（三個鏡頭共用）只講一件事，並且講對：
VPC 內部的 security group 設定。

圖上現在有 `SG-redis`、`ElastiCache Redis` 與兩條 `:6379`，那個節點已經不存在了。SQS 沒有
security group，也不在 VPC 裡 —— 所以它**不畫**。這一節的主題是 VPC 內的邊界，把一個沒有
SG 的東西放進一張講 SG 的圖，只會讓圖失焦。工作從哪裡來由首頁那張架構圖負責。

`api ×2 (ASG)` 與 `worker ×2 (ASG)` 改說 ECS service。NAT 旁邊的 `outbound only` 標註保留，
它已經足以交代「有東西會出去」。

圖說跟著收斂。SG lens 現在的最後一句是「worker 完全沒有 ingress，它是個 pull 工作的
client」—— 拿掉 SQS 之後圖上看不到它 pull 什麼了，這句話會把讀者的注意力推向一個圖上不
存在的東西。改成純 security group 的語言：worker 沒有任何 ingress rule，只出不進。同一段
還提到「instances can scale out or move AZ」，那個詞也要跟著現況走。

network lens 的圖說宣稱 admin plane 是 SSM Session Manager。infra 裡現在沒有任何 SSM 資源，
也沒有開啟 ECS Exec —— 現況其實比原文更強：根本沒有 admin plane。如實改寫，但**寫短**，
這不是這一節的重點，不要讓它膨脹成一段論證。

三張鏡頭圖是從 master 頁衍生的，改 master 頁之後用既有的 build script 重出，不要手改衍生
出來的 SVG。

**Blocked by:** None — can start immediately.

- [x] master 頁不再有 Redis 節點、其 security group 與 `:6379` 邊
- [x] 運算節點標示為 ECS service，不再是 ASG
- [x] 三張鏡頭 SVG 由 build script 重新產生，未經手改
- [x] SG lens 圖說收斂成純 security group 的語言，不再提工作來源、不再提 instance
- [x] network lens 關於 admin plane 的說法與 infra 現況一致，且維持一到兩句
- [ ] 三個鏡頭在瀏覽器中切換正常，圖與圖說對得上
      —— 三張 SVG 與 /security 皆由 dev server 正常供應，三張圖的內容也逐一看過、
      與圖說對得上；只有「用瀏覽器點過三個 tab」這一步沒做（此環境沒有可用的瀏覽器
      自動化）。鏡頭切換的程式碼本身這次沒有動到。
- [x] `./scripts/verify.sh full` 通過
