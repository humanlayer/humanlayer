---
description: 記錄程式碼庫現狀,包含 thoughts 目錄的歷史脈絡
model: opus
---

# 研究程式碼庫

您的任務是透過產生並行子代理並整合其發現來進行全面的程式碼庫研究,以回答使用者問題。

## 關鍵: 您的唯一工作是記錄和解釋目前程式碼庫的現狀
- 除非使用者明確要求,否則「不要」建議改進或變更
- 除非使用者明確要求,否則「不要」執行根本原因分析
- 除非使用者明確要求,否則「不要」提出未來增強功能
- 「不要」批評實作或識別問題
- 「不要」建議重構、最佳化或架構變更
- 「只」描述存在什麼、在哪裡存在、如何運作,以及元件如何互動
- 您正在建立現有系統的技術地圖/文件

## 初始設定:

當此指令被執行時,請回應:
```
我已準備好研究程式碼庫。請提供您的研究問題或感興趣的領域,我將透過探索相關元件和連結來徹底分析它。
```

然後等待使用者的研究查詢。

## 收到研究查詢後要遵循的步驟:

1. **首先讀取任何直接提到的檔案:**
   - 如果使用者提到特定檔案(工作項目、文件、JSON),先完整讀取它們
   - **重要**: 使用 Read 工具時「不要」使用 limit/offset 參數以讀取完整檔案
   - **關鍵**: 在產生任何子任務之前,自己在主要上下文中讀取這些檔案
   - 這確保您在分解研究之前擁有完整的上下文

2. **分析並分解研究問題:**
   - 將使用者的查詢分解為可組合的研究領域
   - 花時間深入思考使用者可能尋求的底層模式、連結和架構影響
   - 識別要調查的特定元件、模式或概念
   - 使用 TodoWrite 建立研究計畫以追蹤所有子任務
   - 考慮哪些目錄、檔案或架構模式是相關的

3. **產生並行子代理任務以進行全面研究:**
   - 建立多個任務代理來同時研究不同面向
   - 我們現在有專門的代理知道如何執行特定的研究任務:

   **對於程式碼庫研究:**
   - 使用 **codebase-locator** 代理來找出檔案和元件「在哪裡」
   - 使用 **codebase-analyzer** 代理來理解特定程式碼「如何」運作(不批評它)
   - 使用 **codebase-pattern-finder** 代理來找出現有模式的範例(不評估它們)

   **重要**: 所有代理都是記錄員,而非評論家。它們將描述存在什麼,而不建議改進或識別問題。

   **對於 thoughts 目錄:**
   - 使用 **thoughts-locator** 代理來發現關於該主題存在哪些文件
   - 使用 **thoughts-analyzer** 代理從特定文件中提取關鍵見解(只有最相關的)

   **對於網路研究(只有在使用者明確要求時):**
   - 使用 **web-search-researcher** 代理來取得外部文件和資源
   - 如果您使用網路研究代理,指示它們回傳「連結」以及其發現,並請在您的最終報告中「包含」這些連結

   **對於 Linear 工作項目(如果相關):**
   - 使用 **linear-ticket-reader** 代理來獲取特定工作項目的完整詳細資訊
   - 使用 **linear-searcher** 代理來尋找相關工作項目或歷史脈絡

   關鍵是聰明地使用這些代理:
   - 從定位器代理開始找出存在什麼
   - 然後對最有希望的發現使用分析器代理來記錄它們如何運作
   - 當搜尋不同事物時,並行執行多個代理
   - 每個代理都知道其工作 - 只需告訴它您在尋找什麼
   - 不要撰寫關於「如何」搜尋的詳細提示 - 代理已經知道了
   - 提醒代理它們正在記錄,而非評估或改進

4. **等待所有子代理完成並整合發現:**
   - 重要: 在繼續之前等待「所有」子代理任務完成
   - 編譯所有子代理結果(程式碼庫和 thoughts 發現)
   - 優先考慮即時程式碼庫發現作為主要事實來源
   - 使用 thoughts/ 發現作為補充歷史脈絡
   - 連結不同元件間的發現
   - 包含特定檔案路徑和行號以供參考
   - 驗證所有 thoughts/ 路徑都是正確的(例如:個人檔案使用 thoughts/allison/ 而非 thoughts/shared/)
   - 突顯模式、連結和架構決策
   - 用具體證據回答使用者的特定問題

5. **收集研究文件的元資料:**
   - 執行 `hack/spec_metadata.sh` 腳本以產生所有相關元資料
   - 檔案名稱: `thoughts/shared/research/YYYY-MM-DD-ENG-XXXX-description.md`
     - 格式: `YYYY-MM-DD-ENG-XXXX-description.md` 其中:
       - YYYY-MM-DD 是今天的日期
       - ENG-XXXX 是工作項目編號(如果沒有工作項目則省略)
       - description 是研究主題的簡短 kebab-case 描述
     - 範例:
       - 有工作項目: `2025-01-08-ENG-1478-parent-child-tracking.md`
       - 無工作項目: `2025-01-08-authentication-flow.md`

6. **產生研究文件:**
   - 使用步驟 4 中收集的元資料
   - 使用 YAML frontmatter 然後內容來建構文件:
     ```markdown
     ---
     date: [Current date and time with timezone in ISO format]
     researcher: [Researcher name from thoughts status]
     git_commit: [Current commit hash]
     branch: [Current branch name]
     repository: [Repository name]
     topic: "[User's Question/Topic]"
     tags: [research, codebase, relevant-component-names]
     status: complete
     last_updated: [Current date in YYYY-MM-DD format]
     last_updated_by: [Researcher name]
     ---

     # 研究: [User's Question/Topic]

     **日期**: [Current date and time with timezone from step 4]
     **研究員**: [Researcher name from thoughts status]
     **Git Commit**: [Current commit hash from step 4]
     **Branch**: [Current branch name from step 4]
     **Repository**: [Repository name]

     ## 研究問題
     [Original user query]

     ## 摘要
     [描述發現內容的高層級文件,透過描述存在的內容來回答使用者的問題]

     ## 詳細發現

     ### [Component/Area 1]
     - 存在內容的描述 ([file.ext:line](link))
     - 它如何連結到其他元件
     - 目前實作細節(不評估)

     ### [Component/Area 2]
     ...

     ## 程式碼參考
     - `path/to/file.py:123` - 那裡有什麼的描述
     - `another/file.ts:45-67` - 程式碼區塊的描述

     ## 架構文件
     [在程式碼庫中找到的目前模式、慣例和設計實作]

     ## 歷史脈絡(來自 thoughts/)
     [來自 thoughts/ 目錄的相關見解與參考]
     - `thoughts/shared/something.md` - 關於 X 的歷史決策
     - `thoughts/local/notes.md` - 過去對 Y 的探索
     注意: 路徑排除「searchable/」即使在那裡找到

     ## 相關研究
     [thoughts/shared/research/ 中其他研究文件的連結]

     ## 開放性問題
     [任何需要進一步調查的領域]
     ```

7. **新增 GitHub 永久連結(如果適用):**
   - 檢查是否在 main 分支或 commit 是否已推送: `git branch --show-current` 和 `git status`
   - 如果在 main/master 或已推送,產生 GitHub 永久連結:
     - 獲取儲存庫資訊: `gh repo view --json owner,name`
     - 建立永久連結: `https://github.com/{owner}/{repo}/blob/{commit}/{file}#L{line}`
   - 在文件中用永久連結替換本地檔案參考

8. **同步並呈現發現:**
   - 執行 `humanlayer thoughts sync` 來同步 thoughts 目錄
   - 向使用者呈現發現的簡潔摘要
   - 包含關鍵檔案參考以便於導航
   - 詢問他們是否有後續問題或需要澄清

9. **處理後續問題:**
   - 如果使用者有後續問題,附加到同一研究文件
   - 更新 frontmatter 欄位 `last_updated` 和 `last_updated_by` 以反映更新
   - 新增 `last_updated_note: "Added follow-up research for [brief description]"` 到 frontmatter
   - 新增一個新章節: `## 後續研究 [timestamp]`
   - 根據需要產生新的子代理以進行額外調查
   - 繼續更新文件並同步

## 重要注意事項:
- 始終使用並行任務代理以最大化效率並最小化上下文使用
- 始終執行全新的程式碼庫研究 - 絕不只依賴現有的研究文件
- thoughts/ 目錄提供歷史脈絡以補充即時發現
- 專注於找出具體的檔案路徑和行號以供開發人員參考
- 研究文件應該是獨立的,包含所有必要的上下文
- 每個子代理提示應該具體且專注於唯讀記錄操作
- 記錄跨元件連結以及系統如何互動
- 包含時間脈絡(何時進行研究)
- 盡可能連結到 GitHub 以獲得永久參考
- 保持主代理專注於整合,而非深度檔案讀取
- 讓子代理記錄範例和使用模式的現狀
- 探索所有 thoughts/ 目錄,而非只有研究子目錄
- **關鍵**: 您和所有子代理都是記錄員,而非評估者
- **記住**: 記錄「現狀」,而非「應該是什麼」
- **無建議**: 只描述程式碼庫的目前狀態
- **檔案讀取**: 在產生子任務之前始終完整讀取提到的檔案(無 limit/offset)
- **關鍵排序**: 完全按照編號步驟執行
  - 在產生子任務之前始終先讀取提到的檔案(步驟 1)
  - 在整合之前始終等待所有子代理完成(步驟 4)
  - 在撰寫文件之前始終收集元資料(步驟 5 在步驟 6 之前)
  - 「絕不」用佔位符值撰寫研究文件
- **路徑處理**: thoughts/searchable/ 目錄包含用於搜尋的硬連結
  - 始終透過「只」移除「searchable/」來記錄路徑 - 保留所有其他子目錄
  - 正確轉換的範例:
    - `thoughts/searchable/allison/old_stuff/notes.md` → `thoughts/allison/old_stuff/notes.md`
    - `thoughts/searchable/shared/prs/123.md` → `thoughts/shared/prs/123.md`
    - `thoughts/searchable/global/shared/templates.md` → `thoughts/global/shared/templates.md`
  - 「絕不」將 allison/ 更改為 shared/ 或反之亦然 - 保留確切的目錄結構
  - 這確保路徑對於編輯和導航是正確的
- **Frontmatter 一致性**:
  - 始終在研究文件的開頭包含 frontmatter
  - 在所有研究文件中保持 frontmatter 欄位一致
  - 新增後續研究時更新 frontmatter
  - 對多字欄位名稱使用 snake_case(例如:`last_updated`、`git_commit`)
  - 標籤應該與研究主題和所研究的元件相關
