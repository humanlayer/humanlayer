---
description: 管理 Linear 工作項目 - 建立、更新、留言，並遵循工作流程模式
---

# Linear - 工作項目管理

你的任務是管理 Linear 工作項目，包括從想法文件建立工作項目、更新現有工作項目，以及遵循團隊的特定工作流程模式。

## 初始設定

首先，透過檢查是否存在任何 `mcp__linear__` 工具來驗證 Linear MCP 工具是否可用。如果不可用，回應：
```
我需要存取 Linear 工具來協助工作項目管理。請執行 `/mcp` 指令以啟用 Linear MCP 伺服器，然後重試。
```

如果工具可用，根據使用者的請求回應：

### 對於一般請求：
```
我可以協助你處理 Linear 工作項目。你想要做什麼？
1. 從想法文件建立新的工作項目
2. 在工作項目中新增留言（我將使用我們的對話上下文）
3. 搜尋工作項目
4. 更新工作項目狀態或詳細資訊
```

### 對於特定建立請求：
```
我將協助你從想法文件建立 Linear 工作項目。請提供：
1. 想法文件的路徑（或要搜尋的主題）
2. 工作項目的任何特定焦點或角度（選填）
```

然後等待使用者的輸入。

## 團隊工作流程與狀態進展

團隊遵循特定的工作流程以確保在程式碼實作前達成共識:

1. **Triage** → 所有新工作項目從此開始進行初步審查
2. **Spec Needed** → 需要更多細節 - 需要問題描述和解決方案大綱
3. **Research Needed** → 工作項目在撰寫計畫前需要調查
4. **Research in Progress** → 正在進行研究/調查
5. **Research in Review** → 研究結果審查中(選填步驟)
6. **Ready for Plan** → 研究完成,工作項目需要實作計畫
7. **Plan in Progress** → 正在撰寫實作計畫
8. **Plan in Review** → 計畫已撰寫並在討論中
9. **Ready for Dev** → 計畫已批准,準備實作
10. **In Dev** → 積極開發中
11. **Code Review** → PR 已提交
12. **Done** → 已完成

**核心原則**: 審查和共識發生在計畫階段(而非 PR 階段),以加快進度並避免重工。

## 重要慣例

### Thoughts 文件的 URL 對應
參考 thoughts 文件時,始終使用 `links` 參數提供 GitHub 連結:
- `thoughts/shared/...` → `https://github.com/humanlayer/thoughts/blob/main/repos/humanlayer/shared/...`
- `thoughts/allison/...` → `https://github.com/humanlayer/thoughts/blob/main/repos/humanlayer/allison/...`
- `thoughts/global/...` → `https://github.com/humanlayer/thoughts/blob/main/global/...`

### 預設值
- **狀態**: 始終在「Triage」狀態中建立新工作項目
- **專案**: 對於新工作項目,除非另有說明,否則預設為「M U L T I C L A U D E」(ID: f11c8d63-9120-4393-bfae-553da0b04fd8)
- **優先順序**: 大多數任務預設為中等 (3),使用最佳判斷或詢問使用者
  - 緊急 (1): 關鍵阻礙、安全問題
  - 高 (2): 有截止日期的重要功能、主要錯誤
  - 中等 (3): 標準實作任務(預設)
  - 低 (4): 錦上添花、小改進
- **連結**: 使用 `links` 參數附加 URL(不只是描述中的 markdown 連結)

### 自動標籤分配
根據工作項目內容自動套用標籤:
- **hld**: 關於 `hld/` 目錄(daemon)的工作項目
- **wui**: 關於 `humanlayer-wui/` 的工作項目
- **meta**: 關於 `hlyr` 指令、thoughts 工具或 `thoughts/` 目錄的工作項目

注意: meta 與 hld/wui 互斥。工作項目可以同時有 hld 和 wui,但不能有 meta 搭配其中任一個。

## 特定動作指示

### 1. 從 Thoughts 建立工作項目

#### 收到請求後要遵循的步驟:

1. **找出並讀取 thoughts 文件:**
   - 如果給定路徑,直接讀取文件
   - 如果給定主題/關鍵字,使用 Grep 搜尋 thoughts/ 目錄以找出相關文件
   - 如果找到多個匹配項,顯示清單並要求使用者選擇
   - 建立 TodoWrite 清單以追蹤: 讀取文件 → 分析內容 → 起草工作項目 → 獲取使用者輸入 → 建立工作項目

2. **分析文件內容:**
   - 識別正在討論的核心問題或功能
   - 提取關鍵實作細節或技術決策
   - 記錄提到的任何特定程式碼檔案或領域
   - 尋找行動項目或後續步驟
   - 識別想法處於什麼階段(早期構思與準備實作)
   - 花時間深入思考如何將此文件的精髓提煉成清晰的問題陳述和解決方案方法

3. **檢查相關上下文(如果文件中提到):**
   - 如果文件參考特定程式碼檔案,讀取相關章節
   - 如果提到其他 thoughts 文件,快速檢查它們
   - 尋找任何提及的現有 Linear 工作項目

4. **獲取 Linear 工作區上下文:**
   - 列出團隊: `mcp__linear__list_teams`
   - 如果有多個團隊,請使用者選擇一個
   - 列出所選團隊的專案: `mcp__linear__list_projects`

5. **起草工作項目摘要:**
   向使用者呈現草稿:
   ```
   ## Linear 工作項目草稿

   **標題**: [清晰、以行動為導向的標題]

   **描述**:
   [2-3 句問題/目標摘要]

   ## 關鍵細節
   - [來自 thoughts 的重要細節要點]
   - [技術決策或限制條件]
   - [任何特定需求]

   ## 實作注意事項(如果適用)
   [概述的任何特定技術方法或步驟]

   ## 參考資料
   - 來源: `thoughts/[path/to/document.md]` ([在 GitHub 上檢視](轉換後的 GitHub URL))
   - 相關程式碼: [任何 file:line 參考]
   - 父工作項目: [如果適用]

   ---
   根據文件,這似乎處於以下階段: [構思/規劃/準備實作]
   ```

6. **互動式精煉:**
   詢問使用者:
   - 此摘要是否準確捕捉了工作項目?
   - 這應該放在哪個專案中? [顯示清單]
   - 什麼優先順序? (預設: 中等/3)
   - 要新增任何額外上下文嗎?
   - 我們應該包含更多/更少實作細節嗎?
   - 您想要將它指派給自己嗎?

   注意: 工作項目預設將在「Triage」狀態中建立。

7. **建立 Linear 工作項目:**
   ```
   mcp__linear__create_issue with:
   - title: [精煉的標題]
   - description: [markdown 格式的最終描述]
   - teamId: [所選團隊]
   - projectId: [除非使用者指定,否則使用上述預設專案]
   - priority: [所選優先順序編號,預設 3]
   - stateId: [Triage 狀態 ID]
   - assigneeId: [如果請求]
   - labelIds: [套用上述自動標籤分配]
   - links: [{url: "GitHub URL", title: "Document Title"}]
   ```

8. **建立後動作:**
   - 顯示已建立的工作項目 URL
   - 詢問使用者是否想要:
     - 新增包含額外實作細節的留言
     - 為特定行動項目建立子任務
     - 使用工作項目參考更新原始 thoughts 文件
   - 如果同意更新 thoughts 文件:
     ```
     在文件頂部新增:
     ---
     linear_ticket: [URL]
     created: [date]
     ---
     ```

## 轉換範例:

### 從冗長的 thoughts:
```
「我一直在想我們恢復的會話沒有正確繼承權限的問題。
這導致使用者必須重新指定所有內容。我們應該可能
將所有設定儲存在資料庫中,然後在恢復時提取。也許我們需要
permission_prompt_tool 和 allowed_tools 的新欄位...」
```

### 到簡潔的工作項目:
```
標題: 修復恢復的會話以繼承父會話的所有設定

描述:

## 要解決的問題
目前,恢復的會話只繼承父會話的 Model 和 WorkingDir,
導致所有其他設定遺失。使用者必須在恢復時重新指定權限和設定。

## 解決方案
將所有會話設定儲存在資料庫中,並在恢復會話時自動繼承,
支援明確覆寫。
```

### 2. 為現有工作項目新增留言和連結

當使用者想要為工作項目新增留言時:

1. **確定哪個工作項目:**
   - 使用目前對話的上下文來識別相關工作項目
   - 如果不確定,使用 `mcp__linear__get_issue` 顯示工作項目詳細資訊並與使用者確認
   - 尋找最近討論的工作中提到的工作項目參考

2. **格式化留言以提高清晰度:**
   - 除非需要更多細節,否則嘗試保持留言簡潔(約 10 行)
   - 專注於關鍵見解或對人類讀者最有用的資訊
   - 不只是做了什麼,而是它有什麼重要性
   - 包含帶有反引號和 GitHub 連結的相關檔案參考

3. **檔案參考格式:**
   - 用反引號包裝路徑: `thoughts/allison/example.md`
   - 之後新增 GitHub 連結: `([View](url))`
   - 對提到的 thoughts/ 和程式碼檔案都這樣做

4. **留言結構範例:**
   ```markdown
   在 webhook 處理器中實作重試邏輯以解決速率限制問題。

   關鍵見解: 429 回應在批次操作期間聚集,
   因此單獨的指數退避不夠 - 新增了請求佇列。

   更新的檔案:
   - `hld/webhooks/handler.go` ([GitHub](link))
   - `thoughts/shared/rate_limit_analysis.md` ([GitHub](link))
   ```

5. **正確處理連結:**
   - 如果新增帶留言的連結: 更新工作項目的連結「並」在留言中提及它
   - 如果只新增連結: 仍然建立留言記錄新增了什麼連結以供後用
   - 始終使用 `links` 參數將連結新增到工作項目本身

6. **對於帶連結的留言:**
   ```
   # 首先,用連結更新工作項目
   mcp__linear__update_issue with:
   - id: [ticket ID]
   - links: [existing links + new link with proper title]

   # 然後,建立提及連結的留言
   mcp__linear__create_comment with:
   - issueId: [ticket ID]
   - body: [formatted comment with key insights and file references]
   ```

7. **僅對於連結:**
   ```
   # 用連結更新工作項目
   mcp__linear__update_issue with:
   - id: [ticket ID]
   - links: [existing links + new link with proper title]

   # 新增簡短留言以供後用
   mcp__linear__create_comment with:
   - issueId: [ticket ID]
   - body: "Added link: `path/to/document.md` ([View](url))"
   ```

### 3. 搜尋工作項目

當使用者想要找出工作項目時:

1. **收集搜尋準則:**
   - 查詢文字
   - 團隊/專案篩選器
   - 狀態篩選器
   - 日期範圍 (createdAt, updatedAt)

2. **執行搜尋:**
   ```
   mcp__linear__list_issues with:
   - query: [search text]
   - teamId: [if specified]
   - projectId: [if specified]
   - stateId: [if filtering by status]
   - limit: 20
   ```

3. **呈現結果:**
   - 顯示工作項目 ID、標題、狀態、受指派人
   - 如果有多個專案,按專案分組
   - 包含 Linear 的直接連結

### 4. 更新工作項目狀態

在工作流程中移動工作項目時:

1. **獲取目前狀態:**
   - 取得工作項目詳細資訊
   - 在工作流程中顯示目前狀態

2. **建議下一個狀態:**
   - Triage → Spec Needed (缺少細節/問題陳述)
   - Spec Needed → Research Needed (問題/解決方案概述後)
   - Research Needed → Research in Progress (開始研究)
   - Research in Progress → Research in Review (選填,可跳至 Ready for Plan)
   - Research in Review → Ready for Plan (研究已批准)
   - Ready for Plan → Plan in Progress (開始撰寫計畫)
   - Plan in Progress → Plan in Review (計畫已撰寫)
   - Plan in Review → Ready for Dev (計畫已批准)
   - Ready for Dev → In Dev (工作已開始)

3. **帶上下文更新:**
   ```
   mcp__linear__update_issue with:
   - id: [ticket ID]
   - stateId: [new status ID]
   ```

   考慮新增解釋狀態變更的留言。

## 重要注意事項

- 在描述和留言中使用 `@[name](ID)` 格式標記使用者,例如:`@[dex](16765c85-2286-4c0f-ab49-0d4d79222ef5)`
- 保持工作項目簡潔但完整 - 目標是可掃描的內容
- 所有工作項目都應包含清晰的「要解決的問題」- 如果使用者要求工作項目但只提供實作細節,您「必須」詢問「要撰寫好的工作項目,請從使用者角度解釋您試圖解決的問題」
- 專注於「什麼」和「為什麼」,只有在定義明確時才包含「如何」
- 始終使用 `links` 參數保留來源資料的連結
- 除非請求,否則不要從早期階段的腦力激盪建立工作項目
- 使用正確的 Linear markdown 格式
- 包含程式碼參考為: `path/to/file.ext:linenum`
- 尋求澄清而不是猜測專案/狀態
- 記住 Linear 描述支援完整的 markdown,包括程式碼區塊
- 始終對外部 URL 使用 `links` 參數(不只是描述中的 markdown 連結)
- 記住 - 您必須獲得「要解決的問題」!

## 留言品質指引

建立留言時,專注於提取對人類讀者**最有價值的資訊**:

- **關鍵見解優於摘要**: 什麼是「頓悟」時刻或關鍵理解?
- **決策和權衡**: 選擇了什麼方法以及它啟用/阻止了什麼
- **解決的阻礙**: 什麼阻止了進度以及如何解決的
- **狀態變更**: 現在有什麼不同以及對後續步驟意味著什麼
- **驚喜或發現**: 影響工作的意外發現

避免:
- 沒有上下文的機械式變更清單
- 重述程式碼差異中顯而易見的內容
- 不增加價值的通用摘要

記住: 目標是幫助未來的讀者(包括您自己)快速理解此更新的重要內容。

## 常用 ID

### 工程團隊
- **Team ID**: `6b3b2115-efd4-4b83-8463-8160842d2c84`

### 標籤 ID
- **bug**: `ff23dde3-199b-421e-904c-4b9f9b3d452c`
- **hld**: `d28453c8-e53e-4a06-bea9-b5bbfad5f88a`
- **meta**: `7a5abaae-f343-4f52-98b0-7987048b0cfa`
- **wui**: `996deb94-ba0f-4375-8b01-913e81477c4b`

### 工作流程狀態 ID
- **Triage**: `77da144d-fe13-4c3a-a53a-cfebd06c0cbe` (type: triage)
- **spec needed**: `274beb99-bff8-4d7b-85cf-04d18affbc82` (type: unstarted)
- **research needed**: `d0b89672-8189-45d6-b705-50afd6c94a91` (type: unstarted)
- **research in progress**: `c41c5a23-ce25-471f-b70a-eff1dca60ffd` (type: unstarted)
- **research in review**: `1a9363a7-3fae-42ee-a6c8-1fc714656f09` (type: unstarted)
- **ready for plan**: `995011dd-3e36-46e5-b776-5a4628d06cc8` (type: unstarted)
- **plan in progress**: `a52b4793-d1b6-4e5d-be79-b2254185eed0` (type: started)
- **plan in review**: `15f56065-41ea-4d9a-ab8c-ec8e1a811a7a` (type: started)
- **ready for dev**: `c25bae2f-856a-4718-aaa8-b469b7822f58` (type: started)
- **in dev**: `6be18699-18d7-496e-a7c9-37d2ddefe612` (type: started)
- **code review**: `8ca7fda1-08d4-48fb-a0cf-954246ccbe66` (type: started)
- **Ready for Deploy**: `a3ad0b54-17bf-4ad3-b1c1-2f56c1f2515a` (type: started)
- **Done**: `8159f431-fbc7-495f-a861-1ba12040f672` (type: completed)
- **Backlog**: `6cf6b25a-054a-469b-9845-9bd9ab39ad76` (type: backlog)
- **PostIts**: `a57f2ab3-c6f8-44c7-a36b-896154729338` (type: backlog)
- **Todo**: `ddf85246-3a7c-4141-a377-09069812bbc3` (type: unstarted)
- **Duplicate**: `2bc0e829-9853-4f76-ad34-e8732f062da2` (type: canceled)
- **Canceled**: `14a28d0d-c6aa-4d8e-9ff2-9801d4cc7de1` (type: canceled)


## Linear 使用者 ID

- allison: b157f9e4-8faf-4e7e-a598-dae6dec8a584
- dex: 16765c85-2286-4c0f-ab49-0d4d79222ef5
- sundeep: 0062104d-9351-44f5-b64c-d0b59acb516b
