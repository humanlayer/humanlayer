-- HumanLayer Daemon (hld) SQLite Database Schema
-- Version: 1
-- Location: ~/.humanlayer/daemon.db
-- Engine: SQLite3 with WAL mode

-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table: Stores Claude Code session metadata
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,                -- Format: sess_<uuid>
    run_id TEXT NOT NULL,               -- Format: run_<uuid>
    claude_session_id TEXT,             -- Claude's session identifier
    parent_session_id TEXT,             -- References sessions(id) for continuations
    status TEXT NOT NULL,               -- Enum: starting, running, waiting_input, completed, failed
    query TEXT NOT NULL,                -- Initial user query
    summary TEXT,                       -- AI-generated session summary
    model TEXT,                         -- Claude model used
    working_dir TEXT,                   -- Working directory path
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,             -- NULL if not completed
    error_message TEXT,                 -- Error details if failed
    cost_usd REAL DEFAULT 0,            -- Session cost in USD
    total_tokens INTEGER DEFAULT 0,     -- Total tokens consumed
    duration_ms INTEGER DEFAULT 0,      -- Total duration in milliseconds
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

-- Indexes for sessions
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_claude_session_id ON sessions(claude_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent_session_id ON sessions(parent_session_id);

-- Conversation events table: Stores all conversation events
CREATE TABLE IF NOT EXISTS conversation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,           -- References sessions(id)
    claude_session_id TEXT,             -- Claude's session ID
    sequence INTEGER NOT NULL,          -- Event order within conversation
    event_type TEXT NOT NULL,           -- Enum: message, tool_call, tool_result, system
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Message fields (when event_type = 'message')
    role TEXT,                          -- Enum: user, assistant, system
    content TEXT,                       -- Message content
    
    -- Tool call fields (when event_type = 'tool_call')
    tool_id TEXT,                       -- Unique tool call ID
    tool_name TEXT,                     -- Tool name being called
    tool_input_json TEXT,               -- JSON string of tool inputs
    
    -- Tool result fields (when event_type = 'tool_result')
    tool_result_for_id TEXT,            -- References tool_id
    tool_result_content TEXT,           -- Tool execution result
    tool_result_error BOOLEAN DEFAULT FALSE,
    
    -- Approval tracking
    is_completed BOOLEAN DEFAULT TRUE,  -- FALSE for pending tool calls
    approval_status TEXT,               -- Enum: NULL, pending, approved, denied
    approval_id TEXT,                   -- HumanLayer approval ID
    approval_resolved_at TIMESTAMP,     -- When approval was resolved
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes for conversation_events
CREATE INDEX IF NOT EXISTS idx_conversation_events_session_id ON conversation_events(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_claude_session_id ON conversation_events(claude_session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_sequence ON conversation_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_conversation_events_tool_id ON conversation_events(tool_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_approval_status ON conversation_events(approval_status);
CREATE INDEX IF NOT EXISTS idx_conversation_events_created_at ON conversation_events(created_at);

-- MCP servers table: Stores MCP server configurations per session
CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,           -- References sessions(id)
    server_name TEXT NOT NULL,          -- MCP server name
    config_json TEXT NOT NULL,          -- JSON configuration
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, server_name)
);

-- Index for mcp_servers
CREATE INDEX IF NOT EXISTS idx_mcp_servers_session_id ON mcp_servers(session_id);

-- Raw events table: Stores raw JSON events for debugging
CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,           -- References sessions(id)
    event_json TEXT NOT NULL,           -- Raw JSON event data
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Index for raw_events
CREATE INDEX IF NOT EXISTS idx_raw_events_session_id ON raw_events(session_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_created_at ON raw_events(created_at);

-- Views for common queries

-- Active sessions view
CREATE VIEW IF NOT EXISTS active_sessions AS
SELECT * FROM sessions 
WHERE status IN ('starting', 'running', 'waiting_input')
ORDER BY last_activity_at DESC;

-- Pending approvals view
CREATE VIEW IF NOT EXISTS pending_approvals AS
SELECT 
    ce.id,
    ce.session_id,
    ce.claude_session_id,
    ce.tool_id,
    ce.tool_name,
    ce.tool_input_json,
    ce.created_at,
    s.run_id,
    s.query as session_query
FROM conversation_events ce
JOIN sessions s ON ce.session_id = s.id
WHERE ce.event_type = 'tool_call' 
AND ce.approval_status = 'pending'
ORDER BY ce.created_at DESC;

-- Session statistics view
CREATE VIEW IF NOT EXISTS session_statistics AS
SELECT 
    COUNT(*) as total_sessions,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_sessions,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_sessions,
    COUNT(CASE WHEN status IN ('running', 'starting', 'waiting_input') THEN 1 END) as active_sessions,
    SUM(cost_usd) as total_cost_usd,
    SUM(total_tokens) as total_tokens_used,
    AVG(duration_ms) as avg_duration_ms
FROM sessions;

-- Initial schema version
INSERT INTO schema_version (version) VALUES (1);