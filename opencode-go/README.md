# OpenCode Go SDK (Experimental)

A Go SDK for programmatically interacting with OpenCode CLI.

## Installation

```bash
go get github.com/humanlayer/humanlayer/opencode-go
```

## Prerequisites

- OpenCode CLI must be installed and available in your PATH
- Valid API key configured for your chosen provider (Anthropic, OpenAI, etc.)

## Quick Start

```go
package main

import (
    "fmt"
    "log"

    opencode "github.com/humanlayer/humanlayer/opencode-go"
)

func main() {
    // Create client
    client, err := opencode.NewClient()
    if err != nil {
        log.Fatal(err)
    }

    // Run a simple query
    result, err := client.LaunchAndWait(opencode.SessionConfig{
        Query: "Write a hello world function in Go",
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
session, err := client.Launch(opencode.SessionConfig{
    Query:      "Build a REST API",
    Model:      "anthropic/claude-sonnet-4-20250514",
    WorkingDir: "/path/to/project",
})
if err != nil {
    log.Fatal(err)
}

// Process events as they arrive
for event := range session.Events {
    switch event.Type {
    case "text":
        if event.PartData != nil {
            fmt.Print(event.PartData.Text)
        }
    case "tool_use":
        if event.PartData != nil {
            fmt.Printf("\n[Tool: %s]\n", event.PartData.Tool)
        }
    case "step_finish":
        if event.PartData != nil {
            fmt.Printf("\n[Cost: $%.4f]\n", event.PartData.Cost)
        }
    }
}

// Wait for completion
result, err := session.Wait()
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Total cost: $%.4f\n", result.TotalCost)
```

## Features

- **Type-safe configuration** - Build configurations with Go structs
- **Streaming support** - Real-time NDJSON event processing
- **Session management** - Resume previous conversations
- **Process control** - Full control over OpenCode subprocess
- **Multi-provider** - Works with any model provider supported by OpenCode

## Event Types

OpenCode streams events in NDJSON format:

- `step_start` - Beginning of a new step
- `text` - Text content from the assistant
- `tool_use` - Tool invocation with status updates
- `step_finish` - Step completion with cost/token info

## Configuration Options

```go
type SessionConfig struct {
    // Core
    Query      string
    SessionID  string // Resume existing session
    Title      string // Session title

    // Model (format: provider/model)
    Model Model // e.g., "anthropic/claude-sonnet-4-20250514"

    // Agent
    Agent string // Custom agent to use

    // Working directory
    WorkingDir string

    // Files to attach
    Files []string

    // Continue last session
    ContinueLast bool

    // Environment variables
    Env map[string]string
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
    // Handle OpenCode-reported errors
    fmt.Printf("Error: %s\n", result.Error)
}
```

## Integration with HumanLayer

This SDK integrates with HumanLayer for multi-provider support:

1. Use the provider abstraction layer in `hld/provider`
2. Configure approval workflows through HumanLayer's TUI or API
3. Works alongside Claude Code for flexible tool choices

## CLI Reference

The SDK wraps the `opencode run` command:

```bash
opencode run --format json "your query"
```

Key flags:
- `--format json` - Output streaming JSON events
- `--session <id>` - Resume a specific session
- `--continue` - Continue the last session
- `--model <provider/model>` - Specify the model
- `--agent <name>` - Use a custom agent
- `--file <path>` - Attach files

## License

MIT
