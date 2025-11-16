# Linear CLI

用於與 Linear 問題追蹤互動的命令列介面。

## 功能特色

- 列出您主動指派的問題（`list-issues`）
- 檢視問題詳細資訊和評論（`get-issue`）
- 在問題中新增評論（`add-comment`）
- 從問題下載所有圖片（`fetch-images`）
- 從 git 分支名稱自動偵測問題 ID
- 支援 fish、zsh 和 bash 的 Shell 自動完成
- 跨平台，支援多種 JavaScript 執行時期
- 智慧處理環境變數（僅在操作時需要 API 金鑰）

## 設定

1. 確保您有 Linear API 金鑰（實際操作需要，但說明/自動完成不需要）：
   ```
   export LINEAR_API_KEY=your_api_key
   ```

2. 安裝 CLI，從此目錄執行：
   ```
   npm install -g .
   ```

3. 或者，您可以手動將目錄新增到您的 PATH 或建立符號連結。

## 使用方式

```bash
# 列出您指派的主動問題（僅顯示未標記為完成/已取消的問題）
linear list-issues

# 檢視問題詳細資訊
linear get-issue ENG-123
# 或如果您的 git 分支包含問題 ID（例如 feature/ENG-123-something）
linear get-issue

# 在問題中新增評論（需要訊息作為第一個參數）
linear add-comment "This is my comment" --issue-id ENG-123  # Explicit ID
linear add-comment "This is my comment"  # Uses git branch auto-detection

# 從問題下載所有圖片至本機 thoughts 目錄
linear fetch-images ENG-123
```

### 擷取圖片

從 Linear 問題下載所有圖片至本機 thoughts 目錄：

```bash
linear fetch-images ENG-123
```

此命令：
- 下載嵌入在問題描述和評論中的所有圖片
- 將它們儲存至 `thoughts/shared/images/ENG-123/`
- 將檔案命名為 `ENG-123-01.png`、`ENG-123-02.jpg` 等
- 輸出已儲存檔案路徑清單（每行一個）
- 將進度訊息顯示至 stderr

輸出範例：
```
Downloaded 2 images:
thoughts/shared/images/ENG-123/ENG-123-01.png
thoughts/shared/images/ENG-123/ENG-123-02.jpg
```

### 新增評論需求

- 訊息為必需的第一個參數
- 問題 ID 可以是：
  - 從 git 分支名稱自動偵測（例如 `feature/ENG-123-something`）
  - 使用 `--issue-id` 或 `-i` 選項提供（例如 `-i ENG-123`）
- 如果兩者都不可用，工具將提示您使用其中一個選項

## Shell 自動完成

您也可以手動為您的 Shell 產生並安裝自動完成：

```bash
# Fish
linear completion --fish > ~/.config/fish/completions/linear.fish

# Zsh
mkdir -p ~/.zsh/completions
linear completion --zsh > ~/.zsh/completions/_linear
# Add to .zshrc: fpath=(~/.zsh/completions $fpath)
# Then: autoload -U compinit && compinit

# Bash
mkdir -p ~/.bash_completion.d
linear completion --bash > ~/.bash_completion.d/linear
# Add to .bashrc: source ~/.bash_completion.d/linear
```

## 需求

以下 JavaScript 執行時期之一：
- Bun（建議使用以獲得速度）
- Node.js 搭配 ts-node 或 tsx
- npm 搭配 npx

所需的 npm 套件（由 setup.sh 自動安裝）：
- @linear/sdk
- commander
- chalk
- inquirer

## 開發

複製儲存庫並安裝相依性：

```bash
cd hack/linear
bun install  # or npm install
```

### 檔案概述

- `linear-cli.ts` - 主要 CLI 實作
- `linear` - Shell 包裝腳本（偵測執行時期並執行 TypeScript）
- `setup.sh` - 安裝和設定協助程式
- `package.json` - 相依性和設定
- `tsconfig.json` - TypeScript 設定

## 更新您的 CLAUDE.md

您可能會發現在 `~/.claude/CLAUDE.md` 中新增註記很有幫助：

```md
## Linear
當被要求擷取 Linear 票證時，使用全域安裝的 Linear CLI：`linear get-issue ENG-XXXX > thoughts/shared/tickets/eng-XXXX.md`
```
