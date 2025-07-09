# HumanLayer Daemon & TUI Architecture Analysis

## Executive Summary

After analyzing the daemon and TUI implementation, I've identified a critical architectural gap: the daemon receives rich streaming data from Claude Code sessions but discards 95% of it. This fundamental limitation prevents the TUI from evolving into a full Claude Code replacement. The good news is that the existing architecture supports the necessary enhancements without major refactoring.

## Key Files for Implementation

### Core Daemon Components

- [`hld/daemon/daemon.go`](hld/daemon/daemon.go) - Central orchestrator that initializes all subsystems; needs modification to wire up new event store
- [`hld/daemon/daemon_test.go`](hld/daemon/daemon_test.go) - Test suite ensuring daemon lifecycle; will need tests for new streaming capabilities

### Session Management (Critical for Changes)

- [`hld/session/manager.go`](hld/session/manager.go) - **Most important file** - Line 174 currently discards streaming data; needs complete overhaul of `monitorSession()`
- [`hld/session/types.go`](hld/session/types.go) - Session data structures; needs new `SessionEvent` types and `SessionEventStore` interface

### Event Bus System

- [`hld/bus/events.go`](hld/bus/events.go) - Event bus implementation; already solid, needs minor updates for new event types
- [`hld/bus/types.go`](hld/bus/types.go) - Event type definitions; needs new constants for session streaming events

### RPC Layer

- [`hld/rpc/server.go`](hld/rpc/server.go) - JSON-RPC server core; handles line-delimited JSON streaming
- [`hld/rpc/handlers.go`](hld/rpc/handlers.go) - Existing RPC handlers; needs new session streaming methods
- [`hld/rpc/subscription_handlers.go`](hld/rpc/subscription_handlers.go) - Subscription implementation; model for session-specific subscriptions

### Client Integration

- [`hld/client/client.go`](hld/client/client.go) - RPC client used by TUI; needs new methods for session event streaming
- [`humanlayer-tui/tui.go`](humanlayer-tui/tui.go) - Terminal UI; needs new views for session monitoring and tool execution logs

### Claude Code SDK Integration

- [`claudecode-go/types.go`](claudecode-go/types.go) - Defines `StreamEvent` structure showing all available data we're currently discarding
- [`claudecode-go/client.go`](claudecode-go/client.go) - Shows how to consume streaming events from Claude sessions

### MCP Integration

- [`hlyr/src/mcp.ts`](hlyr/src/mcp.ts) - MCP server that reads `HUMANLAYER_RUN_ID` for session-approval correlation

### Planning and Context Documents

- [`analysis.md`](analysis.md) - This analysis document with recommendations
- [`plan.md`](plan.md) - Original implementation plan showing evolution of the architecture
- [`thoughts/notes.md`](thoughts/notes.md) - Critical insights about pain points and missing features
- [`thoughts/quick_approval.md`](thoughts/quick_approval.md) - Product vision for "2-3 second approval cycles"

## Current State Assessment

### Architectural Strengths

1. **Clean Design Patterns**

   - Well-structured packages with clear separation of concerns ([`hld/daemon/`](hld/daemon/), [`hld/rpc/`](hld/rpc/), [`hld/session/`](hld/session/))
   - Interface-based design enabling testability and extensibility
   - Consistent use of Go idioms and best practices

2. **Solid Foundation**

   - Robust Unix socket RPC implementation ([`hld/rpc/server.go`](hld/rpc/server.go))
   - Event-driven architecture with pub/sub system ([`hld/bus/events.go`](hld/bus/events.go))
   - Graceful lifecycle management with context propagation

3. **Focused User Experience**
   - TUI excels at approval management with session context ([`humanlayer-tui/tui.go`](humanlayer-tui/tui.go))
   - Real-time updates via event subscriptions
   - Efficient keyboard-driven interface

### The Critical Gap: Lost Session Data

The Claude Code SDK provides extensive streaming events ([`claudecode-go/types.go`](claudecode-go/types.go)):

```go
type StreamEvent struct {
    Type    string      // "system", "assistant", "result"
    Subtype string      // "init", etc.
    // Rich data including:
    // - Assistant messages with content
    // - Tool usage details
    // - Token counts and costs
    // - MCP server status
}
```

However, the daemon's `monitorSession()` function ([`hld/session/manager.go:174`](hld/session/manager.go:174)) only captures the session ID:

```go
// Currently throws away all the rich event data
if event.SessionID != "" {
    s.claudeSessionID = event.SessionID
}
// Comment says: "Could store events for later retrieval if needed"
```

This means we're missing:

- Real-time Claude responses and thinking process
- Tool execution details (what files were edited, commands run)
- Token usage and cost accumulation
- MCP server connection status
- Intermediate results and progress indicators

## Architecture Recommendations

### 1. Session Event Streaming Infrastructure

Before implementing SQLite, we need to establish the data flow and structure:

#### Phase 1: Capture & Buffer (No Persistence)

```go
// New types in hld/session/types.go
type SessionEvent struct {
    SessionID   string
    RunID       string
    Timestamp   time.Time
    EventType   string    // assistant_message, tool_call, token_usage
    EventData   interface{} // Strongly typed based on EventType
}

type SessionEventStore interface {
    AddEvent(event SessionEvent) error
    GetEvents(sessionID string, offset, limit int) ([]SessionEvent, error)
    Subscribe(sessionID string) <-chan SessionEvent
}
```

#### Phase 2: Enhanced Event Bus

Add granular event types to [`hld/bus/types.go`](hld/bus/types.go):

```go
const (
    // Existing events
    EventNewApproval EventType = "new_approval"

    // New session streaming events
    EventSessionMessage EventType = "session_message"
    EventSessionToolCall EventType = "session_tool_call"
    EventSessionTokenUsage EventType = "session_token_usage"
    EventSessionMCPStatus EventType = "session_mcp_status"
)
```

### 2. Smart Subscription Patterns

Based on your feedback about subscriptions only when focused:

```go
// New RPC methods in hld/rpc/handlers.go
type SubscribeToSessionRequest struct {
    SessionID string
    EventTypes []string // Optional filter
}

// TUI implementation
func (m *model) focusSession(sessionID string) {
    // Subscribe only when entering session detail view
    m.sessionSub = m.daemonClient.SubscribeToSession(sessionID)
    go m.handleSessionEvents()
}

func (m *model) unfocusSession() {
    // Unsubscribe when leaving view
    if m.sessionSub != nil {
        m.sessionSub.Close()
    }
}
```

### 3. Data Structure Evolution

Start with in-memory circular buffers before SQLite:

```go
// In hld/session/event_store.go
type InMemoryEventStore struct {
    mu sync.RWMutex
    events map[string]*CircularBuffer // sessionID -> events
    maxEventsPerSession int // e.g., 10,000
}

type CircularBuffer struct {
    events []SessionEvent
    head   int
    tail   int
    size   int
}
```

This allows you to:

- Experiment with the data structure
- Understand access patterns
- Measure memory usage
- Prepare for SQLite migration

### 4. TUI Enhancements for Session Visibility

New views leveraging the streaming data:

#### Session Monitor View

```
┌─ Session: "Refactor auth system" ─────────────────────────────┐
│ Claude: I'll help you refactor the auth system. Let me first │
│ examine the current implementation...                          │
│                                                                │
│ 🔧 Reading file: src/auth.py                                  │
│ ✓ File read successfully (247 lines)                          │
│                                                                │
│ Claude: I see you're using session cookies. I'll update this │
│ to use JWT tokens for better security...                      │
│                                                                │
│ 🔧 Editing file: src/auth.py                                  │
│ ⏳ Awaiting approval...                                        │
│                                                                │
│ Tokens: 1,247 | Cost: $0.03 | Duration: 45s                   │
└────────────────────────────────────────────────────────────────┘
```

#### Tool Execution Log

```
┌─ Tool Calls ───────────────────────────────────────────────────┐
│ [12:34:15] read_file("src/auth.py") → Success                 │
│ [12:34:18] grep("JWT", "src/") → Found 3 matches              │
│ [12:34:22] edit_file("src/auth.py", ...) → Pending approval   │
│ [12:34:25] run_command("pytest tests/auth") → Denied          │
└────────────────────────────────────────────────────────────────┘
```

### 5. Implementation Roadmap

#### Stage 1: Data Capture (1-2 days)

1. Modify [`hld/session/manager.go`](hld/session/manager.go) to capture all streaming events
2. Implement circular buffer for in-memory storage
3. Add new event types to event bus

#### Stage 2: RPC Exposure (2-3 days)

1. Add `SubscribeToSession` RPC method
2. Add `GetSessionEvents` for historical data
3. Implement proper backpressure handling

#### Stage 3: TUI Integration (3-4 days)

1. Add session detail view with streaming updates
2. Implement focus-based subscription management
3. Add tool execution log view

#### Stage 4: SQLite Migration (Future)

Once data structure is stable:

1. Implement SQLite store with same interface
2. Add schema migrations
3. Configure retention policies

## Key Insights from Historical Context

Reading through [`plan.md`](plan.md), [`thoughts/notes.md`](thoughts/notes.md), and [`thoughts/quick_approval.md`](thoughts/quick_approval.md) reveals important context:

1. **Evolution of Understanding**: The team discovered Claude Code's streaming JSON format through experimentation, leading to the daemon architecture for session-approval correlation.

2. **Product Vision**: The goal is a "Quick Approval TUI" that enables rapid iteration - reducing approval time from 30-60 seconds to 2-3 seconds.

3. **Current Pain Points** (from notes.md):

   - TUI only shows final result, missing intermediate outputs
   - Session list lacks clear temporal ordering
   - No way to resume sessions in live view mode
   - Limited clipboard integration

4. **Strategic Approach**: "Build within current API constraints, only change after clear understanding of user needs"

## Technical Recommendations

### 1. Start with Event Capture

Before designing the SQLite schema, implement full event capture to understand:

- Event frequency and size
- Access patterns (sequential vs random)
- Retention requirements
- Query needs

### 2. Use Structured Event Types

Instead of generic `interface{}`, define concrete types:

```go
type AssistantMessageEvent struct {
    Content      string
    Model        string
    TokensUsed   TokenUsage
    StopReason   string
}

type ToolCallEvent struct {
    ToolName    string
    Parameters  json.RawMessage
    StartTime   time.Time
    EndTime     *time.Time
    Result      *string
    Error       *string
}
```

### 3. Implement Progressive Enhancement

- Stage 1: Show Claude's messages in real-time
- Stage 2: Add tool execution status
- Stage 3: Enable interactive features (pause/resume)
- Stage 4: Full session replay capability

### 4. Design for Future SQLite Migration

```go
// Design interfaces that work for both in-memory and SQLite
type EventStore interface {
    // Write path
    AppendEvent(sessionID string, event SessionEvent) error

    // Read paths
    GetEvents(sessionID string, filter EventFilter) ([]SessionEvent, error)
    GetEventStream(sessionID string, fromTimestamp time.Time) (<-chan SessionEvent, error)

    // Maintenance
    PruneOldEvents(before time.Time) error
}
```

## Conclusion

The daemon and TUI have excellent architectural foundations. The path to making the TUI a "full Claude Code replacement" is clear:

1. **Stop discarding the rich session data** - it's already there
2. **Implement smart, view-focused subscriptions** - only stream what's visible
3. **Build the data structure iteratively** - in-memory first, SQLite later
4. **Enhance the TUI progressively** - start with messages, add features incrementally

The key insight from [`thoughts/notes.md:27`](thoughts/notes.md:27) shows you already discovered the streaming JSON format. Now it's time to harness that data stream to create the responsive, context-rich development experience envisioned in the original quick approval concept.

With these changes, the TUI will transform from a simple approval interface into a powerful session management tool that provides the "fast feedback loops needed for real-time agent collaboration" described in your original vision.
