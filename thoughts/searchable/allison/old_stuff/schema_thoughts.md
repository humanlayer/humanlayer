# SQLite Schema Design for HumanLayer Daemon

## Design Philosophy

After extensive iteration, we've arrived at a **conversation-first** schema design that prioritizes the most common use case: displaying the full conversation history for a session in the TUI.

Key principles:

1. **Optimize for reads, not writes** - We display conversations far more often than we store them
2. **Denormalize for simplicity** - Some NULL fields are worth avoiding complex joins
3. **One source of truth** - The conversation_events table is the primary record
4. **Minimal transformation** - Data flows from storage to TUI with minimal processing

## Final Schema

### Core Tables

```sql
-- Single conversation events table (the main table)
CREATE TABLE conversation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    claude_session_id TEXT,      -- Groups resumed sessions together
    sequence INTEGER NOT NULL,   -- Absolute order within claude_session
    event_type TEXT NOT NULL,    -- 'message', 'tool_call', 'tool_result', 'system'

    -- Common fields
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Message fields (when event_type = 'message')
    role TEXT,                   -- user, assistant, system
    content TEXT,

    -- Tool call fields (when event_type = 'tool_call')
    tool_id TEXT,                -- Claude's tool_use_id
    tool_name TEXT,
    tool_input_json TEXT,

    -- Tool result fields (when event_type = 'tool_result')
    tool_result_for_id TEXT,     -- References tool_id
    tool_result_content TEXT,

    -- Approval correlation (when event_type = 'tool_call')
    needs_approval BOOLEAN DEFAULT FALSE,
    approval_status TEXT,        -- NULL, 'pending', 'approved', 'denied'
    approval_id TEXT,           -- HumanLayer approval ID if correlated

    INDEX idx_conversation_claude_session (claude_session_id, sequence),
    INDEX idx_conversation_session (session_id, sequence),
    INDEX idx_conversation_approval (approval_id),
    INDEX idx_conversation_pending_approvals (approval_status, needs_approval)
        WHERE approval_status = 'pending' AND needs_approval = TRUE
);

-- Sessions table (metadata and configuration)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    claude_session_id TEXT,      -- From Claude SDK, groups resumed sessions
    parent_session_id TEXT,      -- For tracking resume chains

    -- Launch configuration (for cloning/resuming)
    query TEXT NOT NULL,
    model TEXT,
    working_dir TEXT,
    max_turns INTEGER,
    system_prompt TEXT,
    custom_instructions TEXT,

    -- Runtime status
    status TEXT NOT NULL DEFAULT 'starting',  -- starting, running, completed, failed, waiting_input
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,

    -- Results (populated from result event)
    cost_usd REAL,
    total_tokens INTEGER,
    duration_ms INTEGER,
    error_message TEXT,

    INDEX idx_sessions_claude (claude_session_id),
    INDEX idx_sessions_status (status),
    INDEX idx_sessions_run_id (run_id)
);

-- MCP servers configuration (normalized from launch config)
CREATE TABLE mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    args_json TEXT,              -- JSON array of arguments
    env_json TEXT,               -- JSON object of environment variables

    FOREIGN KEY (session_id) REFERENCES sessions(id),
    INDEX idx_mcp_servers_session (session_id)
);

-- Note: Approvals (function calls and human contacts) are not stored locally
-- They remain in HumanLayer's API and are fetched/cached in memory by the daemon
-- Only the correlation with tool calls is stored in conversation_events

-- Raw events for debugging and replay
CREATE TABLE raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (session_id) REFERENCES sessions(id),
    INDEX idx_raw_events_session (session_id, created_at)
);

-- Schema versioning for migrations
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);
```

## Event Processing Flow

### 1. Session Launch

```sql
-- Create session record
INSERT INTO sessions (id, run_id, query, model, working_dir, ...)
VALUES (?, ?, ?, ?, ?, ...);

-- Store MCP servers if configured
INSERT INTO mcp_servers (session_id, name, command, args_json, env_json)
VALUES (?, ?, ?, ?, ?);
```

### 2. System Events

```sql
-- When we receive session_created event with claude_session_id
UPDATE sessions
SET claude_session_id = ?, status = 'running', last_activity_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- Store system events in conversation
INSERT INTO conversation_events (session_id, claude_session_id, sequence, event_type, content)
VALUES (?, ?, ?, 'system', 'Session started with model X');
```

### 3. Assistant Messages

When we receive a complete assistant message:

```sql
-- Get next sequence number
SELECT COALESCE(MAX(sequence), 0) + 1 FROM conversation_events WHERE claude_session_id = ?;

-- Insert message event
INSERT INTO conversation_events (
    session_id, claude_session_id, sequence, event_type, role, content
) VALUES (?, ?, ?, 'message', 'assistant', ?);

-- For each tool_use in the message, insert tool_call event
INSERT INTO conversation_events (
    session_id, claude_session_id, sequence, event_type,
    tool_id, tool_name, tool_input_json, needs_approval, approval_status
) VALUES (?, ?, ?, 'tool_call', ?, ?, ?, ?, ?);
```

### 4. Tool Results

```sql
-- Insert as user message with tool result
INSERT INTO conversation_events (
    session_id, claude_session_id, sequence, event_type,
    role, content, tool_result_for_id, tool_result_content
) VALUES (?, ?, ?, 'tool_result', 'user', ?, ?, ?);
```

### 5. Approval Correlation

```sql
-- When approval arrives from HumanLayer, find matching tool call
UPDATE conversation_events
SET approval_status = 'pending', approval_id = ?
WHERE tool_name = ?
  AND tool_input_json = ?
  AND session_id IN (SELECT id FROM sessions WHERE run_id = ?)
  AND approval_status IS NULL
  AND created_at > datetime('now', '-10 seconds')
LIMIT 1;

-- Note: The approval details remain in HumanLayer's API
-- We only store the correlation (approval_id) in our local database
```

## Common Queries

```sql
-- Get full conversation for any session (including resumed)
SELECT * FROM conversation_events
WHERE claude_session_id = ?
ORDER BY sequence;

-- Get pending approvals with session context
SELECT
    ce.*,
    s.query,
    s.model,
    s.working_dir
FROM conversation_events ce
JOIN sessions s ON s.id = ce.session_id
WHERE ce.approval_status = 'pending'
  AND ce.needs_approval = TRUE
ORDER BY ce.created_at DESC;

-- Get all sessions with pending approvals
SELECT DISTINCT s.*
FROM sessions s
JOIN conversation_events ce ON ce.session_id = s.id
WHERE ce.approval_status = 'pending'
  AND ce.needs_approval = TRUE
  AND s.status = 'running';

-- Get conversation for a specific approval
SELECT ce.*
FROM conversation_events ce
WHERE ce.claude_session_id = (
    SELECT claude_session_id
    FROM conversation_events
    WHERE approval_id = ?
    LIMIT 1
)
ORDER BY ce.sequence;

-- Count active sessions
SELECT COUNT(DISTINCT claude_session_id)
FROM sessions
WHERE status IN ('running', 'waiting_input')
  AND last_activity_at > datetime('now', '-1 hour');
```

## Key Design Decisions

1. **Single conversation table**: Makes the most common query (show conversation) trivial
2. **Sequence numbers**: Ensures correct ordering even with concurrent inserts or clock skew
3. **Denormalized event types**: Some fields are NULL based on event_type, but queries are simple
4. **Separate approvals table**: Tracks all approvals (not just Claude sessions) for the broader daemon
5. **Raw events preserved**: Enables debugging and future replay functionality
6. **Schema versioning**: Standard practice for managing database migrations

## Handling Resumed Sessions

When a session is resumed:

1. Create a new session record with `parent_session_id` set
2. Reuse the same `claude_session_id`
3. Continue incrementing the sequence number
4. All conversation events naturally group together

Example:

```sql
-- Original session
Session ID: sess_001, Claude Session ID: claude_123, Sequences: 1-50

-- Resumed session
Session ID: sess_002, Claude Session ID: claude_123, Parent: sess_001, Sequences: 51-100

-- Query for full conversation
SELECT * FROM conversation_events WHERE claude_session_id = 'claude_123' ORDER BY sequence;
-- Returns all 100 events in correct order
```

## Storage Interface

To support both SQLite and in-memory implementations:

```go
type ConversationStore interface {
    // Session operations
    CreateSession(config SessionConfig) (*Session, error)
    UpdateSessionStatus(sessionID string, status string) error
    GetSession(sessionID string) (*Session, error)

    // Conversation operations
    AddConversationEvent(event ConversationEvent) error
    GetConversation(claudeSessionID string) ([]ConversationEvent, error)
    GetPendingApprovals(sessionID string) ([]ConversationEvent, error)

    // Approval operations
    CorrelateApproval(toolCall ToolCall, approvalID string) error
    UpdateApprovalStatus(approvalID string, status string) error
}
```

This design balances simplicity, performance, and functionality while keeping the most common operations fast and straightforward.
