# macOS 發布工作流程使用指南

## 測試工作流程（合併前）

工作流程在 `add-macos-release-workflow` 分支上有一個臨時推送觸發器用於測試。這允許在合併到主分支之前進行測試。

### 使用 gh CLI：

```bash
# 將變更推送到分支後
gh workflow run release-macos.yml --ref add-macos-release-workflow -f release_version=v0.1.0-test

# 檢查工作流程狀態
gh run list --workflow=release-macos.yml

# 監看特定執行
gh run watch
```

### 重要：合併前務必移除推送觸發器！

工作流程檔案中的 `push:` 觸發器是臨時的，在建立 PR 之前必須移除。

## 先決條件

- 具有儲存庫的推送權限
- 已決定發布版本（例如 v0.1.0）

## 觸發發布建置

1. 前往 GitHub 中的 [Actions 標籤](../../actions)
2. 從左側邊欄選擇「Build macOS Release Artifacts」
3. 點擊右側的「Run workflow」按鈕
4. 輸入版本標籤（例如 `v0.1.0`）
5. 點擊綠色的「Run workflow」按鈕

## 監控建置

1. 點擊正在執行的工作流程以查看進度
2. 建置通常需要 10-15 分鐘
3. 檢查每個步驟是否有任何錯誤

## 工作流程結果

成功完成後：

### 對於推送觸發器（僅測試）

1. 構件會上傳到 GitHub Actions
2. 從工作流程執行底部的「Artifacts」部分下載
3. 提供三個構件：
   - `humanlayer-wui-macos-dmg` - WUI 應用程式安裝程式
   - `hld-darwin-arm64` - daemon 二進位檔
   - `INSTALL` - 安裝說明

### 對於手動觸發器（workflow_dispatch）

1. 會自動建立 GitHub Release 草稿
2. 所有構件都附加到發布版本
3. 發布版本包含預先格式化的描述和安裝說明
4. 前往 [Releases 頁面](../../releases) 審查並發布草稿

## 發布版本

透過 `workflow_dispatch` 觸發時：

1. 前往 [Releases 頁面](../../releases)
2. 找到帶有您版本標籤的草稿發布版本
3. 審查自動生成的發布說明
4. 如有需要進行編輯（新增變更日誌、已知問題等）
5. 點擊「Publish release」使其公開

## 更新新的 npm 版本

當 npm 套件版本變更時：

1. 編輯 `.github/workflows/release-macos.yml`
2. 找到 `npm install -g humanlayer@0.10.0` 這一行
3. 更新為新版本
4. 提交並推送變更

## 疑難排解

### 建置失敗

- **Rust/Cargo 錯誤**：檢查 Rust 依賴項是否變更
- **Go 建置錯誤**：驗證 Go 版本是否符合 `hld/go.mod`
- **Bun/npm 錯誤**：使用 `bun install --force` 清除快取

### 構件問題

- **缺少 DMG**：檢查 Tauri 建置日誌是否有錯誤
- **缺少 daemon**：驗證 Go 交叉編譯設定
- **錯誤的架構**：確保已設定 `GOARCH=arm64`

### macOS 安全性問題

工作流程使用臨時簽署來防止 Apple Silicon 上的「應用程式已損壞」錯誤。然而，使用者仍會看到安全性警告。

**對於「應用程式已損壞」錯誤：**

- 工作流程應透過臨時簽署防止此問題
- 如果仍然發生，使用者可以執行：`xattr -cr /Applications/humanlayer-wui.app`

**對於安全性警告：**

- 這是未簽署應用程式的預期行為
- 使用者必須右鍵點擊並選擇「開啟」進行首次啟動
- 或在「系統設定 > 隱私權與安全性」中核准
