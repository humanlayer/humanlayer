# Claude Code Go SDK (實驗性)

一個用於與 Claude Code（Anthropic 的 AI 編程助手）進行程式化互動的 Go SDK。

## 安裝

```bash
go get github.com/humanlayer/humanlayer/claudecode-go
```

## 前置需求

- 必須安裝 Claude Code CLI 並可在您的 PATH 中使用
- 已設定有效的 Anthropic API 金鑰

## 快速開始

```go
package main

import (
    "fmt"
    "log"

    claudecode "github.com/humanlayer/humanlayer/claudecode-go"
)

func main() {
    // Create client
    client, err := claudecode.NewClient()
    if err != nil {
        log.Fatal(err)
    }

    // Run a simple query
    result, err := client.LaunchAndWait(claudecode.SessionConfig{
        Query: "Write a hello world function in Go",
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(result.Result)
}
```

## 串流範例

```go
// Launch with streaming output
session, err := client.Launch(claudecode.SessionConfig{
    Query:        "Build a REST API",
    Model:        claudecode.ModelSonnet,
    OutputFormat: claudecode.OutputStreamJSON,
})

// Process events as they arrive
for event := range session.Events {
    switch event.Type {
    case "assistant":
        fmt.Println("Claude:", event.Message.Content[0].Text)
    case "result":
        fmt.Printf("Done! Cost: $%.4f\n", event.Result.CostUSD)
    }
}
```

## MCP 整合

```go
// Configure MCP servers
mcpConfig := &claudecode.MCPConfig{
    MCPServers: map[string]claudecode.MCPServer{
        "approvals": {
            Command: "npx",
            Args:    []string{"humanlayer", "mcp", "claude_approvals"},
        },
    },
}

// Launch with approval handling
session, err := client.Launch(claudecode.SessionConfig{
    Query:                "Deploy to production",
    MCPConfig:            mcpConfig,
    PermissionPromptTool: "mcp__approvals__request_permission",
    AllowedTools:         []string{"mcp__approvals__*"},
})
```

## 功能特色

- **型別安全設定** - 使用 Go 結構體建立設定
- **串流支援** - 即時事件處理
- **MCP 整合** - 新增核准工作流程和自訂工具
- **會話管理** - 恢復先前的對話
- **程序控制** - 完全控制 Claude 子程序

## 輸出格式

- `OutputText` - 純文字輸出（預設）
- `OutputJSON` - 帶有中繼資料的結構化 JSON
- `OutputStreamJSON` - 即時串流 JSON 事件

## 設定選項

```go
type SessionConfig struct {
    // Core
    Query     string
    SessionID string // Resume existing session

    // Model
    Model Model // ModelOpus, ModelSonnet, or ModelHaiku

    // Output
    OutputFormat OutputFormat

    // MCP
    MCPConfig            *MCPConfig
    PermissionPromptTool string

    // Control
    MaxTurns           int
    WorkingDir         string
    SystemPrompt       string
    AppendSystemPrompt string
    AllowedTools       []string
    DisallowedTools    []string
    Verbose            bool
}
```

## 錯誤處理

SDK 提供詳細的錯誤資訊：

```go
result, err := client.LaunchAndWait(config)
if err != nil {
    // Handle launch/execution errors
    log.Fatal(err)
}

if result.IsError {
    // Handle Claude-reported errors
    fmt.Printf("Error: %s\n", result.Error)
}
```

## 與 HumanLayer 整合

此 SDK 與 HumanLayer 的核准工作流程無縫整合：

1. 在您的 MCPConfig 中設定 HumanLayer MCP 伺服器
2. 設定適當的權限提示工具
3. 透過 HumanLayer 的 TUI 或 API 處理核准

## 授權

MIT
