---
description: 為最高優先級的 Linear 工作項目建立實作計畫（準備好規格）
---

## 第一部分 - 如果提到工作項目

0c. 使用 `linear` CLI 將所選項目擷取到想法中，包含工作項目編號 - ./thoughts/shared/tickets/ENG-xxxx.md
0d. 閱讀工作項目和所有留言以了解過去的實作和研究，以及任何關於它們的問題或疑慮


### 第一部分 - 如果未提到工作項目

0.  閱讀 .claude/commands/linear.md
0a. 使用 MCP 工具從 linear 擷取狀態為「ready for spec」的前 10 個優先級項目，記錄 `links` 區段中的所有項目
0b. 從清單中選擇最高優先級的 SMALL 或 XS 問題（如果沒有 SMALL 或 XS 問題存在，立即退出並通知使用者）
0c. 使用 `linear` CLI 將所選項目擷取到想法中，包含工作項目編號 - ./thoughts/shared/tickets/ENG-xxxx.md
0d. 閱讀工作項目和所有留言以了解過去的實作和研究，以及任何關於它們的問題或疑慮

### 第二部分 - 後續步驟

深入思考

1. 使用 MCP 工具將項目移至「plan in progress」
1a. 閱讀 ./claude/commands/create_plan.md
1b. 根據 `links` 區段確定該項目是否有連結的實作計畫文件
1d. 如果計畫存在，你已完成，回應工作項目的連結
1e. 如果研究不足或有未回答的問題，遵循 ./claude/commands/create_plan.md 中的指示建立新的計畫文件

深入思考

2. 當計畫完成時，執行 `humanlayer thoughts sync` 並使用 MCP 工具將文件附加到工作項目，並建立一個簡潔的留言並附上連結（如果需要，重新閱讀 .claude/commands/linear.md）
2a. 使用 MCP 工具將項目移至「plan in review」

深入思考，使用 TodoWrite 追蹤你的任務。從 linear 擷取時，按優先級取得前 10 個項目，但只處理一個項目 - 特別是最高優先級的 SMALL 或 XS 大小的問題。

### 第三部分 - 當你完成時


為使用者列印訊息（將佔位符替換為實際值）：

```
✅ 已完成 ENG-XXXX 的實作計畫：[工作項目標題]

方法：[所選方法描述]

計畫已經：

建立於 thoughts/shared/plans/YYYY-MM-DD-ENG-XXXX-description.md
同步到想法儲存庫
附加到 Linear 工作項目
工作項目已移至「plan in review」狀態

實作階段：
- 階段 1：[階段 1 描述]
- 階段 2：[階段 2 描述]
- 階段 3：[階段 3 描述（如適用）]

檢視工作項目：https://linear.app/humanlayer/issue/ENG-XXXX/[ticket-slug]
```
