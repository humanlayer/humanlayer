---
description: 透過工作樹設定實作最高優先級的小型 Linear 工作項目
model: sonnet
---

## 第一部分 - 如果提到工作項目

0c. 使用 `linear` CLI 將所選項目擷取到想法中，包含工作項目編號 - ./thoughts/shared/tickets/ENG-xxxx.md
0d. 閱讀工作項目和所有留言以理解實作計畫和任何疑慮

## 第一部分 - 如果未提到工作項目

0.  閱讀 .claude/commands/linear.md
0a. 使用 MCP 工具從 linear 擷取狀態為「ready for dev」的前 10 個優先級項目，記錄 `links` 區段中的所有項目
0b. 從清單中選擇最高優先級的 SMALL 或 XS 問題（如果沒有 SMALL 或 XS 問題存在，立即退出並通知使用者）
0c. 使用 `linear` CLI 將所選項目擷取到想法中，包含工作項目編號 - ./thoughts/shared/tickets/ENG-xxxx.md
0d. 閱讀工作項目和所有留言以理解實作計畫和任何疑慮

## 第二部分 - 後續步驟

深入思考

1. 使用 MCP 工具將項目移至「in dev」
1a. 從 `links` 區段識別連結的實作計畫文件
1b. 如果沒有計畫存在，將工作項目移回「ready for spec」並退出並附上說明

深入思考實作

2. 設定實作的工作樹：
2a. 閱讀 `hack/create_worktree.sh` 並使用 Linear 分支名稱建立新工作樹：`./hack/create_worktree.sh ENG-XXXX BRANCH_NAME`
2b. 啟動實作會話：`humanlayer-nightly launch --model opus --dangerously-skip-permissions --dangerously-skip-permissions-timeout 15m --title "implement ENG-XXXX" -w ~/wt/humanlayer/ENG-XXXX "/implement_plan and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link"`

深入思考，使用 TodoWrite 追蹤你的任務。從 linear 擷取時，按優先級取得前 10 個項目，但只處理一個項目 - 特別是最高優先級的 SMALL 或 XS 大小的問題。
