# Claude Code Go SDK

A Go SDK for programmatically interacting with Claude Code (Anthropic's AI coding assistant).

## Installation

```bash
go get github.com/humanlayer/humanlayer/claudecode-go
```

## Prerequisites

- Claude Code CLI must be installed and available in your PATH
- Valid Anthropic API key configured

## Quick Start

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
    
    // Run a simple prompt
    result, err := client.LaunchAndWait(claudecode.SessionConfig{
        Prompt: "Write a hello world function in Go",
    })
    if err != nil {
        log.Fatal(err)
    }
    
    fmt.Println(result.Result)
}
```

## Streaming Example

```go
// Launch with streaming output
session, err := client.Launch(claudecode.SessionConfig{
    Prompt:       "Build a REST API",
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

## MCP Integration

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
    Prompt:               "Deploy to production",
    MCPConfig:            mcpConfig,
    PermissionPromptTool: "mcp__approvals__request_permission",
    AllowedTools:         []string{"mcp__approvals__*"},
})
```

## Features

- **Type-safe configuration** - Build configurations with Go structs
- **Streaming support** - Real-time event processing
- **MCP integration** - Add approval workflows and custom tools
- **Session management** - Resume previous conversations
- **Process control** - Full control over Claude subprocess

## Output Formats

- `OutputText` - Plain text output (default)
- `OutputJSON` - Structured JSON with metadata
- `OutputStreamJSON` - Real-time streaming JSON events

## Configuration Options

```go
type SessionConfig struct {
    // Core
    Prompt    string
    SessionID string // Resume existing session
    
    // Model
    Model Model // ModelOpus or ModelSonnet
    
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

## Error Handling

The SDK provides detailed error information:

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

## Integration with HumanLayer

This SDK integrates seamlessly with HumanLayer for approval workflows:

1. Configure the HumanLayer MCP server in your MCPConfig
2. Set appropriate permission prompt tool
3. Handle approvals through HumanLayer's TUI or API

## License

MIT