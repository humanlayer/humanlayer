---
component_name: Database Operations
component_type: data_access
location: hld/store/
analyzed_date: 2025-06-26
dependencies: [sqlite3]
dependents: [all_managers]
test_coverage: 85
---

# Database Operations Specification (Language-Agnostic)

## Overview

This document provides exact SQL queries and database operations used by HLD, enabling implementation in any language or database system.

## Database Configuration

### SQLite Pragmas (Run on Connection)
```sql
PRAGMA journal_mode = WAL;        -- Write-Ahead Logging for concurrency
PRAGMA foreign_keys = ON;         -- Enable foreign key constraints
PRAGMA busy_timeout = 5000;       -- 5 second timeout for locks
```

### Connection String
```
file:{database_path}?_journal_mode=WAL&_foreign_keys=on&_busy_timeout=5000
```

## Schema Creation

### 1. Create Tables (Run in Order)
```sql
-- Schema version table
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    claude_session_id TEXT,
    parent_session_id TEXT,
    status TEXT NOT NULL,
    query TEXT NOT NULL,
    summary TEXT,
    model TEXT,
    working_dir TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    cost_usd REAL DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

-- Conversation events table
CREATE TABLE IF NOT EXISTS conversation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    claude_session_id TEXT,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    role TEXT,
    content TEXT,
    tool_id TEXT,
    tool_name TEXT,
    tool_input_json TEXT,
    tool_result_for_id TEXT,
    tool_result_content TEXT,
    tool_result_error BOOLEAN DEFAULT FALSE,
    is_completed BOOLEAN DEFAULT TRUE,
    approval_status TEXT,
    approval_id TEXT,
    approval_resolved_at TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- MCP servers table
CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    server_name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, server_name)
);

-- Raw events table
CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

### 2. Create Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_claude_session_id ON sessions(claude_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent_session_id ON sessions(parent_session_id);

CREATE INDEX IF NOT EXISTS idx_conversation_events_session_id ON conversation_events(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_claude_session_id ON conversation_events(claude_session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_sequence ON conversation_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_conversation_events_tool_id ON conversation_events(tool_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_approval_status ON conversation_events(approval_status);
CREATE INDEX IF NOT EXISTS idx_conversation_events_created_at ON conversation_events(created_at);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_session_id ON mcp_servers(session_id);

CREATE INDEX IF NOT EXISTS idx_raw_events_session_id ON raw_events(session_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_created_at ON raw_events(created_at);
```

## Session Operations

### Create Session
```sql
INSERT INTO sessions (
    id, run_id, claude_session_id, parent_session_id, status, 
    query, summary, model, working_dir, created_at, last_activity_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

### Update Session
```sql
UPDATE sessions SET
    claude_session_id = ?,
    status = ?,
    summary = ?,
    last_activity_at = ?,
    completed_at = ?,
    error_message = ?,
    cost_usd = ?,
    total_tokens = ?,
    duration_ms = ?
WHERE id = ?;
```

### Get Session by ID
```sql
SELECT id, run_id, claude_session_id, parent_session_id, status,
    query, summary, model, working_dir, created_at, last_activity_at,
    completed_at, error_message, cost_usd, total_tokens, duration_ms
FROM sessions
WHERE id = ?;
```

### Get Session by Claude ID
```sql
SELECT id, run_id, claude_session_id, parent_session_id, status,
    query, summary, model, working_dir, created_at, last_activity_at,
    completed_at, error_message, cost_usd, total_tokens, duration_ms
FROM sessions
WHERE claude_session_id = ?;
```

### List All Sessions
```sql
SELECT id, run_id, claude_session_id, parent_session_id, status,
    query, summary, model, working_dir, created_at, last_activity_at,
    completed_at, error_message, cost_usd, total_tokens, duration_ms
FROM sessions
ORDER BY created_at DESC;
```

### Update Session Status
```sql
UPDATE sessions 
SET status = ?, last_activity_at = CURRENT_TIMESTAMP
WHERE id = ?;
```

### Update Session Claude ID
```sql
UPDATE sessions 
SET claude_session_id = ?, last_activity_at = CURRENT_TIMESTAMP
WHERE id = ?;
```

### Find Orphaned Sessions
```sql
SELECT id FROM sessions
WHERE status IN ('starting', 'running', 'waiting_input');
```

### Get Sessions by Parent Run ID
```sql
SELECT s.id, s.run_id, s.claude_session_id, s.parent_session_id, s.status,
    s.query, s.summary, s.model, s.working_dir, s.created_at, s.last_activity_at,
    s.completed_at, s.error_message, s.cost_usd, s.total_tokens, s.duration_ms
FROM sessions s
JOIN sessions p ON s.parent_session_id = p.id
WHERE p.run_id = ?;
```

## Conversation Operations

### Record Conversation Event
```sql
INSERT INTO conversation_events (
    session_id, claude_session_id, sequence, event_type, created_at,
    role, content,
    tool_id, tool_name, tool_input_json,
    tool_result_for_id, tool_result_content, tool_result_error,
    is_completed, approval_status, approval_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

### Get Conversation History (With Parent Sessions)
```sql
WITH RECURSIVE session_hierarchy AS (
    SELECT id, parent_session_id, 0 as level
    FROM sessions
    WHERE id = ?
    
    UNION ALL
    
    SELECT s.id, s.parent_session_id, sh.level + 1
    FROM sessions s
    JOIN session_hierarchy sh ON s.id = sh.parent_session_id
)
SELECT 
    ce.id, ce.session_id, ce.claude_session_id, ce.sequence,
    ce.event_type, ce.created_at, ce.role, ce.content,
    ce.tool_id, ce.tool_name, ce.tool_input_json,
    ce.tool_result_for_id, ce.tool_result_content, ce.tool_result_error,
    ce.is_completed, ce.approval_status, ce.approval_id, ce.approval_resolved_at,
    sh.level
FROM conversation_events ce
JOIN session_hierarchy sh ON ce.session_id = sh.id
ORDER BY sh.level DESC, ce.sequence ASC;
```

### Get Conversation by Claude Session ID
```sql
SELECT 
    id, session_id, claude_session_id, sequence, event_type,
    created_at, role, content, tool_id, tool_name, tool_input_json,
    tool_result_for_id, tool_result_content, tool_result_error,
    is_completed, approval_status, approval_id, approval_resolved_at
FROM conversation_events
WHERE claude_session_id = ?
ORDER BY sequence ASC;
```

### Get Next Sequence Number
```sql
SELECT COALESCE(MAX(sequence), 0) + 1
FROM conversation_events
WHERE session_id = ?;
```

### Find Uncorrelated Tool Call
```sql
SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
    role, content, tool_id, tool_name, tool_input_json,
    tool_result_for_id, tool_result_content, tool_result_error,
    is_completed, approval_status, approval_id
FROM conversation_events
WHERE tool_name = ?
  AND session_id = ?
  AND event_type = 'tool_call'
  AND is_completed = FALSE
  AND (approval_status IS NULL OR approval_status = '')
ORDER BY sequence DESC
LIMIT 1;
```

### Update Tool Call Approval
```sql
UPDATE conversation_events
SET approval_status = ?, approval_id = ?
WHERE id = ?;
```

### Mark Tool Call Completed
```sql
UPDATE conversation_events
SET is_completed = TRUE
WHERE tool_id = ? AND session_id = ? AND event_type = 'tool_call';
```

### Get Pending Tool Calls
```sql
SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
    role, content, tool_id, tool_name, tool_input_json,
    tool_result_for_id, tool_result_content, tool_result_error,
    is_completed, approval_status, approval_id
FROM conversation_events
WHERE session_id = ?
  AND event_type = 'tool_call'
  AND is_completed = FALSE
ORDER BY sequence ASC;
```

## MCP Server Operations

### Save MCP Servers
```sql
-- Delete existing (for update)
DELETE FROM mcp_servers WHERE session_id = ?;

-- Insert new
INSERT INTO mcp_servers (session_id, server_name, config_json)
VALUES (?, ?, ?);
```

### Get MCP Servers
```sql
SELECT server_name, config_json
FROM mcp_servers
WHERE session_id = ?;
```

## Raw Event Operations

### Save Raw Event
```sql
INSERT INTO raw_events (session_id, event_json)
VALUES (?, ?);
```

### Get Raw Events
```sql
SELECT id, event_json, created_at
FROM raw_events
WHERE session_id = ?
ORDER BY created_at ASC;
```

## Transaction Patterns

### Atomic Session Update
```sql
BEGIN TRANSACTION;

-- Update session
UPDATE sessions SET status = ?, last_activity_at = ? WHERE id = ?;

-- Record status change event
INSERT INTO conversation_events (
    session_id, sequence, event_type, content
) VALUES (?, ?, 'system', ?);

COMMIT;
```

### Conversation Recording with Sequence
```sql
BEGIN TRANSACTION;

-- Get next sequence
SELECT COALESCE(MAX(sequence), 0) + 1 FROM conversation_events WHERE session_id = ?;

-- Insert event
INSERT INTO conversation_events (...) VALUES (...);

-- Update session activity
UPDATE sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?;

COMMIT;
```

## Error Handling

### Constraint Violations
- **UNIQUE constraint**: Return specific error (e.g., "MCP server already exists")
- **FOREIGN KEY constraint**: Return "Parent session not found"
- **NOT NULL constraint**: Return "Required field missing"

### Connection Errors
- Implement exponential backoff retry
- Maximum 3 retry attempts
- Log all database errors

### Query Timeouts
- Set statement timeout: 30 seconds
- Cancel long-running queries
- Return timeout error to caller

## Performance Optimizations

### Connection Pooling
```
MAX_CONNECTIONS = 1  # SQLite limitation
CONNECTION_TIMEOUT = 30s
IDLE_TIMEOUT = 10m
```

### Query Optimization
1. Use prepared statements for repeated queries
2. Batch inserts where possible
3. Use indexes for all WHERE and JOIN conditions
4. Limit result sets with LIMIT clause

### Maintenance Queries
```sql
-- Vacuum database (run during low activity)
VACUUM;

-- Analyze query planner statistics
ANALYZE;

-- Check integrity
PRAGMA integrity_check;
```