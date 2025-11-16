# 開發指南

本指南涵蓋 HumanLayer 儲存庫的開發工作流程和工具。

## 平行開發環境

> **為什麼需要平行環境？** 在開發 daemon (hld) 或 WUI 功能時，重啟 daemon 會中斷正在執行的 Claude 會話。此功能讓您能夠維護一個穩定的「nightly」環境進行日常工作，同時在隔離的「dev」環境中測試變更。

### 運作方式

```
┌─────────────────────┐     ┌─────────────────────┐
│   Nightly (Stable)  │     │   Dev (Testing)     │
├─────────────────────┤     ├─────────────────────┤
│ daemon.sock         │     │ daemon-dev.sock     │
│ daemon.db           │     │ daemon-{timestamp}.db│
│ Production WUI      │     │ Dev WUI             │
└─────────────────────┘     └─────────────────────┘
         │                           │
         └──── 您的工作 ────────────┘
```

開發設定提供環境之間的完全隔離，讓您能夠：
- 在「nightly」環境中保持 Claude 會話執行，同時在「dev」環境中開發
- 無懼地測試破壞性變更
- 維護不同的資料庫狀態用於測試

### 快速開始

```bash
# 啟動 nightly（穩定）環境
make daemon-nightly
make wui-nightly

# 啟動 dev 環境（在另一個終端）
make daemon-dev
make wui-dev

# 使用特定 daemon 啟動 Claude Code
npx humanlayer launch "implement feature X" --daemon-socket ~/.humanlayer/daemon-dev.sock
```

### 環境概覽

| 元件 | Nightly（穩定） | Dev（測試） |
|-----------|------------------|---------------|
| Daemon 二進位檔 | `hld/hld-nightly` | `hld/hld-dev` |
| Socket 路徑 | `~/.humanlayer/daemon.sock` | `~/.humanlayer/daemon-dev.sock` |
| 資料庫 | `~/.humanlayer/daemon.db` | `~/.humanlayer/dev/daemon-TIMESTAMP.db` |
| Daemon 日誌 | `daemon-nightly-*.log` | `daemon-dev-*.log` |
| WUI 日誌 | 依平台而定 | `~/.humanlayer/logs/wui-{branch}/codelayer.log` |
| WUI | 安裝於 `~/Applications` | 在開發模式下執行 |

### 可用指令

#### Nightly（穩定）環境
```bash
make daemon-nightly-build  # 建置 nightly daemon 二進位檔
make daemon-nightly        # 建置並執行 nightly daemon
make wui-nightly-build     # 建置 nightly WUI
make wui-nightly          # 建置、安裝並開啟 nightly WUI
```

#### Dev 環境
```bash
make daemon-dev-build     # 建置 dev daemon 二進位檔
make daemon-dev          # 建置並執行 dev daemon，使用新的資料庫副本
make daemon              # make daemon-dev 的別名
make wui-dev            # 在開發模式下執行 WUI，連接到 dev daemon
make wui                # make wui-dev 的別名
make copy-db-to-dev     # 手動複製生產資料庫到帶時間戳記的 dev 資料庫
make cleanup-dev        # 清理超過 10 天的 dev 資料庫和日誌
```

#### 狀態與工具程式
```bash
make dev-status         # 顯示目前 dev 環境狀態
```

### Claude Code 整合

由 Claude Code 會話啟動的 MCP 伺服器會自動連接到正確的 daemon 實例。daemon 會將 `HUMANLAYER_DAEMON_SOCKET` 環境變數傳遞給 MCP 伺服器，確保它們連接到啟動它們的同一個 daemon。

`npx humanlayer launch` 指令支援透過多種方法使用自訂 daemon socket：

#### 1. 命令列旗標
```bash
npx humanlayer launch "test my implementation" --daemon-socket ~/.humanlayer/daemon-dev.sock
```

#### 2. 環境變數
```bash
HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-dev.sock npx humanlayer launch "test feature"
```

#### 3. 配置檔案
在您的 `humanlayer.json` 中新增：
```json
{
  "daemon_socket": "~/.humanlayer/daemon-dev.sock"
}
```

### 典型開發工作流程

1. **早晨設定 - 啟動您的穩定環境**：
   ```bash
   make daemon-nightly  # 在背景執行
   make wui-nightly     # 開啟已安裝的 WUI
   ```
   這是您進行日常 Claude 工作的「生產」環境。

2. **開發時間 - 開發 daemon/WUI 功能**：
   ```bash
   git checkout -b feature/my-feature
   # 對 hld/ 或 humanlayer-wui/ 進行變更
   ```

3. **測試 - 使用 dev 環境而不干擾您的工作**：
   ```bash
   # 終端 1：啟動 dev daemon（自動複製目前的資料庫）
   make daemon-dev

   # 終端 2：使用 dev daemon 測試 Claude Code
   npx humanlayer launch "test my feature" --daemon-socket ~/.humanlayer/daemon-dev.sock

   # 或使用 dev WUI 測試
   make wui-dev
   ```
   您的 nightly Claude 會話保持不受影響！

4. **維護 - 清理舊的 dev 產物**（每週）：
   ```bash
   make cleanup-dev  # 移除超過 10 天的資料庫和日誌
   ```

### 主要優勢

- **零干擾**：在 nightly 環境中繼續工作的同時在 dev 環境中測試
- **全新狀態**：每次 `make daemon-dev` 都會使用乾淨的資料庫副本開始
- **清楚分離**：不同的 socket 防止意外的交叉連接
- **易於識別**：Dev daemon 在 WUI 中顯示「dev」版本
- **自動清理**：使用一個指令即可清理舊的 dev 資料庫

### 環境變數

daemon 和 WUI 都遵循這些環境變數：

- `HUMANLAYER_DAEMON_SOCKET`：daemon socket 的路徑（預設：`~/.humanlayer/daemon.sock`）
  - 此變數會自動傳遞給由 Claude Code 會話啟動的 MCP 伺服器
- `HUMANLAYER_DATABASE_PATH`：SQLite 資料庫的路徑（僅限 daemon）
- `HUMANLAYER_DAEMON_VERSION_OVERRIDE`：自訂版本字串（僅限 daemon）

### 疑難排解

**問：兩個 daemon 都無法啟動**
檢查現有的程序：
```bash
ps aux | grep hld | grep -v grep
# 如需終止：kill <PID>
```

**問：WUI 顯示「connection failed」**
驗證 socket 路徑是否匹配：
```bash
ls -la ~/.humanlayer/*.sock
# 應該能看到 daemon.sock 和/或 daemon-dev.sock
```

**問：想使用特定的 dev 資料庫**
```bash
# 列出可用的 dev 資料庫
ls -la ~/.humanlayer/dev/
# 使用特定資料庫執行 daemon
HUMANLAYER_DATABASE_PATH=~/.humanlayer/dev/daemon-20240717-143022.db make daemon-dev
```

**問：如何知道我在哪個環境中？**
- 檢查 WUI 標題列：dev daemon 會顯示「dev」
- 檢查 daemon 日誌：`tail -f ~/.humanlayer/logs/daemon-*.log`
- 檢查 WUI 日誌：`tail -f ~/.humanlayer/logs/wui-*/codelayer.log`

## 其他開發指令

### 建置與測試

```bash
make setup              # 解決整個 monorepo 的相依性
make check-test        # 執行所有檢查和測試
make check             # 執行 linting 和型別檢查
make test              # 執行所有測試套件
```

### Python 開發
```bash
make check-py          # Python linting 和型別檢查
make test-py           # Python 測試
```

### TypeScript 開發
查看個別的 `package.json` 檔案以了解特定指令，因為不同專案使用的套件管理器和測試框架各有不同。

### Go 開發
查看 `go.mod` 以了解 Go 版本需求，並在每個 Go 專案目錄中尋找 `Makefile`。
