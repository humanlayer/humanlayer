這是 HumanLayer Web UI (WUI) - 一個用於管理 AI 代理審批和會話的桌面應用程式。

WUI 連接到 HumanLayer daemon (hld) 以提供圖形介面，用於監控 Claude Code 會話和回應審批請求。它使用 Tauri 進行桌面封裝，並使用 React 建構介面。

當 WUI 執行時，日誌會寫入：

- 開發環境：`~/.humanlayer/logs/wui-{branch-id}/codelayer.log`（例如 `wui-eng-1784/codelayer.log`）
- 正式環境：平台特定目錄：
  - macOS：`~/Library/Logs/dev.humanlayer.wui/`
  - Windows：`%APPDATA%\dev.humanlayer.wui\logs\`
  - Linux：`~/.config/dev.humanlayer.wui/logs/`

日誌包含來自 WUI 後端的輸出、daemon stderr（前綴為 [Daemon]）以及前端控制台日誌（前綴為 [Console]）。日誌檔案會在 50MB 時自動輪換。應用程式會在您更改程式碼時自動熱重載 - 您無法手動重新啟動它。

WUI 透過 Unix socket 在 ~/.humanlayer/daemon.sock 使用 JSON-RPC 與 daemon 通訊。所有會話和審批資料都來自 daemon - WUI 純粹是一個展示層。

在 OpenAPI 規格變更後從 hld-sdk 重新生成 TypeScript 型別：

- 從根目錄執行 `make generate-sdks`

對於 UI 開發，我們使用 Radix UI 元件搭配 Tailwind CSS 樣式。狀態管理由 Zustand 處理。程式碼庫遵循 React 最佳實踐，並使用 TypeScript 確保型別安全。

## 提示與技巧

- 務必優先使用 ShadCN 元件而非自訂元件。如果有我們尚未新增的 ShadCN 等效元件，請直接新增它。（例如 `bunx --bun shadcn@latest add accordion`）
- 務必優先使用基於 `tailwind` 的樣式，而非其他類型的樣式
- 務必使用 `zustand` 來管理全域狀態。在許多情況下，我們使用了內部 React 狀態管理，但隨著應用程式規模擴大，我們會希望將更多狀態推送到 `zustand` 中。
- 務必使用 `bun run lint` 和 `bun run typecheck` 驗證您的變更。
- 務必提供手動步驟清單，供人工測試新的 UI 變更。

## 指導原則

- 在 React 19 中，ref 現在可作為函式元件的標準 prop 使用，無需再使用 forwardRef 包裝元件。
- forwardRef 現已棄用，絕不使用它。請改用 ref。

## 測試

我們使用 Bun 的內建測試執行器進行單元測試。使用 `bun test` 執行測試。

- Store 測試位於 `src/AppStore.test.ts`
- 測試對於複雜的狀態管理邏輯（如鍵盤快捷鍵和選擇行為）至關重要
- 修改 store 方法時，首先編寫測試以驗證預期行為
- 對 store 變更使用測試驅動開發（TDD）：編寫失敗的測試，然後實作修復

## 鍵盤快捷鍵與選擇管理

WUI 實作了 vim 風格的鍵盤導航，具有複雜的選擇行為：

- `j/k` - 在會話中向下/向上導航
- `shift+j/shift+k` - 基於錨點的範圍選擇批次選擇
- `x` - 切換個別選擇
- `e` - 封存/取消封存會話

選擇行為透過 AppStore 中的以下關鍵方法管理：

- `bulkSelect(sessionId, direction)` - shift+j/k 快捷鍵的主要入口點
- `selectRange()` - 建立新的選擇範圍
- `addRangeToSelection()` - 將範圍新增到現有選擇中
- `updateCurrentRange()` - 修改現有範圍（樞紐行為）

選擇系統使用「無狀態錨點管理」- 錨點是根據選擇範圍內的當前位置動態計算的，而不是儲存在狀態中。這可防止同步問題。
