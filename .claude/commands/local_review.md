---
description: 設定工作樹以審查同事的分支
---

# 本地審查

你的任務是為同事的分支設定本地審查環境。這涉及建立工作樹、設定相依性，以及啟動新的 Claude Code 會話。

## 流程

當使用類似 `gh_username:branchName` 的參數呼叫時：

1. **解析輸入**：
   - 從格式 `username:branchname` 擷取 GitHub 使用者名稱和分支名稱
   - 如果未提供參數，以格式要求：`gh_username:branchName`

2. **擷取工作項目資訊**：
   - 在分支名稱中尋找工作項目編號（例如：`eng-1696`、`ENG-1696`）
   - 使用此資訊建立簡短的工作樹目錄名稱
   - 如果找不到工作項目，使用清理過的分支名稱版本

3. **設定遠端和工作樹**：
   - 使用 `git remote -v` 檢查遠端是否已存在
   - 如果不存在，新增它：`git remote add USERNAME git@github.com:USERNAME/humanlayer`
   - 從遠端擷取：`git fetch USERNAME`
   - 建立工作樹：`git worktree add -b BRANCHNAME ~/wt/humanlayer/SHORT_NAME USERNAME/BRANCHNAME`

4. **設定工作樹**：
   - 複製 Claude 設定：`cp .claude/settings.local.json WORKTREE/.claude/`
   - 執行設定：`make -C WORKTREE setup`
   - 初始化想法：`cd WORKTREE && humanlayer thoughts init --directory humanlayer`

## 錯誤處理

- 如果工作樹已存在，通知使用者需要先移除它
- 如果遠端擷取失敗，檢查使用者名稱/儲存庫是否存在
- 如果設定失敗，提供錯誤但繼續啟動

## 使用範例

```
/local_review samdickson22:sam/eng-1696-hotkey-for-yolo-mode
```

這將：
- 新增 'samdickson22' 作為遠端
- 在 `~/wt/humanlayer/eng-1696` 建立工作樹
- 設定環境
