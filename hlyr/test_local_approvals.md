# 測試本地 MCP 核准

本指南說明如何在不需要 HumanLayer API 存取權限的情況下測試本地 MCP 核准系統。

## 概述

`hack/test-local-approvals.ts` 指令稿提供完整的測試工具，用於驗證 MCP 伺服器、守護程式和核准流程在僅使用本地核准時是否正常運作。

## 先決條件

1. 建置 hlyr 和守護程式：

   ```bash
   npm run build
   ```

2. 以除錯記錄模式啟動守護程式：

   ```bash
   ./dist/bin/hld -debug
   ```

3. 已安裝 Bun（用於直接執行 TypeScript）

## 執行測試

### 自動化測試模式

啟動 Claude 工作階段，觸發檔案寫入核准，並在 2 秒後自動核准：

```bash
bun hack/test-local-approvals.ts --test
```

此模式適用於：

- CI/CD 管線
- 快速驗證系統是否正常運作
- 除錯核准流程

### 互動式模式（預設）

啟動 Claude 工作階段，使用會觸發核准的查詢，然後監控事件：

```bash
# Default query (writes to blah.txt with random content)
bun hack/test-local-approvals.ts

# Custom query
bun hack/test-local-approvals.ts -q "Help me analyze this codebase"

# Query that won't trigger approvals
bun hack/test-local-approvals.ts -q "Hello, how are you?"
```

在互動式模式下執行時：

- 核准請求將在主控台中突出顯示
- 使用 CodeLayer UI 核准/拒絕
- 按 Ctrl+C 停止監控

## 測試的功能

1. **透過 Unix socket 連接到守護程式**
2. **啟動 Claude 工作階段**，並啟用 MCP 核准
3. **監控 MCP 記錄**，即時於 `~/.humanlayer/logs/`
4. **訂閱守護程式事件**：
   - `new_approval` - 請求核准時
   - `approval_resolved` - 核准被核准/拒絕時
   - `session_status_changed` - 工作階段狀態變更時
5. **測試模式**：2 秒後自動核准
6. **互動式模式**：透過 TUI/WUI 等待手動核准

## 理解輸出

### 成功的自動化測試

```
[INFO] === Automated MCP Approval Test ===
[SUCCESS] Connected to daemon
[SUCCESS] Session launched: <session-id>
[SUCCESS] New approval event received!
[SUCCESS] ✓ Approval sent successfully
[SUCCESS] ✓ File "test-mcp-approval-XXX.txt" was created successfully
[SUCCESS] ✓ No errors in MCP logs
```

### 互動式模式事件

```
🔔 NEW APPROVAL REQUEST!
Approval ID: local-XXXX
Tool: Write
```

## 疑難排解

### "Failed to connect to daemon"（無法連接到守護程式）

- 確保守護程式正在執行：`./dist/bin/hld -debug`
- 檢查 socket 是否存在：`ls ~/.humanlayer/daemon.sock`

### "hlyr is not built"（hlyr 未建置）

- 從 hlyr 目錄執行 `npm run build`

### 未觸發核准

- 預設查詢包含隨機內容以確保唯一性
- 如果使用自訂查詢，請確保它請求一個動作（例如寫入檔案）

### 記錄中的 MCP 錯誤

- 檢查 `~/.humanlayer/logs/mcp-claude-approvals-*.log` 以獲取詳細資訊
- 確保您使用的是最新建置的版本

## 指令參考

```bash
Options:
  -t, --test         Run automated test
  -i, --interactive  Run in interactive mode (default)
  -q, --query        Custom query for the session
  -h, --help         Show help message
```
