
---
description: 為計畫建立 worktree 並啟動實作會話
---

2. 為實作設定 worktree：
2a. 讀取 `hack/create_worktree.sh` 並使用 Linear 分支名稱建立新的 worktree：`./hack/create_worktree.sh ENG-XXXX BRANCH_NAME`

3. 確定所需資料：

branch name
path to plan file (use relative path only)
launch prompt
command to run

**重要路徑使用規則：**
- thoughts/ 目錄在主儲存庫和 worktree 之間同步
- 務必僅使用以 `thoughts/shared/...` 開頭的相對路徑，不要加入任何目錄前綴
- 範例：`thoughts/shared/plans/fix-mcp-keepalive-proper.md`（不是完整的絕對路徑）
- 這樣做有效是因為 thoughts 已同步且可從 worktree 存取

3a. 向人類發送訊息以確認

```
根據輸入，我計畫使用以下詳細資訊建立 worktree：

worktree path: ~/wt/humanlayer/ENG-XXXX
branch name: BRANCH_NAME
path to plan file: $FILEPATH
launch prompt:

    /implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link

command to run:

    humanlayer launch --model opus -w ~/wt/humanlayer/ENG-XXXX "/implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link"
```

納入任何使用者回饋，然後：

4. 啟動實作會話：`humanlayer launch --model opus -w ~/wt/humanlayer/ENG-XXXX "/implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link"`
