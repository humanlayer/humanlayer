---
description: 實作後為實驗性功能建立 Linear 票證和 PR
---

您正在處理一個實驗性功能，該功能尚未完成適當的票證和 PR 設定。

假設您剛剛建立了一個 commit，以下是後續步驟：


1. 取得您剛建立的 commit 的 sha（如果您還沒建立，請閱讀 `.claude/commands/commit.md` 並建立一個）

2. 閱讀 `.claude/commands/linear.md` - 深入思考您剛實作的內容，然後建立一個關於您剛完成工作的 linear 票證，並將其設為「in dev」狀態 - 它應該有 ### 標題「problem to solve」和「proposed solution」
3. 取得票證以獲得建議的 git 分支名稱
4. git checkout main
5. git checkout -b 'BRANCHNAME'
6. git cherry-pick 'COMMITHASH'
7. git push -u origin 'BRANCHNAME'
8. gh pr create --fill
9. 閱讀 '.claude/commands/describe_pr.md' 並遵循指示
