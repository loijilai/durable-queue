Status: done

# 10 — Burst 產生器

**What to build:** 一支腳本，扮演需求文件裡的 Batch Submitter：取得憑證後，以固定
併發在短時間內送出約數百份 Job，並輸出每一份的提交時間戳。

**刻意做成最小腳本，不是壓測框架。** 受測的不是 API 每秒能吃多少請求，是佇列的吸收
能力與其後的容量反應。引入壓測工具會讓這件事看起來像是在測 API 吞吐，那是錯的敘事。

命名應與需求文件中的 Batch Submitter 角色一致，讓實驗工具與需求文件裡的角色對得上。

（repo 中存有此腳本先前版本的編譯殘留，原始檔已不存在，需重建。不要試圖從殘留還原。）

先對本機 stack 開發與驗證，不需要雲端環境。

**Blocked by:** 03

- [x] 可對指定端點以固定併發送出指定數量的 Job——`scripts/batch_submitter.py`，
      `--api-url`/`--count`/`--concurrency`，`ThreadPoolExecutor(max_workers=concurrency)`
- [x] 輸出每一份 Job 的提交時間戳，供事後與容量變化對照——每筆結果記錄
      `submitted_at`（送出請求前的當下，而非 Acceptance；Job 的 created_at 已由
      伺服器端記錄，這裡要的是提交本身的時間軸，不與之重複）
- [x] 未引入壓測框架——只用 `requests` + 標準庫 `concurrent.futures`
- [x] 命名與需求文件中的 Batch Submitter 角色一致——檔名 `batch_submitter.py`，
      CLI 說明文字亦稱其為 Batch Submitter
- [x] 可對本機 stack 執行，不需雲端憑證——已針對本機 `docker compose` stack 實測：
      註冊使用者、取得 JWT、送出 30 份 Job，全數 accepted 且落地資料庫
- [x] `./scripts/verify.sh full` 通過
