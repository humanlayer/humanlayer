---
description: 依照儲存庫範本產生完整的 PR 說明
---

# 產生 PR 說明

您的任務是依照儲存庫的標準範本產生完整的 pull request 說明。

## 執行步驟：

1. **讀取 PR 說明範本：**
   - 首先，檢查 `thoughts/shared/pr_description.md` 是否存在
   - 如果不存在，通知使用者他們的 `humanlayer thoughts` 設定不完整，需要在 `thoughts/shared/pr_description.md` 建立 PR 說明範本
   - 仔細閱讀範本以理解所有章節和要求

2. **識別要描述的 PR：**
   - 檢查當前分支是否有關聯的 PR：`gh pr view --json url,number,title,state 2>/dev/null`
   - 如果當前分支沒有 PR，或在 main/master 分支上，列出開啟的 PR：`gh pr list --limit 10 --json number,title,headRefName,author`
   - 詢問使用者想要描述哪個 PR

3. **檢查現有說明：**
   - 檢查 `thoughts/shared/prs/{number}_description.md` 是否已存在
   - 如果存在，讀取它並告知使用者您將更新它
   - 考慮自上次撰寫說明以來有哪些變更

4. **收集完整的 PR 資訊：**
   - 取得完整的 PR diff：`gh pr diff {number}`
   - 如果收到沒有預設遠端儲存庫的錯誤，指示使用者執行 `gh repo set-default` 並選擇適當的儲存庫
   - 取得 commit 歷史：`gh pr view {number} --json commits`
   - 查看基礎分支：`gh pr view {number} --json baseRefName`
   - 取得 PR 中繼資料：`gh pr view {number} --json url,title,number,state`

5. **徹底分析變更：**（深入思考程式碼變更、其架構影響和潛在影響）
   - 仔細閱讀整個 diff
   - 為了理解脈絡，讀取任何在 diff 中被引用但未顯示的檔案
   - 理解每個變更的目的和影響
   - 識別面向使用者的變更與內部實作細節
   - 尋找破壞性變更或遷移需求

6. **處理驗證需求：**
   - 在範本的「如何驗證」章節中尋找任何檢查清單項目
   - 對於每個驗證步驟：
     - 如果是您可以執行的指令（如 `make check test`、`npm test` 等），執行它
     - 如果通過，將核取方塊標記為已勾選：`- [x]`
     - 如果失敗，保持未勾選並註明失敗原因：`- [ ]` 附上說明
     - 如果需要手動測試（UI 互動、外部服務），保持未勾選並為使用者註記
   - 記錄任何您無法完成的驗證步驟

7. **產生說明：**
   - 徹底填寫範本中的每個章節：
     - 根據您的分析回答每個問題/章節
     - 具體說明解決的問題和所做的變更
     - 在相關處專注於對使用者的影響
     - 在適當章節中包含技術細節
     - 撰寫簡潔的變更日誌條目
   - 確保所有檢查清單項目都已處理（已勾選或已說明）

8. **儲存並同步說明：**
   - 將完成的說明寫入 `thoughts/shared/prs/{number}_description.md`
   - 執行 `humanlayer thoughts sync` 以同步 thoughts 目錄
   - 向使用者展示產生的說明

9. **更新 PR：**
   - 直接更新 PR 說明：`gh pr edit {number} --body-file thoughts/shared/prs/{number}_description.md`
   - 確認更新成功
   - 如果有任何驗證步驟仍未勾選，提醒使用者在合併前完成它們

## 重要注意事項：
- 此指令適用於不同的儲存庫 - 務必讀取本地範本
- 要徹底但簡潔 - 說明應易於瀏覽
- 專注於「為什麼」與「做什麼」同樣重要
- 顯著地包含任何破壞性變更或遷移注意事項
- 如果 PR 涉及多個元件，相應地組織說明
- 盡可能嘗試執行驗證指令
- 清楚傳達哪些驗證步驟需要手動測試
