---
description: 研究需要調查的最高優先級 Linear 工作項目
---

## 第一部分 - 如果提到 LINEAR 工作項目

0c. 使用 `linear` CLI 將所選項目擷取到想法中，包含工作項目編號 - ./thoughts/shared/tickets/ENG-xxxx.md
0d. 閱讀工作項目和所有留言以了解需要哪些研究以及任何先前的嘗試

## 第一部分 - 如果未提到工作項目

0.  閱讀 .claude/commands/linear.md
0a. 使用 MCP 工具從 linear 擷取狀態為「research needed」的前 10 個優先級項目，記錄 `links` 區段中的所有項目
0b. 從清單中選擇最高優先級的 SMALL 或 XS 問題（如果沒有 SMALL 或 XS 問題存在，立即退出並通知使用者）
0c. 使用 `linear` CLI 將所選項目擷取到想法中，包含工作項目編號 - ./thoughts/shared/tickets/ENG-xxxx.md
0d. 閱讀工作項目和所有留言以了解需要哪些研究以及任何先前的嘗試

## 第二部分 - 後續步驟

深入思考

1. 使用 MCP 工具將項目移至「research in progress」
1a. 閱讀 `links` 區段中的任何連結文件以了解上下文
1b. 如果資訊不足以進行研究，新增留言要求澄清並移回「research needed」

深入思考研究需求

2. 進行研究：
2a. 閱讀 .claude/commands/research_codebase.md 以獲取有效程式碼庫研究的指導
2b. 如果 linear 留言建議需要網路研究，使用 WebSearch 研究外部解決方案、API 或最佳實踐
2c. 在程式碼庫中搜尋相關的實作和模式
2d. 檢查現有的類似功能或相關程式碼
2e. 識別技術限制和機會
2f. 保持客觀 - 不要過度思考理想的實作計畫，只需記錄所有相關檔案以及系統今天的工作方式
2g. 在新的想法文件中記錄發現：`thoughts/shared/research/YYYY-MM-DD-ENG-XXXX-description.md`
   - 格式：`YYYY-MM-DD-ENG-XXXX-description.md`，其中：
     - YYYY-MM-DD 是今天的日期
     - ENG-XXXX 是工作項目編號（如果沒有工作項目則省略）
     - description 是研究主題的簡短 kebab-case 描述
   - 範例：
     - 有工作項目：`2025-01-08-ENG-1478-parent-child-tracking.md`
     - 無工作項目：`2025-01-08-error-handling-patterns.md`

深入思考發現

3. 將研究綜合成可操作的見解：
3a. 總結關鍵發現和技術決策
3b. 識別潛在的實作方法
3c. 記錄發現的任何風險或疑慮
3d. 執行 `humanlayer thoughts sync` 以儲存研究

4. 更新工作項目：
4a. 使用 MCP 工具將研究文件附加到工作項目，並使用正確的連結格式
4b. 新增留言總結研究結果
4c. 使用 MCP 工具將項目移至「research in review」

深入思考，使用 TodoWrite 追蹤你的任務。從 linear 擷取時，按優先級取得前 10 個項目，但只處理一個項目 - 特別是最高優先級的問題。

## 第三部分 - 當你完成時

為使用者列印訊息（將佔位符替換為實際值）：

```
✅ 已完成 ENG-XXXX 的研究：[工作項目標題]

研究主題：[研究主題描述]

研究已經：

建立於 thoughts/shared/research/YYYY-MM-DD-ENG-XXXX-description.md
同步到想法儲存庫
附加到 Linear 工作項目
工作項目已移至「research in review」狀態

關鍵發現：
- [主要發現 1]
- [主要發現 2]
- [主要發現 3]

檢視工作項目：https://linear.app/humanlayer/issue/ENG-XXXX/[ticket-slug]
```
