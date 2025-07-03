---
component_name: Data Models
component_type: model
location: hld/store/, hld/session/, hld/approval/
analyzed_date: 2025-06-26
dependencies: []
dependents: [all_components]
test_coverage: 95
---

# HLD Data Models and Entity Relationships

## Overview

This document describes the data models and entity relationships in the HumanLayer Daemon (hld). The system uses SQLite for persistence with a focus on event sourcing for conversation history.

## Core Entities

### 1. Session

**Purpose**: Represents a Claude Code session instance
**Table**: `sessions`

```go
type Session struct {
    ID                string      // Primary key: sess_<uuid>
    RunID             string      // Unique run identifier: run_<uuid>
    ClaudeSessionID   string      // Claude's session identifier
    ParentSessionID   *string     // Parent session for continuations
    Status            string      // Session state
    Query             string      // Initial user query
    Summary           string      // AI-generated summary
    Model             string      // Claude model used
    WorkingDir        string      // Working directory
    CreatedAt         time.Time   // Creation timestamp
    LastActivityAt    time.Time   // Last activity timestamp
    CompletedAt       *time.Time  // Completion timestamp
    ErrorMessage      string      // Error message if failed
    CostUSD           float64     // Cost in USD
    TotalTokens       int         // Total tokens used
    DurationMS        int64       // Duration in milliseconds
}
```

**States**: 
- `starting`: Initial state, waiting for Claude session ID
- `running`: Active session processing
- `waiting_input`: Blocked on approval/human input
- `completed`: Successfully finished
- `failed`: Error occurred

**Relationships**:
- Self-referential: `ParentSessionID` → `Session` (for continuations)
- One-to-many: Session → ConversationEvents
- One-to-many: Session → MCPServers

### 2. ConversationEvent

**Purpose**: Polymorphic event storage for conversation history
**Table**: `conversation_events`

```go
type ConversationEvent struct {
    ID                  int         // Auto-incrementing primary key
    SessionID           string      // Foreign key to sessions
    ClaudeSessionID     string      // Claude's session ID
    Sequence            int         // Order within conversation
    EventType           string      // Event discriminator
    CreatedAt           time.Time   // Event timestamp
    
    // Message fields (when EventType = "message")
    Role                string      // user, assistant, system
    Content             string      // Message content
    
    // Tool call fields (when EventType = "tool_call")
    ToolID              string      // Unique tool call ID
    ToolName            string      // Tool being called
    ToolInputJSON       string      // JSON inputs
    
    // Tool result fields (when EventType = "tool_result")
    ToolResultForID     string      // References ToolID
    ToolResultContent   string      // Result content
    ToolResultError     bool        // Error flag
    
    // Approval tracking
    IsCompleted         bool        // Completion status
    ApprovalStatus      string      // pending, approved, denied
    ApprovalID          string      // HumanLayer approval ID
    ApprovalResolvedAt  *time.Time  // Resolution timestamp
}
```

**Event Types**:
- `message`: Chat messages (user/assistant/system)
- `tool_call`: Tool invocation requests
- `tool_result`: Tool execution results
- `system`: System notifications

**Relationships**:
- Many-to-one: ConversationEvent → Session
- Self-referential: ToolResultForID → ToolID (same table)

### 3. MCPServer

**Purpose**: MCP (Model Context Protocol) server configurations
**Table**: `mcp_servers`

```go
type MCPServer struct {
    ID         int       // Auto-incrementing primary key
    SessionID  string    // Foreign key to sessions
    ServerName string    // MCP server name
    ConfigJSON string    // JSON configuration
    CreatedAt  time.Time // Creation timestamp
}
```

**Relationships**:
- Many-to-one: MCPServer → Session
- Unique constraint: (SessionID, ServerName)

### 4. RawEvent

**Purpose**: Raw JSON event storage for debugging
**Table**: `raw_events`

```go
type RawEvent struct {
    ID        int       // Auto-incrementing primary key
    SessionID string    // Foreign key to sessions
    EventJSON string    // Raw JSON data
    CreatedAt time.Time // Event timestamp
}
```

**Relationships**:
- Many-to-one: RawEvent → Session

### 5. Approval (External Entity)

**Purpose**: Human-in-the-loop approval requests
**Source**: HumanLayer Cloud API

```go
type Approval struct {
    ID           string                 // Approval ID from API
    CallID       string                 // Unique call identifier
    RunID        string                 // Associated run ID
    Type         string                 // function_call, human_contact
    Status       string                 // pending, approved, denied
    FunctionName string                 // Function being called
    FunctionArgs map[string]interface{} // Function arguments
    RequestedAt  time.Time              // Request timestamp
    TimeoutAt    time.Time              // Timeout timestamp
}
```

**Relationships**:
- Correlates to ConversationEvent via matching:
  - FunctionName → ToolName
  - FunctionArgs → ToolInputJSON
  - Within 5-minute time window

## Entity Relationship Diagram

```
┌─────────────────┐
│    Session      │
├─────────────────┤
│ id (PK)         │
│ parent_id (FK)  │◄──── Self-referential
│ status          │      (continuations)
│ query           │
│ ...             │
└─────────────────┘
        │
        │ 1:N
        ▼
┌─────────────────────┐     ┌─────────────────┐
│ ConversationEvent   │     │   MCPServer     │
├─────────────────────┤     ├─────────────────┤
│ id (PK)             │     │ id (PK)         │
│ session_id (FK)     │     │ session_id (FK) │
│ event_type          │     │ server_name     │
│ sequence            │     │ config_json     │
│ tool_id ◄───────────┼──┐  └─────────────────┘
│ tool_result_for_id  │  │
│ approval_id         │  └── Self-referential
│ ...                 │      (tool results)
└─────────────────────┘
        │
        │ Correlates via
        │ matching fields
        ▼
┌─────────────────────┐
│     Approval        │
├─────────────────────┤
│ id (External)       │
│ call_id             │
│ function_name       │
│ function_args       │
│ ...                 │
└─────────────────────┘
```

## Data Flow Patterns

### 1. Session Creation Flow
```
Launch Request → Create Session (starting) → Poll for Claude ID → Update to running
```

### 2. Conversation Recording Flow
```
Claude Event → Parse Event → Create ConversationEvent → Update Session Activity
```

### 3. Approval Correlation Flow
```
Fetch Approvals → Find Matching Tool Calls → Update Approval Status → Emit Events
```

### 4. Session Continuation Flow
```
Continue Request → Create New Session → Link Parent → Copy Conversation History
```

## Data Integrity Rules

1. **Session Status Transitions**:
   - Only valid transitions allowed
   - Status changes emit events
   - Orphaned sessions cleaned up on restart

2. **Conversation Sequence**:
   - Sequences must be monotonically increasing
   - No gaps allowed in sequence numbers
   - Tool results must reference existing tool calls

3. **Approval Correlation**:
   - Tool calls marked incomplete until correlated
   - 5-minute time window for correlation
   - External resolution detection via polling

4. **Parent-Child Relationships**:
   - Child sessions inherit parent's conversation
   - Parent must exist before child creation
   - Circular references prevented

## Performance Considerations

1. **Indexes**:
   - All foreign keys indexed
   - Status fields indexed for filtering
   - Timestamp fields indexed for ordering
   - Composite index on (session_id, sequence)

2. **Query Patterns**:
   - Conversation retrieval includes parent history
   - Approval correlation uses time-windowed queries
   - Active session queries use status index

3. **Data Growth**:
   - Conversation events grow linearly with usage
   - Raw events can be pruned periodically
   - No automatic archival currently

## Security Considerations

1. **No Encryption**: Data stored in plaintext SQLite
2. **File Permissions**: Database file protected by OS permissions
3. **No PII Marking**: No special handling for sensitive data
4. **SQL Injection**: Prevented via parameterized queries

## Future Enhancements

1. **Data Retention**: Automatic archival of old sessions
2. **Encryption**: SQLCipher for encrypted storage
3. **Partitioning**: Separate tables for active/archived data
4. **Analytics**: Aggregated usage statistics
5. **Export**: Data export functionality for compliance