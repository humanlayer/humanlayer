---
description: 透過調查日誌、資料庫狀態和 git 歷史來除錯問題
---

# Debug

您的任務是協助在手動測試或實作期間除錯問題。此指令允許您透過檢查日誌、資料庫狀態和 git 歷史來調查問題，而無需編輯檔案。將此視為在不使用主視窗脈絡的情況下啟動除錯會話的方法。

## 初始回應

當使用計畫/票證檔案調用時：
```
我將協助除錯 [file name] 的問題。讓我了解當前狀態。

您遇到什麼具體問題？
- 您試圖測試/實作什麼？
- 出了什麼問題？
- 有任何錯誤訊息嗎？

我將調查日誌、資料庫和 git 狀態以協助找出發生了什麼。
```

當不帶參數調用時：
```
我將協助除錯您當前的問題。

請描述出了什麼問題：
- 您正在處理什麼？
- 發生了什麼具體問題？
- 上次何時正常運作？

我可以調查日誌、資料庫狀態和最近的變更以協助識別問題。
```

## 環境資訊

您可以存取這些關鍵位置和工具：

**日誌**（由 `make daemon` 和 `make wui` 自動建立）：
- MCP 日誌：`~/.humanlayer/logs/mcp-claude-approvals-*.log`
- 合併的 WUI/Daemon 日誌：`~/.humanlayer/logs/wui-${BRANCH_NAME}/codelayer.log`
- 第一行顯示：`[timestamp] starting [service] in [directory]`

**資料庫**：
- 位置：`~/.humanlayer/daemon-{BRANCH_NAME}.db`
- 包含 sessions、events、approvals 等的 SQLite 資料庫
- 可以直接使用 `sqlite3` 查詢

**Git 狀態**：
- 檢查當前分支、最近的 commit、未提交的變更
- 類似於 `commit` 和 `describe_pr` 指令的運作方式

**服務狀態**：
- 檢查 daemon 是否正在執行：`ps aux | grep hld`
- 檢查 WUI 是否正在執行：`ps aux | grep wui`
- Socket 是否存在：`~/.humanlayer/daemon.sock`

## 流程步驟

### 步驟 1：理解問題

在使用者描述問題後：

1. **讀取任何提供的脈絡**（計畫或票證檔案）：
   - 了解他們正在實作/測試什麼
   - 注意他們在哪個階段或步驟
   - 識別預期與實際行為

2. **快速狀態檢查**：
   - 當前 git 分支和最近的 commit
   - 任何未提交的變更
   - 問題何時開始發生

### 步驟 2：調查問題

產生並行的 Task 代理以進行高效調查：

```
Task 1 - 檢查最近的日誌：
尋找並分析最近的日誌以查找錯誤：
1. 尋找最新的 daemon 日誌：ls -t ~/.humanlayer/logs/daemon-*.log | head -1
2. 尋找最新的 WUI 日誌：ls -t ~/.humanlayer/logs/wui-*.log | head -1
3. 在問題時間範圍內搜尋錯誤、警告或問題
4. 注意工作目錄（日誌的第一行）
5. 尋找堆疊追蹤或重複錯誤
返回：帶時間戳記的關鍵錯誤/警告
```

```
Task 2 - 資料庫狀態：
檢查當前資料庫狀態：
1. 連接到資料庫：sqlite3 ~/.humanlayer/daemon.db
2. 檢查架構：.tables 和 .schema 以查看相關表格
3. 查詢最近的資料：
   - SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;
   - SELECT * FROM conversation_events WHERE created_at > datetime('now', '-1 hour');
   - 基於問題的其他查詢
4. 尋找卡住的狀態或異常
返回：相關的資料庫發現
```

```
Task 3 - Git 和檔案狀態：
了解最近的變更：
1. 檢查 git 狀態和當前分支
2. 查看最近的 commit：git log --oneline -10
3. 檢查未提交的變更：git diff
4. 驗證預期的檔案是否存在
5. 尋找任何檔案權限問題
返回：Git 狀態和任何檔案問題
```

### 步驟 3：呈現發現

根據調查，呈現一份專注的除錯報告：

```markdown
## 除錯報告

### 問題所在
[基於證據的清晰問題陳述]

### 發現的證據

**來自日誌**（`~/.humanlayer/logs/`）：
- [帶時間戳記的錯誤/警告]
- [模式或重複問題]

**來自資料庫**：
```sql
-- 相關查詢和結果
[來自資料庫的發現]
```

**來自 Git/檔案**：
- [可能相關的最近變更]
- [檔案狀態問題]

### 根本原因
[基於證據的最可能解釋]

### 後續步驟

1. **首先嘗試此操作**：
   ```bash
   [具體指令或動作]
   ```

2. **如果無效**：
   - 重啟服務：`make daemon` 和 `make wui`
   - 檢查 WUI 錯誤的瀏覽器控制台
   - 使用除錯模式執行：`HUMANLAYER_DEBUG=true make daemon`

### 無法存取？
某些問題可能超出我的能力範圍：
- 瀏覽器控制台錯誤（在瀏覽器中按 F12）
- MCP 伺服器內部狀態
- 系統層級問題

您希望我進一步調查特定事項嗎？
```

## 重要注意事項

- **專注於手動測試場景** - 這是用於實作期間的除錯
- **務必要求問題描述** - 沒有知道問題所在就無法除錯
- **完整讀取檔案** - 讀取脈絡時不使用 limit/offset
- **像 `commit` 或 `describe_pr` 一樣思考** - 了解 git 狀態和變更
- **引導回使用者** - 某些問題（瀏覽器控制台、MCP 內部）超出能力範圍
- **不編輯檔案** - 僅進行調查

## 快速參考

**尋找最新日誌**：
```bash
ls -t ~/.humanlayer/logs/daemon-*.log | head -1
ls -t ~/.humanlayer/logs/wui-*.log | head -1
```

**資料庫查詢**：
```bash
sqlite3 ~/.humanlayer/daemon.db ".tables"
sqlite3 ~/.humanlayer/daemon.db ".schema sessions"
sqlite3 ~/.humanlayer/daemon.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

**服務檢查**：
```bash
ps aux | grep hld     # daemon 是否正在執行？
ps aux | grep wui     # WUI 是否正在執行？
```

**Git 狀態**：
```bash
git status
git log --oneline -10
git diff
```

記住：此指令協助您在不耗用主視窗脈絡的情況下進行調查。當您在手動測試期間遇到問題並需要深入研究日誌、資料庫或 git 狀態時非常適合。
