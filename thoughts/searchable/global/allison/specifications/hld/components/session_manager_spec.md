---
component_name: SessionManager
component_type: service
location: hld/session/
analyzed_date: 2025-06-26
dependencies: [store.Store, bus.EventBus, claudecode.ClaudeCode]
dependents: [daemon.Daemon, rpc.Server]
test_coverage: 80
---

# Session Manager Component Specification

## Overview

**Purpose**: Manages Claude Code session lifecycle, state transitions, and conversation history
**Responsibility**: Launch sessions, track state, handle continuations, and maintain parent-child relationships
**Location**: `hld/session/manager.go`

## Public API

### Exported Types

#### `Manager`

**Purpose**: Manages all Claude Code sessions and their lifecycle

**Constructor**:
```go
func NewManager(logger *slog.Logger, store store.Store, eventBus *bus.EventBus) (*Manager, error)
```

#### `Session`

**Purpose**: Represents a Claude Code session

**Fields**:
```go
type Session struct {
    ID                string     // Unique session ID
    RunID             string     // Associated run ID
    ClaudeSessionID   string     // Claude's session ID
    ParentSessionID   *string    // Parent session for continuations
    Status            string     // Session status
    Query             string     // Initial query
    Summary           string     // Session summary
    Model             string     // Claude model used
    WorkingDir        string     // Working directory
    CreatedAt         time.Time  // Creation timestamp
    LastActivityAt    time.Time  // Last activity timestamp
    CompletedAt       *time.Time // Completion timestamp
    ErrorMessage      string     // Error message if failed
    CostUSD           float64    // Cost in USD
    TotalTokens       int        // Total tokens used
    DurationMS        int64      // Duration in milliseconds
}
```

### Exported Methods

##### `LaunchSession(ctx context.Context, params LaunchParams) (*Session, error)`
- **Purpose**: Launch a new Claude Code session
- **Parameters**:
  - `ctx`: Context for cancellation
  - `params`: Launch parameters including query, model, MCP config
- **Returns**: Created session and error
- **File Reference**: `hld/session/manager.go:142`

##### `ContinueSession(ctx context.Context, parentSessionID string, params ContinueParams) (*Session, error)`
- **Purpose**: Continue an existing session with new query
- **Parameters**:
  - `ctx`: Context
  - `parentSessionID`: ID of session to continue from
  - `params`: Continuation parameters
- **Returns**: New session continuing from parent
- **File Reference**: `hld/session/manager.go:267`

##### `GetSession(ctx context.Context, sessionID string) (*Session, error)`
- **Purpose**: Retrieve session by ID
- **Parameters**:
  - `ctx`: Context
  - `sessionID`: Session ID
- **Returns**: Session details or error
- **File Reference**: `hld/session/manager.go:376`

##### `ListSessions(ctx context.Context) ([]*Session, error)`
- **Purpose**: List all sessions
- **Parameters**: Context only
- **Returns**: Array of sessions
- **File Reference**: `hld/session/manager.go:390`

##### `InterruptSession(ctx context.Context, sessionID string) error`
- **Purpose**: Interrupt a running session
- **Parameters**:
  - `ctx`: Context
  - `sessionID`: Session to interrupt
- **Returns**: Error if interrupt fails
- **File Reference**: `hld/session/manager.go:404`

##### `WaitForSessionStart(ctx context.Context, sessionID string, timeout time.Duration) error`
- **Purpose**: Wait for session to start (get Claude session ID)
- **Parameters**:
  - `ctx`: Context
  - `sessionID`: Session to wait for
  - `timeout`: Maximum wait time
- **Returns**: Error if timeout or failure
- **File Reference**: `hld/session/manager.go:451`

##### `GetConversation(ctx context.Context, sessionID, claudeSessionID string) ([]*ConversationEvent, error)`
- **Purpose**: Get conversation history
- **Parameters**:
  - `ctx`: Context
  - `sessionID`: HLD session ID (optional)
  - `claudeSessionID`: Claude session ID (optional)
- **Returns**: Array of conversation events
- **File Reference**: `hld/session/manager.go:484`

##### `RecordUserMessage(ctx context.Context, sessionID, claudeSessionID string, sequence int, content string) error`
- **Purpose**: Record a user message in conversation
- **File Reference**: `hld/session/manager.go:502`

##### `RecordAssistantMessage(ctx context.Context, sessionID, claudeSessionID string, sequence int, content string) error`
- **Purpose**: Record an assistant message
- **File Reference**: `hld/session/manager.go:519`

##### `RecordToolCall(ctx context.Context, sessionID, claudeSessionID, toolID, toolName string, sequence int, inputJSON string) error`
- **Purpose**: Record a tool call request
- **File Reference**: `hld/session/manager.go:539`

##### `RecordToolResult(ctx context.Context, sessionID, claudeSessionID, toolID string, sequence int, content string, isError bool) error`
- **Purpose**: Record a tool execution result
- **File Reference**: `hld/session/manager.go:559`

## Internal Implementation

### Private Functions

#### `generateSessionID() string`
- **Purpose**: Generate unique session ID with prefix
- **Algorithm**: "sess_" + UUID v4

#### `pollForClaudeSessionID(ctx context.Context, sessionID string)`
- **Purpose**: Background polling for Claude session ID
- **Algorithm**: Polls ClaudeCode API until session ID available

#### `monitorSession(ctx context.Context, session *Session)`
- **Purpose**: Monitor session lifecycle and update status
- **Algorithm**: Tracks Claude process, updates status, calculates costs

#### `updateSessionStatus(sessionID, newStatus string) error`
- **Purpose**: Update session status and emit events
- **Algorithm**: Database update + event bus notification

#### `cleanupOrphanedSessions() error`
- **Purpose**: Mark orphaned sessions as failed on startup
- **Algorithm**: Find running/starting sessions and mark as failed

### Design Patterns

- **Pattern Used**: Repository + Service Layer
- **Rationale**: Separation of data access and business logic
- **Implementation Details**: Store handles persistence, Manager handles logic

## State Management

### Session States
- `starting`: Initial state, waiting for Claude session ID
- `running`: Active session processing
- `waiting_input`: Waiting for approval/human input
- `completed`: Successfully finished
- `failed`: Error occurred

### State Transitions
```
starting → running → completed
   ↓         ↓         
 failed   waiting_input → running
              ↓
           failed
```

## Error Handling

### Error Types
- Session not found errors
- State transition errors
- ClaudeCode launch failures
- Database errors

### Recovery Strategies
- Orphaned session cleanup on startup
- Automatic status updates on failures
- Graceful handling of missing Claude session IDs

## Configuration

### Session Configuration
- Model selection (opus/sonnet)
- Working directory
- MCP server configuration
- Tool allow/deny lists
- Custom instructions
- System prompts

## Performance Characteristics

- **Session Launch**: 1-5 seconds typical
- **Status Polling**: 500ms intervals
- **Conversation Retrieval**: O(n) with n events
- **Memory Usage**: ~1KB per session + conversation

## Testing

### Test Coverage
- Unit Tests: 80% coverage
- Integration Tests: Database operations

### Key Test Scenarios
1. Session lifecycle (start → complete)
2. Parent-child session relationships
3. Concurrent session management
4. Orphaned session cleanup
5. Status transition validation
6. Conversation recording and retrieval

### Test File Location
- Unit tests: `hld/session/manager_test.go`
- Integration tests: `hld/session/manager_*_test.go`

## Security Considerations

- **Session Isolation**: Each session has unique ID
- **Permission Inheritance**: Child sessions inherit parent permissions
- **Query Injection**: Protected via parameterized queries
- **Tool Restrictions**: Allow/deny lists enforced

## Future Considerations

- **Scalability**: Handle 100s of concurrent sessions
- **Features**: Session templates, batch operations
- **Optimizations**: Conversation pagination

## Code Examples

### Launch Session
```go
params := LaunchParams{
    Query: "Help me build a REST API",
    Model: "opus",
    MCPConfig: map[string]interface{}{
        "servers": map[string]interface{}{
            "filesystem": map[string]interface{}{
                "command": "npx",
                "args": []string{"-y", "@modelcontextprotocol/server-filesystem", "/tmp"},
            },
        },
    },
    WorkingDir: "/home/user/project",
}

session, err := manager.LaunchSession(ctx, params)
```

### Continue Session
```go
params := ContinueParams{
    Query: "Now add authentication",
    SystemPrompt: "Focus on security best practices",
}

newSession, err := manager.ContinueSession(ctx, parentSessionID, params)
```

## Related Documentation

- Store Interface: [`../store_spec.md`](../store_spec.md)
- Event Bus: [`../event_bus_spec.md`](../event_bus_spec.md)
- API Documentation: [`../../interfaces/json_rpc_api.md`](../../interfaces/json_rpc_api.md)