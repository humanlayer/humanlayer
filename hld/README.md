# HumanLayer Daemon (hld)

## 概述

HumanLayer Daemon (hld) 提供 REST API 和 JSON-RPC 介面，用於管理 Claude Code session、核准和即時事件串流。

## 配置

守護程序支援以下環境變數：

- `HUMANLAYER_DAEMON_HTTP_PORT`：HTTP 伺服器連接埠（預設：7777，設為 0 以停用）
- `HUMANLAYER_DAEMON_HTTP_HOST`：HTTP 伺服器主機（預設：127.0.0.1）

### 停用 HTTP 伺服器

若要停用 HTTP 伺服器（例如，如果您只想使用 Unix socket）：

```bash
export HUMANLAYER_DAEMON_HTTP_PORT=0
hld start
```

## 端對端測試

HLD 包含針對 REST API 的完整 e2e 測試：

```bash
# 執行所有 e2e 測試
make e2e-test

# 使用詳細輸出執行以進行除錯
make e2e-test-verbose

# 使用手動核准互動執行
make e2e-test-manual

# 保留測試產物以進行除錯
KEEP_TEST_ARTIFACTS=true make e2e-test
```

e2e 測試套件：
- 測試所有 16 個 REST API 端點
- 驗證 SSE 事件串流
- 執行核准工作流程（拒絕 → 重試 → 核准）
- 測試 session 生命週期操作
- 驗證錯誤處理
- 在隔離環境中執行，使用自己的守護程序實例

### 測試結構

e2e 測試位於 `hld/e2e/`，包含：
- `test-rest-api.ts` - 主要測試腳本，包含 6 個測試階段
- `test-utils.ts` - 測試環境設定和斷言的工具程式
- `package.json` - 測試相依性

### 已知問題

在 e2e 測試開發期間，我們發現了一些潛在的上游錯誤：
1. list sessions API 預設為 `leafOnly`，會過濾掉父 session
2. 錯誤處理對不存在的 session 回傳 500 而不是 404
3. 無效請求的錯誤處理可能沒有回傳正確的 400 錯誤

這些問題在測試程式碼中以 TODO 註解記錄。
