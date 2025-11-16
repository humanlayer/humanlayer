# HumanLayer CLI

HumanLayer，在您的命令列上。

統一的 CLI 工具，提供：

- 從終端機或指令稿直接聯絡人類
- MCP（Model Context Protocol）伺服器功能
- 與 Claude Code SDK 整合的核准工作流程
- 開發者筆記和文件的思維管理系統

## 快速開始

### 使用 npx 直接執行

```bash
# Contact a human with a message
npx humanlayer contact_human -m "Need help with deployment approval"

# Or use the long form
npx humanlayer contact_human --message "Review this pull request"
```

### 設定

您可能會需要：

```bash
export HUMANLAYER_API_KEY=...
```

使用 CLI 旗標：

```bash
humanlayer contact_human --message "Review this pull request" --slack-channel "C08G5C3V552"
```

使用環境變數：

```bash
export HUMANLAYER_SLACK_CHANNEL=C08G5C3V552
humanlayer contact_human --message "Review this pull request"
```

or

```
export HUMANLAYER_EMAIL_ADDRESS=human@example.com
humanlayer contact_human --message "Review this pull request"
```

**注意：** 如果未設定聯絡頻道，HumanLayer 將預設使用網頁 UI 進行人類互動。

使用設定檔：

```bash
echo '
{
  "channel": {
    "slack": {
      "channel_or_user_id": "C08G5C3V552"
    }
  }
}
' > .hlyr.json
```

```bash
humanlayer contact_human --message "Review this pull request" --config-file .hlyr.json
```

### MCP 伺服器用法

啟動 MCP 伺服器以與 Claude Desktop 等 MCP 客戶端整合：

```bash
# Contact human functionality
humanlayer mcp serve

# Claude Code SDK approval integration
humanlayer mcp claude_approvals

# Debug MCP servers with inspector
humanlayer mcp inspector serve
humanlayer mcp inspector claude_approvals
```

### Claude Code SDK 整合

使用 Claude Code SDK 的自動化核准工作流程：

`mcp-config.json`:

```json
{
  "mcpServers": {
    "approvals": {
      "command": "npx",
      "args": ["-y", "humanlayer", "mcp", "claude_approvals"],
      "env": {
        "HUMANLAYER_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

```bash
claude --print "write hello world to a file" \
  --mcp-config mcp-config.json \
  --permission-prompt-tool mcp__approvals__request_permission
```

### 與 claude code 一起執行

```
claude --print "do some work" | npx humanlayer contact_human -m -
```

or

```bash
allowedTools='Write,Edit,Bash(grep:*)'
message="make me a file hello.txt with contents 'hello world'"

claude_answer=$(claude --print "$message" --allowedTools "$allowedTools")
while :; do
human_answer=$(echo "$claude_answer" | npx humanlayer contact_human -m -)
message="$human_answer"
claude_answer=$(claude --print "$message" --allowedTools "$allowedTools" --continue)
done
```

### 全域安裝

```bash
npm install -g hlyr

# Then use directly
humanlayer contact_human -m "Production database needs review"
```

## 指令

### `contact_human`

向人類傳送訊息並等待回應。

```bash
humanlayer contact_human -m "Your message here"
```

**選項：**

- `-m, --message <text>` - 要傳送的訊息（必填）

**範例：**

```bash
# Simple message
humanlayer contact_human -m "Please review the deployment logs"

# Multi-word message
humanlayer contact_human -m "The API is returning 500 errors, need immediate help"

# Using in scripts
#!/bin/bash
if [ $? -ne 0 ]; then
  humanlayer contact_human -m "Build failed, manual intervention needed"
fi
```

### `mcp`

Model Context Protocol 伺服器功能。

```bash
humanlayer mcp <subcommand>
```

**子指令：**

- `serve` - 啟動預設的 MCP 伺服器以提供 contact_human 功能
- `claude_approvals` - 啟動 Claude 核准 MCP 伺服器以處理權限請求
- `wrapper` - 將現有的 MCP 伺服器包裝為具有人類核准功能（尚未實作）
- `inspector [command]` - 執行 MCP 檢查器以除錯 MCP 伺服器（預設為 'serve'）

### `thoughts`

管理開發者思維和筆記，與程式碼儲存庫分開。

```bash
humanlayer thoughts <subcommand>
```

**子指令：**

- `init` - 為目前的儲存庫初始化思維
- `sync` - 手動同步思維並更新可搜尋索引
- `status` - 檢查思維設定的狀態
- `config` - 檢視或編輯思維設定

**範例：**

```bash
# Initialize thoughts for a new project
humanlayer thoughts init

# Sync thoughts after making changes
humanlayer thoughts sync -m "Updated architecture notes"

# Check status
humanlayer thoughts status

# View configuration
humanlayer thoughts config --json
```

思維系統將您的筆記與程式碼分開，同時讓 AI 助手可以輕鬆存取。詳細資訊請參閱 [Thoughts 文件](./THOUGHTS.md)。

### `claude`

管理 Claude Code 設定。

```bash
humanlayer claude <subcommand>
```

**子指令：**

- `init` - 在目前目錄中初始化 Claude Code 設定

**範例：**

```bash
# Initialize Claude Code configuration interactively
humanlayer claude init

# Copy all files without prompting
humanlayer claude init --all

# Force overwrite existing .claude directory
humanlayer claude init --force
```

#### 互動式選擇

`claude init` 指令提供具有方向鍵導航的互動式體驗：

- 使用 **↑↓** 方向鍵導航選項
- 按 **空白鍵** 切換選擇
- 按 **Enter** 確認您的選擇
- 隨時按 **Ctrl+C** 取消

#### 複製的內容

此指令會將 Claude Code 設定檔複製到專案的 `.claude` 目錄：

- **Commands**（30 個檔案）- 用於規劃、研究、CI、程式碼生成、測試等的工作流程指令
- **Agents**（6 個檔案）- 用於程式碼分析、除錯和架構審查的專用子代理
- **Settings**（1 個檔案）- 專案權限設定（`settings.local.json` 透過 `.gitignore` 排除）

#### 指令選項

- `--all` - 複製所有檔案而不提示（適用於 CI/CD 或自動化設定）
- `--force` - 無需確認即覆寫現有的 `.claude` 目錄

#### 非互動式模式

對於自動化環境（CI/CD、指令稿），使用 `--all` 旗標：

```bash
humanlayer claude init --all
```

如果不使用 `--all`，此指令需要互動式終端機，在非 TTY 環境中會以錯誤退出。

## 使用案例

- **CI/CD 管線**：在部署前取得人類核准
- **監控指令稿**：當自動檢查失敗時提醒人類
- **開發工作流程**：要求程式碼審查或架構決策
- **維運**：將需要人類判斷的問題升級

## 設定

hlyr 使用 HumanLayer 的設定系統。透過環境變數或設定檔設定聯絡頻道，如主要 [HumanLayer 文件](https://humanlayer.dev/docs)中所述。

## 開發

```bash
# Install dependencies
npm install

# Build the CLI
npm run build

# Run tests
npm test

# Watch mode during development
npm run dev
```

### 測試本地核准

若要在沒有 HumanLayer API 存取權限的情況下測試本地 MCP 核准系統，請參閱 [test_local_approvals.md](./test_local_approvals.md)。

## 授權

Apache-2.0
