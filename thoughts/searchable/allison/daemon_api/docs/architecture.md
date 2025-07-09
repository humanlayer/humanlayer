# HLD Architecture Overview

## Current State Analysis

After analyzing the codebase, here's what the daemon actually does:

1. **Process Management**: Launches and monitors Claude Code sessions using `claudecode-go`
2. **State Storage**: Stores all session data, conversations, and events in SQLite
3. **Approval Integration**: Polls HumanLayer cloud API and correlates approvals with tool calls
4. **Event Distribution**: Provides real-time updates via event bus
5. **Client API**: JSON-RPC interface for TUI/CLI/WUI clients

## Key Design Principles

### Simple Context with Optional Schema

The context system is designed to be simple by default:

- Context is a string (e.g., file contents) by default
- Optional schema for structured data when needed
- Schema returned alongside context in GET responses
- Clients can handle both simple strings and complex objects

### Server-Side Enrichment

Approvals are enriched after creation:

- POST creates minimal approval record
- Daemon enriches based on tool type
- GET returns enriched approval with context
- Streaming supported for large contexts

## Recommended Architecture

### Context System Design

#### Simple String Context (Default)

```json
// GET /api/v1/approvals/{id}
{
  "id": "abc123",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/src/main.go",
    "old_string": "foo",
    "new_string": "bar"
  },
  "context": "package main\n\nimport \"fmt\"\n\nfunc main() {\n    fmt.Println(\"foo\")\n}",
  "context_type": "string"
}
```

#### Structured Context with Schema

```json
// GET /api/v1/approvals/{id}
{
  "id": "xyz789",
  "tool_name": "MultiEdit",
  "tool_input": { ... },
  "context": {
    "files": [
      {
        "path": "/src/main.go",
        "content": "...",
        "language": "go"
      }
    ],
    "metadata": {
      "total_edits": 5,
      "affected_lines": 42
    }
  },
  "context_type": "object",
  "context_schema": {
    "type": "object",
    "properties": {
      "files": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "content": { "type": "string" },
            "language": { "type": "string" }
          }
        }
      },
      "metadata": {
        "type": "object",
        "properties": {
          "total_edits": { "type": "integer" },
          "affected_lines": { "type": "integer" }
        }
      }
    }
  }
}
```

### API Flow

1. **MCP Server Creates Approval**

   ```
   POST /api/v1/approvals
   {
     "session_id": "...",
     "tool_name": "Edit",
     "tool_input": { ... }
   }
   Response: { "id": "abc123" }
   ```

2. **Daemon Checks Auto-Approval Rules**

   - Checks session settings (auto_accept_edits)
   - Checks `.claude/settings.local.json`
   - If auto-approved → return immediately
   - If not → create approval and enrich

3. **Daemon Enriches Approval**

   - Detects tool type
   - Reads file contents
   - Stores as string or structured data

4. **Client Gets Enriched Approval**

   ```
   GET /api/v1/approvals/abc123
   Response includes context + optional schema
   ```

5. **Client Sends Decision**

   ```typescript
   // Simple approval
   PUT /api/v1/approvals/abc123/decide
   {
     "decision": "approve"
   }

   // Approval with modifications
   {
     "decision": "approve",
     "response_data": {
       "updatedInput": { /* modified params */ },
       "save_rule": {
         "scope": "local",
         "pattern": "Edit"
       }
     },
     "response_type": "object",
     "response_schema": { /* schema */ }
   }
   ```

6. **Daemon Processes Decision**
   - If `save_rule` present → update `.claude/settings.local.json`
   - Return appropriate response to MCP server
   - MCP formats for Claude Code (`behavior: "allow"`, etc.)

### Streaming Support

For large contexts, OpenAPI supports streaming via:

```yaml
# Stream large file contents
GET /api/v1/approvals/{id}/context/stream
Content-Type: text/event-stream

event: context_chunk
data: {"chunk": "file content part 1...", "index": 0}

event: context_chunk
data: {"chunk": "file content part 2...", "index": 1}

event: context_complete
data: {"total_chunks": 2, "total_size": 102400}
```

## Technical Decisions

### 1. **API Protocol: REST + OpenAPI**

- Enables type-safe client generation
- Works for local, self-hosted, and cloud scenarios
- Industry standard with great tooling

### 2. **Events: Server-Sent Events (SSE)**

- Simple unidirectional streaming
- Auto-reconnect built-in
- Works everywhere (including mobile)
- Defined in OpenAPI 3.1 spec

### 3. **Context System**

- String by default for simplicity
- JSON Schema for complex contexts
- Server-side enrichment
- Streaming for large data

### 4. **Cloud Sync: HTTP/2 Long Polling**

- No WebSockets (avoid protocol split)
- Efficient connection reuse
- NAT-friendly (outbound only)

## Auto-Approval System

### Rule Hierarchy

1. **Session Settings** (highest priority)

   - `auto_accept_edits`: true/false
   - `auto_accept_patterns`: ["Write", "Edit"]
   - Temporary, session-specific

2. **Local Project Rules**

   - `.claude/settings.local.json`
   - Git-ignored, personal preferences
   - Pattern matching for tools

3. **User Settings**

   - `~/.claude/settings.json`
   - Applies to all projects
   - Shared across sessions

4. **CLI Flags** (passed at launch)
   - `--allowedTools`
   - `--disallowedTools`
   - Stored in session config

### Session Settings Management

```typescript
// Toggle auto-accept edits (like shift+tab)
POST /api/v1/sessions/{id}/settings
{
  "auto_accept_edits": true
}

// Add temporary patterns
{
  "auto_accept_patterns": [
    "Write",
    "Edit",
    "Bash(npm test:*)"
  ]
}
```

## Migration Path

### Step 1: Add REST API to daemon

```go
// Add alongside existing JSON-RPC
r := chi.NewRouter()
r.Use(cors.AllowAll())
r.Mount("/api/v1", api.NewRouter(daemon))
```

### Step 2: Implement SSE endpoint

```go
// Real-time events
r.Get("/api/v1/events", api.HandleSSE)
```

### Step 3: Implement approval rules

```go
// Check rules before creating approval
if daemon.ShouldAutoApprove(toolName, session) {
  return &ApprovalResponse{Approved: true}
}
```

### Step 4: Update MCP server in hlyr

```typescript
// Update existing hlyr MCP server to use REST
// hlyr/src/mcp.ts
class HumanLayerMCPServer {
  async request_permission(tool_name, input) {
    // Switch from JSON-RPC to REST
    const approval = await fetch('/api/v1/approvals', {
      method: 'POST',
      body: JSON.stringify({ tool_name, input, session_id }),
    })

    // Wait for decision via SSE
    const decision = await this.waitForDecision(approval.id)

    // Format for Claude Code
    return {
      behavior: decision.approved ? 'allow' : 'deny',
      updatedInput: decision.updatedInput || input,
    }
  }
}
```

## Response Schemas

### Edit Tool Response

```json
{
  "decision": "approve",
  "response_data": {
    "updatedInput": {
      "file_path": "/src/main.go",
      "old_string": "foo",
      "new_string": "bar fixed" // User modified
    },
    "save_rule": {
      "scope": "local",
      "pattern": "Edit(/src/*.go)"
    }
  },
  "response_type": "object",
  "response_schema": {
    "type": "object",
    "properties": {
      "updatedInput": {
        "type": "object",
        "properties": {
          "file_path": { "type": "string" },
          "old_string": { "type": "string" },
          "new_string": { "type": "string" }
        }
      },
      "save_rule": {
        "type": "object",
        "properties": {
          "scope": { "type": "string", "enum": ["local", "user", "global"] },
          "pattern": { "type": "string" }
        }
      }
    }
  }
}
```

### Bash Tool Response

```json
{
  "decision": "approve",
  "response_data": {
    "updatedInput": {
      "command": "npm test --coverage" // Added flag
    },
    "save_rule": {
      "scope": "local",
      "pattern": "Bash(npm test:*)"
    }
  }
}
```

## Why This Approach?

1. **Preserves Working Code**: Go daemon continues to work
2. **Enables New Features**: Modified approvals, auto-accept rules
3. **Unified Protocol**: REST everywhere
4. **Progressive Enhancement**: Add features incrementally
5. **Type Safety**: OpenAPI with schema-based responses

## Future: Cloud-Hosted Daemons

The beauty of this REST API design is that it works identically whether the daemon runs locally or in the cloud:

```typescript
// Local daemon
const daemon = new DaemonAPI('http://localhost:7777')

// Cloud-hosted daemon
const daemon = new DaemonAPI('https://api.humanlayer.dev/daemons/abc123')

// The exact same code works for both:
const approval = await daemon.getApproval(approvalId)
await daemon.decideApproval(approvalId, decision)
```

This enables us to:

- Start with local daemons (privacy, low latency)
- Move to cloud when needed (team collaboration, managed infrastructure)
- Keep the same client code and integrations
- Scale from individual developers to enterprise teams

The implementation details (SQLite vs PostgreSQL, local files vs cloud storage) are hidden behind the API contract. This is why OpenAPI was the right choice - it's not just about today, it's about building a foundation that scales.

## Next Steps

1. Implement REST API endpoints in daemon
2. Add SSE for events
3. Build approval rules engine
4. Update hlyr MCP server to use REST
5. Implement schema-based responses
6. Add context enrichment pipeline
