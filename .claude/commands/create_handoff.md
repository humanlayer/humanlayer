---
description: 建立交接文件以將工作轉移至另一個會話
---

# 建立交接文件

您的任務是撰寫交接文件，將您的工作交接給新會話中的另一個代理。您將建立一份徹底但**簡潔**的交接文件。目標是壓縮和總結您的脈絡，而不遺失您正在處理的任何關鍵細節。


## 流程
### 1. 檔案路徑與中繼資料
使用以下資訊來了解如何建立您的文件：
    - 在 `thoughts/shared/handoffs/ENG-XXXX/YYYY-MM-DD_HH-MM-SS_ENG-ZZZZ_description.md` 下建立您的檔案，其中：
        - YYYY-MM-DD 是今天的日期
        - HH-MM-SS 是基於當前時間的小時、分鐘和秒數，採用 24 小時制（即 `1:00 pm` 使用 `13:00`）
        - ENG-XXXX 是票證編號（如果沒有票證則替換為 `general`）
        - ENG-ZZZZ 是票證編號（如果沒有票證則省略）
        - description 是簡短的 kebab-case 描述
    - 執行 `scripts/spec_metadata.sh` 腳本以產生所有相關中繼資料
    - 範例：
        - 有票證：`2025-01-08_13-55-22_ENG-2166_create-context-compaction.md`
        - 無票證：`2025-01-08_13-55-22_create-context-compaction.md`

### 2. 撰寫交接文件
使用上述慣例，撰寫您的文件。使用定義的檔案路徑和以下 YAML frontmatter 模式。使用步驟 1 中收集的中繼資料，以 YAML frontmatter 後接內容的方式組織文件：

使用以下範本結構：
```markdown
---
date: [Current date and time with timezone in ISO format]
researcher: [Researcher name from thoughts status]
git_commit: [Current commit hash]
branch: [Current branch name]
repository: [Repository name]
topic: "[Feature/Task Name] Implementation Strategy"
tags: [implementation, strategy, relevant-component-names]
status: complete
last_updated: [Current date in YYYY-MM-DD format]
last_updated_by: [Researcher name]
type: implementation_strategy
---

# Handoff: ENG-XXXX {very concise description}

## Task(s)
{您正在處理的任務描述，以及每個任務的狀態（已完成、進行中、已規劃/已討論）。如果您正在執行實作計畫，請務必說明您在哪個階段。如果適用，請務必引用會話開始時提供給您的計畫文件和/或研究文件。}

## Critical References
{列出任何必須遵循的關鍵規格文件、架構決策或設計文件。僅包含 2-3 個最重要的檔案路徑。如果沒有則留空。}

## Recent changes
{以 line:file 語法描述您對程式碼庫所做的最近變更}

## Learnings
{描述您學到的重要事項 - 例如模式、錯誤的根本原因，或其他接手您工作的人應該知道的重要資訊。考慮列出明確的檔案路徑。}

## Artifacts
{您產生或更新的工件的詳盡清單，以檔案路徑和/或 file:line 引用表示 - 例如功能文件、實作計畫等的路徑，這些應該被閱讀以恢復您的工作。}

## Action Items & Next Steps
{根據您的任務及其狀態，為下一個代理列出行動項目和後續步驟}

## Other Notes
{其他註記、參考或有用資訊 - 例如程式碼庫的相關部分在哪裡、相關文件在哪裡，或您想要傳遞但不屬於上述類別的其他重要事項}
```
---

### 3. 核准並同步
執行 `humanlayer thoughts sync` 以儲存文件。

完成後，您應該使用 <template_response></template_response> XML 標籤之間的範本回覆使用者。請勿在回應中包含標籤。

<template_response>
交接文件已建立並同步！您可以使用以下指令在新會話中從此交接文件恢復：

```bash
/resume_handoff path/to/handoff.md
```
</template_response>

例如（在 <example_response></example_response> XML 標籤之間 - 請勿在實際回應使用者時包含這些標籤）

<example_response>
交接文件已建立並同步！您可以使用以下指令在新會話中從此交接文件恢復：

```bash
/resume_handoff thoughts/shared/handoffs/ENG-2166/2025-01-08_13-44-55_ENG-2166_create-context-compaction.md
```
</example_response>

---
## 其他注意事項與指示
- **資訊要多不要少**。這是定義交接文件最低要求的指南。如有必要，請隨時包含更多資訊。
- **要徹底且精確**。根據需要包含高層級目標和低層級細節。
- **避免過多的程式碼片段**。雖然簡短的程式碼片段對於描述某些關鍵變更很重要，但請避免大型程式碼區塊或 diff；除非必要（例如與您正在除錯的錯誤有關），否則不要包含。建議使用 `/path/to/file.ext:line` 引用，代理可以在準備好時稍後跟進，例如 `packages/dashboard/src/app/dashboard/page.tsx:12-24`
