# humanlayer-wui

使用 Tauri 和 React 建構的 HumanLayer daemon (`hld`) Web/桌面 UI。

## 開發

### 在開發模式下執行

1. 建置 daemon（自動啟動所需）：

   ```bash
   make daemon-dev-build
   ```

2. 在開發模式下啟動 CodeLayer：
   ```bash
   make codelayer-dev
   ```

當應用程式啟動時，daemon 會自動且不可見地啟動。無需手動管理 daemon。

### 停用自動啟動（進階使用者）

如果您偏好手動管理 daemon：

```bash
export HUMANLAYER_WUI_AUTOLAUNCH_DAEMON=false
make codelayer-dev
```

### 使用外部 Daemon

要連接到在特定埠上執行的 daemon：

```bash
export HUMANLAYER_DAEMON_HTTP_PORT=7777
make codelayer-dev
```

### 建置正式版本

要建置帶有內建 daemon 的 CodeLayer：

```bash
make codelayer-bundle
```

這將會：

1. 為 macOS ARM64 建置 daemon
2. 為 macOS ARM64 建置 humanlayer CLI
3. 將兩者複製到 Tauri 資源
4. 使用內建的二進位檔建置 CodeLayer

產生的 DMG 將包含兩個二進位檔並自動管理它們的生命週期。

### Daemon 管理

daemon 生命週期完全自動化：

**在開發模式下：**

- 當 CodeLayer 啟動時，daemon 會不可見地啟動
- 每個 git 分支都有自己的 daemon 實例
- 資料庫從 `daemon-dev.db` 複製到 `daemon-{branch}.db`
- Socket 和埠按分支隔離
- 如有需要，可使用除錯面板（左下角設定圖示）進行手動控制

**在正式模式下：**

- 當 CodeLayer 啟動時，daemon 會不可見地啟動
- 使用預設路徑（`~/.humanlayer/daemon.db`）
- 當應用程式退出時自動停止
- 不需要使用者互動或感知

**錯誤處理：**

- 如果 daemon 啟動失敗，應用程式會正常繼續
- 稍後可以透過除錯面板（開發）或自動重試建立連接
- 所有錯誤都會記錄，但絕不會中斷使用者體驗

### MCP 測試

要測試 MCP 功能：

**在開發中：**

- 確保您已全域安裝 `humanlayer`：`npm install -g humanlayer`
- 啟動 CodeLayer：`make codelayer-dev`
- 設定 Claude Code 使用 `humanlayer mcp claude_approvals`
- MCP 伺服器將連接到您正在執行的 daemon

**在正式環境中（Homebrew 安裝後）：**

- Claude Code 可以直接執行 `humanlayer mcp claude_approvals`
- 不需要 npm 或 npx - Homebrew 會自動在 PATH 中建立符號連結
- MCP 伺服器連接到 CodeLayer 啟動的 daemon
- 驗證 PATH 設定是否正常運作：`which humanlayer` 應顯示 `/usr/local/bin/humanlayer`

**疑難排解 MCP 連接：**

- 如果 MCP 找不到 `humanlayer`，請在安裝後重新啟動 Claude Code
- 如果從 Dock 啟動，Claude Code 可能有受限的 PATH - 改從 Terminal 啟動
- 檢查 daemon 是否正在執行：`ps aux | grep hld`
- 檢查 Claude Code 中的 MCP 日誌以查看連接錯誤

## 前端開發快速入門

始終使用 React hooks，絕不直接使用 daemon 客戶端：

```tsx
import { useApprovals } from '@/hooks'

function MyComponent() {
  const { approvals, loading, error, approve } = useApprovals()
  // ... 渲染 UI
}
```

## 文件

- [架構概覽](docs/ARCHITECTURE.md) - 系統設計和資料流
- [開發者指南](docs/DEVELOPER_GUIDE.md) - 最佳實踐和範例
- [API 參考](docs/API.md) - Hook 和型別文件

## 狀態

⚠️ 實驗性 - API 可能會變更
