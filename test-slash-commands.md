# Slash Commands 修復手動測試計畫

## 測試環境設定
1. 確保 daemon 正在執行：`cd hld && go run .`
2. 確保 UI 正在執行：`cd humanlayer-wui && bun run dev`
3. 確認 `.claude/commands/` 目錄中有 slash commands

## 測試案例

### 測試 1：具有 ID 的現有草稿
1. 導航至現有草稿：`/sessions/draft?id=XXX`
2. 點擊編輯器
3. 輸入 `/`
4. **預期結果**：應顯示含有可用命令的 Slash commands 下拉選單
5. **驗證**：主控台中沒有關於缺少 session context 的錯誤訊息

### 測試 2：建立新草稿
1. 按 'c' 建立新草稿（或導航至 `/sessions/draft`）
2. 在編輯器中開始輸入以觸發草稿建立
3. 輸入 `/`
4. **預期結果**：草稿建立後應立即顯示 Slash commands 下拉選單
5. **驗證**：命令已被擷取並顯示

### 測試 3：檔案提及
1. 在草稿 session 中，輸入 `@`
2. **預期結果**：應顯示檔案搜尋下拉選單
3. **驗證**：可搜尋工作目錄中的檔案

### 測試 4：在草稿間導航
1. 建立草稿 A，驗證 slash commands 可正常運作
2. 導航至草稿 B
3. **預期結果**：Slash commands 在草稿 B 中可正常運作
4. 返回草稿 A
5. **預期結果**：Slash commands 在草稿 A 中仍可正常運作

### 測試 5：活動中的 Sessions 仍可正常運作
1. 啟動草稿使其成為活動狀態
2. 導航至活動中的 session
3. 輸入 `/`
4. **預期結果**：Slash commands 在活動中的 sessions 仍可正常運作
5. **驗證**：現有功能沒有退化

## 主控台檢查
- 沒有關於 `activeSessionDetail` 為 null 的錯誤
- 沒有關於缺少 session ID 的錯誤
- 輸入 `/` 時，網路分頁顯示向 `/slash-commands` 端點發出的 GET 請求

## 成功標準
- [ ] 所有 5 個測試案例通過
- [ ] 沒有主控台錯誤
- [ ] Slash commands 在草稿和活動中的 sessions 中運作一致
