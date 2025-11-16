# HLD 測試指南

## 資料庫隔離

所有測試必須使用隔離的資料庫以防止使用者資料損壞。

### 整合測試的必要設定

每個啟動守護程序的整合測試都必須設定資料庫隔離：

```go
// 選項 1：記憶體內資料庫（最快，無持久化）
t.Setenv("HUMANLAYER_DATABASE_PATH", ":memory:")

// 選項 2：testutil 輔助函式（允許持久化測試）
_ = testutil.DatabasePath(t, "descriptive-name")

// 選項 3：手動暫存檔案（用於特殊情況）
dbPath := filepath.Join(t.TempDir(), "test.db")
t.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
```

### 絕對不要這樣做

```go
// 錯誤：沒有設定資料庫路徑 - 使用正式環境！
t.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
// 缺少：t.Setenv("HUMANLAYER_DATABASE_PATH", ...)
```

## 執行整合測試

```bash
# 執行所有整合測試
cd hld && go test -tags=integration ./...

# 執行特定整合測試
cd hld && go test -tags=integration ./daemon/daemon_integration_test.go -v
```

---

# 測試 HumanLayer Daemon + TUI 整合

本指南涵蓋第 4 階段整合的測試，其中 TUI 與守護程序通訊，而不是直接與 HumanLayer API 通訊。

## 前置條件

1. 建置 hlyr 套件（包含守護程序和 TUI 執行檔）：

   ```bash
   cd hlyr
   npm run build
   ```

2. 確保您已設定 HumanLayer API 金鑰：
   ```bash
   export HUMANLAYER_API_KEY=your-api-key
   # 或使用：npx humanlayer login
   ```

## 測試流程

### 1. 啟動守護程序

守護程序管理所有 HumanLayer API 通訊和 Claude Code session：

```bash
# 選項 1：直接執行守護程序（如果已建置）
hld

# 選項 2：TUI 會在需要時自動啟動守護程序
npx humanlayer tui
```

守護程序會：

- 監聽 `~/.humanlayer/daemon.sock`
- 從環境/配置載入 API 配置
- 開始輪詢核准請求

### 2. 啟動 Claude Code Session

透過守護程序啟動新的 Claude Code session：

```bash
# 基本用法（預設啟用核准）
npx humanlayer launch "Write a function to calculate fibonacci numbers"

# 使用選項
npx humanlayer launch "Build a web scraper" --model opus --max-turns 20

# 停用核准（一般不建議）
npx humanlayer launch "Simple task" --no-approvals
```

此指令會：

- 連接到守護程序
- 使用唯一的 `run_id` 建立新的 Claude Code session
- 配置 MCP 核准伺服器
- 回傳 session ID 和 run ID

### 3. 使用 TUI 監控核准

開啟 TUI 以查看和管理核准請求：

```bash
npx humanlayer tui
```

TUI 會：

- 連接到守護程序（如需要會自動啟動）
- 顯示所有待處理的核准
- 顯示每個核准所屬的 session（透過 run_id）
- 允許您核准/拒絕函式呼叫
- 允許您回應人工聯絡請求

## 測試場景

### 基本核准流程

1. 啟動會觸發核准的 session：

   ```bash
   npx humanlayer launch "Create a new Python file with a hello world function"
   ```

2. 開啟 TUI 並等待核准請求
3. 核准檔案寫入操作
4. 驗證 Claude 完成任務

### 多個並行 Session

1. 啟動多個 session：

   ```bash
   npx humanlayer launch "Task 1: Write a README"
   npx humanlayer launch "Task 2: Create a test file"
   ```

2. 開啟 TUI 查看兩個 session 的核准
3. 驗證您可以獨立管理核准

### 守護程序重啟彈性

1. 啟動一個 session
2. 停止守護程序（Ctrl+C）
3. 重啟守護程序
4. 開啟 TUI - 待處理的核准應該仍然出現

## 使用 JSON-RPC 進行手動測試

您也可以直接使用 JSON-RPC 測試守護程序：

```bash
# 健康檢查
echo '{"jsonrpc":"2.0","method":"health","id":1}' | nc -U ~/.humanlayer/daemon.sock

# 列出 session
echo '{"jsonrpc":"2.0","method":"listSessions","id":1}' | nc -U ~/.humanlayer/daemon.sock

# 使用 MCP 配置啟動 session
echo '{
  "jsonrpc":"2.0",
  "method":"launchSession",
  "params":{
    "query":"test query",
    "mcp_config":{
      "mcpServers":{
        "approvals":{
          "command":"npx",
          "args":["humanlayer","mcp","claude_approvals"]
        }
      }
    }
  },
  "id":1
}' | nc -U ~/.humanlayer/daemon.sock

# 取得核准
echo '{"jsonrpc":"2.0","method":"fetchApprovals","params":{},"id":1}' | nc -U ~/.humanlayer/daemon.sock
```

## 除錯技巧

### 啟用除錯日誌

```bash
# 使用除錯日誌執行守護程序
hld -debug

# 或使用環境變數
HUMANLAYER_DEBUG=true hld
```

除錯模式會顯示：

- MCP 伺服器配置詳細資訊
- 輪詢嘗試和結果
- API 請求/回應詳細資訊
- Session 生命週期事件

### 檢查守護程序日誌

守護程序會輸出到 stdout，顯示：

- 帶有 run_id 的 session 啟動
- 輪詢活動（每 5 秒）
- 核准關聯
- API 通訊錯誤

### 驗證 Socket 連接

```bash
# 檢查 socket 是否存在
ls -la ~/.humanlayer/daemon.sock

# 檢查守護程序是否正在監聽
lsof -U | grep daemon.sock
```

### 環境變數

- `HUMANLAYER_DAEMON_SOCKET`：覆寫預設 socket 路徑
- `HUMANLAYER_API_KEY`：守護程序運作所需
- `HUMANLAYER_API_BASE_URL`：覆寫 API 基礎 URL（預設：https://api.humanlayer.dev/humanlayer/v1）
- `HUMANLAYER_RUN_ID`：守護程序為 MCP 伺服器自動設定
- `HUMANLAYER_DEBUG`：啟用除錯日誌（設定為 "true"）

## 成功標準

- [ ] 守護程序啟動並建立 socket
- [ ] `npx humanlayer launch` 建立 Claude session
- [ ] 核准出現在守護程序日誌中
- [ ] TUI 連接到守護程序（而非直接連接 API）
- [ ] TUI 顯示帶有 session 上下文的待處理核准
- [ ] 透過守護程序進行核准/拒絕操作
- [ ] 多個並行 session 正常運作
- [ ] 從 TUI 自動啟動守護程序正常運作

## 常見問題

### 沒有顯示核准

1. 使用除錯日誌檢查守護程序是否執行
2. 驗證 API 金鑰已設定：`echo $HUMANLAYER_API_KEY`
3. 在守護程序日誌中尋找 "approval poller started"
4. 每 5 秒檢查 "fetched function calls" 訊息
5. 驗證 session 中已設定 MCP 伺服器（尋找 "configured MCP server" 日誌）
6. 確保 Claude session 確實進行了需要核准的工具呼叫

### API 連接問題

- 檢查 API 基礎 URL 是否正確
- 驗證 API 金鑰是否有效
- 在守護程序日誌中尋找 HTTP 錯誤碼
- 嘗試手動 API 測試：`curl -H "Authorization: Bearer $HUMANLAYER_API_KEY" https://api.humanlayer.dev/humanlayer/v1/function_calls`
