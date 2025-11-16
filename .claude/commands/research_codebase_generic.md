---
description: 使用平行子代理進行程式碼庫的綜合研究
model: opus
---

# 研究程式碼庫

你的任務是透過產生平行子代理並綜合它們的發現，在程式碼庫中進行綜合研究以回答使用者的問題。

## 初始設定：

當此指令被呼叫時，回應：
```
我已準備好研究程式碼庫。請提供你的研究問題或感興趣的領域，我將透過探索相關元件和連接來徹底分析它。
```

然後等待使用者的研究查詢。

## 收到研究查詢後要遵循的步驟：

1. **首先閱讀任何直接提到的檔案：**
   - 如果使用者提到特定檔案（工作項目、文件、JSON），首先完整閱讀它們
   - **重要**：使用 Read 工具時不要使用 limit/offset 參數來閱讀完整檔案
   - **關鍵**：在產生任何子任務之前，在主要上下文中自己閱讀這些檔案
   - 這確保你在分解研究之前有完整的上下文

2. **分析並分解研究問題：**
   - 將使用者的查詢分解為可組合的研究領域
   - 花時間深入思考使用者可能尋求的底層模式、連接和架構影響
   - 識別要調查的特定元件、模式或概念
   - 使用 TodoWrite 建立研究計畫以追蹤所有子任務
   - 考慮哪些目錄、檔案或架構模式是相關的

3. **產生平行子代理任務進行綜合研究：**
   - 建立多個 Task 代理以並行研究不同的方面

   關鍵是聰明地使用這些代理：
   - 從定位代理開始以找到存在的內容
   - 然後對最有希望的發現使用分析代理
   - 當搜尋不同事物時並行執行多個代理
   - 每個代理都知道它的工作 - 只需告訴它你在尋找什麼
   - 不要撰寫關於如何搜尋的詳細提示 - 代理已經知道

4. **等待所有子代理完成並綜合發現：**
   - 重要：在繼續之前等待所有子代理任務完成
   - 編譯所有子代理結果（程式碼庫和想法發現）
   - 將即時程式碼庫發現優先作為主要事實來源
   - 使用 thoughts/ 發現作為補充歷史上下文
   - 連接不同元件之間的發現
   - 包含具體的檔案路徑和行號以供參照
   - 驗證所有 thoughts/ 路徑是否正確（例如，個人檔案使用 thoughts/allison/ 而不是 thoughts/shared/）
   - 突出顯示模式、連接和架構決策
   - 用具體證據回答使用者的特定問題

5. **收集研究文件的中繼資料：**
   - 產生所有相關的中繼資料
   - 檔案名稱：`thoughts/shared/research/YYYY-MM-DD-ENG-XXXX-description.md`
     - 格式：`YYYY-MM-DD-ENG-XXXX-description.md`，其中：
       - YYYY-MM-DD 是今天的日期
       - ENG-XXXX 是工作項目編號（如果沒有工作項目則省略）
       - description 是研究主題的簡短 kebab-case 描述
     - 範例：
       - 有工作項目：`2025-01-08-ENG-1478-parent-child-tracking.md`
       - 無工作項目：`2025-01-08-authentication-flow.md`

6. **產生研究文件：**
   - 使用步驟 4 收集的中繼資料
   - 以 YAML frontmatter 後接內容的方式構建文件：
     ```markdown
     ---
     date: [ISO 格式的當前日期和時間（含時區）]
     researcher: [研究員姓名]
     git_commit: [當前提交雜湊]
     branch: [當前分支名稱]
     repository: [儲存庫名稱]
     topic: "[使用者的問題/主題]"
     tags: [research, codebase, 相關元件名稱]
     status: complete
     last_updated: [YYYY-MM-DD 格式的當前日期]
     last_updated_by: [研究員姓名]
     ---

     # 研究：[使用者的問題/主題]

     **日期**：[步驟 4 的當前日期和時間（含時區）]
     **研究員**：[研究員姓名]
     **Git 提交**：[步驟 4 的當前提交雜湊]
     **分支**：[步驟 4 的當前分支名稱]
     **儲存庫**：[儲存庫名稱]

     ## 研究問題
     [原始使用者查詢]

     ## 摘要
     [回答使用者問題的高層次發現]

     ## 詳細發現

     ### [元件/領域 1]
     - 具有參照的發現 ([file.ext:line](連結))
     - 與其他元件的連接
     - 實作細節

     ### [元件/領域 2]
     ...

     ## 程式碼參照
     - `path/to/file.py:123` - 該處內容的描述
     - `another/file.ts:45-67` - 程式碼區塊的描述

     ## 架構見解
     [發現的模式、慣例和設計決策]

     ## 歷史上下文（來自 thoughts/）
     [來自 thoughts/ 目錄的相關見解及參照]
     - `thoughts/shared/something.md` - 關於 X 的歷史決策
     - `thoughts/local/notes.md` - Y 的過去探索
     註：即使在 searchable/ 中找到，路徑也會排除「searchable/」

     ## 相關研究
     [連結到 thoughts/shared/research/ 中其他研究文件]

     ## 未解問題
     [任何需要進一步調查的領域]
     ```

7. **新增 GitHub 永久連結（如適用）：**
   - 檢查是否在主分支上或提交是否已推送：`git branch --show-current` 和 `git status`
   - 如果在 main/master 或已推送，產生 GitHub 永久連結：
     - 取得儲存庫資訊：`gh repo view --json owner,name`
     - 建立永久連結：`https://github.com/{owner}/{repo}/blob/{commit}/{file}#L{line}`
   - 在文件中用永久連結替換本地檔案參照

8. **同步並呈現發現：**
   - 向使用者呈現發現的簡明摘要
   - 包含關鍵檔案參照以便於導航
   - 詢問他們是否有後續問題或需要澄清

9. **處理後續問題：**
   - 如果使用者有後續問題，附加到同一個研究文件
   - 更新 frontmatter 欄位 `last_updated` 和 `last_updated_by` 以反映更新
   - 在 frontmatter 中新增 `last_updated_note: "為 [簡要描述] 新增後續研究"`
   - 新增新區段：`## 後續研究 [時間戳記]`
   - 根據需要產生新的子代理進行額外調查
   - 繼續更新並同步文件

## 重要註記：
- 始終使用平行 Task 代理以最大化效率並最小化上下文使用
- 始終執行新鮮的程式碼庫研究 - 永遠不要僅依賴現有的研究文件
- thoughts/ 目錄提供歷史上下文以補充即時發現
- 專注於找到具體的檔案路徑和行號以供開發人員參照
- 研究文件應該是自包含的，包含所有必要的上下文
- 每個子代理提示應該具體且集中在唯讀操作上
- 考慮跨元件連接和架構模式
- 包含時間上下文（研究進行的時間）
- 盡可能連結到 GitHub 以獲得永久參照
- 保持主代理專注於綜合，而不是深度檔案閱讀
- 鼓勵子代理找到範例和使用模式，而不僅僅是定義
- 探索 thoughts/ 目錄的所有內容，而不僅僅是研究子目錄
- **檔案閱讀**：在產生子任務之前始終完整閱讀提到的檔案（不使用 limit/offset）
- **關鍵順序**：嚴格遵循編號的步驟
  - 始終在產生子任務之前先閱讀提到的檔案（步驟 1）
  - 始終在綜合之前等待所有子代理完成（步驟 4）
  - 始終在撰寫文件之前收集中繼資料（步驟 5 在步驟 6 之前）
  - 永遠不要使用佔位符值撰寫研究文件
- **路徑處理**：thoughts/searchable/ 目錄包含用於搜尋的硬連結
  - 始終透過僅移除「searchable/」來記錄路徑 - 保留所有其他子目錄
  - 正確轉換的範例：
    - `thoughts/searchable/allison/old_stuff/notes.md` → `thoughts/allison/old_stuff/notes.md`
    - `thoughts/searchable/shared/prs/123.md` → `thoughts/shared/prs/123.md`
    - `thoughts/searchable/global/shared/templates.md` → `thoughts/global/shared/templates.md`
  - 永遠不要將 allison/ 改為 shared/ 或反之 - 保留確切的目錄結構
  - 這確保路徑對於編輯和導航是正確的
- **Frontmatter 一致性**：
  - 始終在研究文件開頭包含 frontmatter
  - 在所有研究文件中保持 frontmatter 欄位一致
  - 新增後續研究時更新 frontmatter
  - 對多字欄位名稱使用 snake_case（例如：`last_updated`、`git_commit`）
  - 標籤應與研究主題和研究的元件相關
