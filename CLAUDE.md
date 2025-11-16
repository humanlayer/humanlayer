# CLAUDE.md

本檔案為 Claude Code (claude.ai/code) 在此儲存庫中工作時提供指引。

## 儲存庫概覽

這是一個 monorepo，包含兩個不同但相互關聯的專案群組：

**專案 1：HumanLayer SDK 與平台** - 為 AI 代理提供人機協作能力的核心產品
**專案 2：本地工具套件** - 利用 HumanLayer SDK 提供豐富審批體驗的工具

## 專案 1：HumanLayer SDK 與平台

### 元件
- `humanlayer-ts/` - 用於 Node.js 和瀏覽器環境的 TypeScript SDK
- `humanlayer-go/` - 用於建構工具的最小 Go 客戶端
- `humanlayer-ts-vercel-ai-sdk/` - Vercel AI SDK 的專用整合
- `docs/` - Mintlify 文件網站

### 核心概念
- **聯絡管道**：用於人類互動的 Slack、Email、CLI 和網頁介面
- **多語言支援**：TypeScript 和 Go SDK 之間的功能對等

## 專案 2：本地工具套件

### 元件
- `hld/` - 協調審批並管理 Claude Code 會話的 Go daemon
- `hlyr/` - 具有 MCP（模型上下文協議）伺服器的 TypeScript CLI，用於 Claude 整合
- `humanlayer-wui/` - CodeLayer - 用於圖形化審批管理的桌面/網頁 UI（Tauri + React）
- `claudecode-go/` - 用於程式化啟動 Claude Code 會話的 Go SDK

### 架構流程
```
Claude Code → MCP Protocol → hlyr → JSON-RPC → hld → HumanLayer Cloud API
                                         ↑         ↑
                                    TUI ─┘         └─ WUI
```

## 開發指令

### 快速動作
- `make setup` - 解決整個 monorepo 的相依性和安裝問題
- `make check-test` - 執行所有檢查和測試
- `make check` - 執行 linting 和型別檢查
- `make test` - 執行所有測試套件

### GitHub 工作流程
- **觸發 macOS nightly 建置**：`gh workflow run "Build macOS Release Artifacts" --repo humanlayer/humanlayer`
- 工作流程定義位於 `.github/workflows/`


### TypeScript 開發
- 套件管理器不同 - 查看 `package.json` 以確認是 npm 或 bun
- 建置/測試指令不同 - 查看 `package.json` 的 scripts 區段
- 有些使用 Jest，其他使用 Vitest，查看 `package.json` 的 devDependencies

### Go 開發
- 查看 `go.mod` 以了解 Go 版本（在 1.21 和 1.24 之間變化）
- 檢查目錄是否有 `Makefile` 以了解可用指令
- 整合測試僅在某些專案中（尋找 `-tags=integration`）

## 技術指南

### TypeScript
- 現代 ES6+ 功能
- 嚴格的 TypeScript 配置
- 維護 CommonJS/ESM 相容性

### Go
- 標準 Go 慣用法
- Context 優先的 API 設計
- 需要時使用 `make mocks` 產生 mock

## 開發慣例

### TODO 註記

我們在整個程式碼庫中使用基於優先級的 TODO 註記系統：

- `TODO(0)`：關鍵 - 絕不合併
- `TODO(1)`：高 - 架構缺陷、重大錯誤
- `TODO(2)`：中 - 小錯誤、缺少的功能
- `TODO(3)`：低 - 潤色、測試、文件
- `TODO(4)`：需要調查的問題
- `PERF`：效能最佳化機會

## 其他資源
- 查閱 `docs/` 以獲取面向使用者的文件
