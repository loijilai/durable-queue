Status: done

# 05 — Security ② 的部署管線圖改說 ECS 的兩個角色

**What to build:** 讓 Security 頁第二節描述現在這條部署管線上，身分與機密實際怎麼流動。

圖上現在是一個 `EC2 / instance profile` 節點做完所有事，並以 `start-instance-refresh` 收尾。
ECS 之後這裡拆成兩個角色，而且它們的權限不同 —— 這正是這一節在講的事，所以要畫成兩個
節點，不要為了維持舊版面合成一個：

- execution role 是 ECS agent 用的：pull image，並在啟動時從 Secrets Manager 取出密文注入
  成環境變數。
- task role 是應用程式自己用的：對佇列的操作權限。

拆開之後圖上看得到一件這次遷移白撿的事：**應用程式的身分拿不到 Secrets Manager**，密文是
平台在啟動時注入的。合成一個節點就把這個論點藏起來了。版面代價值得付。

收尾的邊從 `start-instance-refresh` 改成 `update-service --force-new-deployment`。

維持五個步驟，不要加第六步。CI/CD 現在會在 update-service 之前先跑一次 migration task，但
它用的是同一組角色、同一份 image、同一個 commit SHA —— 在「身分與機密怎麼流動」這個維度上
沒有帶來新的信任邊界。這五個鏡頭的節奏是每一步換一個邊界，多一個不換邊界的步驟會打斷它。
migration 併進第五步的圖說即可。

機密分類表的判準要換掉。它現在的支點是「能不能出現在 user_data 裡」（只有 base64、沒有
加密），而 user_data 已經不存在。ECS 有現成的對應物，而且更硬：task definition 的
`environment` 是明文、`secrets` 是 ARN 參照、由 execution role 在啟動時去取。同一個論證
形狀，但這條界線從「你自己得記得別放錯地方」變成平台層強制的二分。三欄三列的結構不動。

五張鏡頭圖是從 master 頁衍生的，改 master 頁之後用既有的 build script 重出，不要手改衍生
出來的 SVG。

**Blocked by:** None — can start immediately.

- [x] master 頁以 execution role 與 task role 兩個節點取代 `EC2 / instance profile`，兩者
      的權限差異在圖上看得出來
- [x] 收尾的邊改說 `update-service --force-new-deployment`
- [x] 維持五個步驟；migration 在第五步的圖說中被交代
- [x] 五張鏡頭 SVG 由 build script 重新產生，未經手改
- [x] 機密分類表的判準改為 task definition 的 `environment` vs `secrets`，維持三欄三列
- [x] 全節搜尋不到 EC2、instance profile、instance refresh、user_data
- [x] `./scripts/verify.sh full` 通過
