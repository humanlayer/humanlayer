---
component_name: JSON-RPC API
component_type: interface
location: hld/rpc/
analyzed_date: 2025-06-26
dependencies: [session_manager, approval_manager, event_bus]
dependents: [hlyr, tui, wui, client]
test_coverage: 85
---

# HumanLayer Daemon JSON-RPC API Specification

## Overview

**Purpose**: Provides a JSON-RPC 2.0 API over Unix Domain Socket for managing Claude Code sessions and approvals
**Responsibility**: Handle all external communication with the daemon
**Location**: `hld/rpc/`

## Connection Details

- **Protocol**: JSON-RPC 2.0 over Unix Domain Socket
- **Socket Path**: `~/.humanlayer/daemon.sock` (configurable)
- **Permissions**: 0600 (owner read/write only)
- **Message Format**: Line-delimited JSON (each message ends with `\n`)
- **Buffer Size**: 1MB maximum per message

## Authentication

- **Method**: Unix file system permissions
- **Access Control**: Socket file permissions (0600)
- **API Key**: Optional, only for HumanLayer Cloud API calls

## Request/Response Format

### Request Structure
```json
{
  "jsonrpc": "2.0",
  "method": "methodName",
  "params": { /* method-specific parameters */ },
  "id": 1
}
```

### Success Response
```json
{
  "jsonrpc": "2.0",
  "result": { /* method-specific result */ },
  "id": 1
}
```

### Error Response
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Error description",
    "data": { /* optional additional data */ }
  },
  "id": 1
}
```

## Error Codes

- `-32700`: Parse error - Invalid JSON
- `-32600`: Invalid request - Not a valid Request object
- `-32601`: Method not found - Method does not exist
- `-32602`: Invalid params - Invalid method parameters
- `-32603`: Internal error - Internal JSON-RPC error

## API Methods

### 1. health

Check daemon health status.

**File Reference**: `hld/rpc/server.go:234`

**Request Parameters**: None required

**Response**:
```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

### 2. launchSession

Launch a new Claude Code session.

**File Reference**: `hld/rpc/handlers.go:50`

**Request Parameters**:
- `query` (string, required): Initial query for Claude
- `model` (string, optional): "opus" or "sonnet"
- `mcp_config` (object, optional): MCP server configuration
- `permission_prompt_tool` (string, optional): Tool requiring permission prompt
- `working_dir` (string, optional): Working directory path
- `max_turns` (int, optional): Maximum conversation turns
- `system_prompt` (string, optional): Override system prompt
- `append_system_prompt` (string, optional): Additional system prompt
- `allowed_tools` ([]string, optional): Whitelist of allowed tools
- `disallowed_tools` ([]string, optional): Blacklist of disallowed tools
- `custom_instructions` (string, optional): Custom instructions
- `verbose` (bool, optional): Enable verbose output

**Response**:
```json
{
  "session_id": "sess_123abc",
  "run_id": "run_456def"
}
```

### 3. listSessions

List all sessions managed by the daemon.

**File Reference**: `hld/rpc/handlers.go:112`

**Request Parameters**: None

**Response**:
```json
{
  "sessions": [
    {
      "id": "sess_123abc",
      "run_id": "run_456def",
      "claude_session_id": "claude_789ghi",
      "status": "running",
      "query": "Help me build a REST API",
      "created_at": "2025-06-26T10:00:00Z"
    }
  ]
}
```

**Session Status Values**:
- `starting`: Session is being initialized
- `running`: Session is active
- `completed`: Session finished successfully
- `failed`: Session encountered an error
- `waiting_input`: Session waiting for user input

### 4. getConversation

Get conversation history for a session.

**File Reference**: `hld/rpc/handlers.go:130`

**Request Parameters** (one required):
- `session_id` (string): HLD session ID
- `claude_session_id` (string): Claude's session ID

**Response**:
```json
{
  "events": [
    {
      "id": 1,
      "session_id": "sess_123abc",
      "claude_session_id": "claude_789ghi",
      "sequence": 1,
      "event_type": "message",
      "created_at": "2025-06-26T10:00:00Z",
      "role": "user",
      "content": "Help me build a REST API",
      "is_completed": true,
      "approval_status": null,
      "approval_id": null
    }
  ]
}
```

**Event Types**:
- `message`: Chat message (user/assistant/system)
- `tool_call`: Tool invocation request
- `tool_result`: Tool execution result
- `system`: System notification

### 5. getSessionState

Get current state of a session.

**File Reference**: `hld/rpc/handlers.go:185`

**Request Parameters**:
- `session_id` (string, required): Session ID

**Response**:
```json
{
  "session": {
    "id": "sess_123abc",
    "run_id": "run_456def",
    "claude_session_id": "claude_789ghi",
    "parent_session_id": null,
    "status": "running",
    "query": "Help me build a REST API",
    "summary": "Building REST API with Express.js",
    "model": "claude-3-opus",
    "working_dir": "/home/user/project",
    "created_at": "2025-06-26T10:00:00Z",
    "last_activity_at": "2025-06-26T10:05:00Z",
    "completed_at": null,
    "error_message": "",
    "cost_usd": 0.25,
    "total_tokens": 5000,
    "duration_ms": 300000
  }
}
```

### 6. continueSession

Continue an existing session with a new query.

**File Reference**: `hld/rpc/handlers.go:238`

**Request Parameters**:
- `session_id` (string, required): Parent session ID
- `query` (string, required): New query
- `system_prompt` (string, optional): Override system prompt
- `append_system_prompt` (string, optional): Additional instructions
- `mcp_config` (string, optional): JSON string of MCP config
- `permission_prompt_tool` (string, optional): Tool requiring permission
- `allowed_tools` ([]string, optional): Allowed tool list
- `disallowed_tools` ([]string, optional): Disallowed tool list
- `custom_instructions` (string, optional): Custom instructions
- `max_turns` (int, optional): Maximum turns

**Response**:
```json
{
  "session_id": "sess_new456",
  "run_id": "run_new789",
  "claude_session_id": "",
  "parent_session_id": "sess_123abc"
}
```

### 7. interruptSession

Interrupt a running session.

**File Reference**: `hld/rpc/handlers.go:289`

**Request Parameters**:
- `session_id` (string, required): Session ID to interrupt

**Response**:
```json
{
  "success": true,
  "session_id": "sess_123abc",
  "status": "completing"
}
```

### 8. fetchApprovals

Fetch pending approvals.

**File Reference**: `hld/rpc/approval_handlers.go:36`

**Request Parameters**:
- `session_id` (string, optional): Filter by session

**Response**:
```json
{
  "approvals": [
    {
      "id": "appr_123",
      "call_id": "call_456",
      "run_id": "run_789",
      "type": "function_call",
      "status": "pending",
      "function_name": "delete_file",
      "function_args": {
        "path": "/tmp/important.txt"
      },
      "requested_at": "2025-06-26T10:00:00Z",
      "timeout_at": "2025-06-26T10:05:00Z"
    }
  ]
}
```

**Approval Types**:
- `function_call`: Function execution approval
- `human_contact`: Human response request

### 9. sendDecision

Send decision for an approval.

**File Reference**: `hld/rpc/approval_handlers.go:92`

**Request Parameters**:
- `call_id` (string, required): Call ID
- `type` (string, required): "function_call" or "human_contact"
- `decision` (string, required): Decision type
- `comment` (string, conditional): Required for deny/respond

**Decision Types**:
- For `function_call`: "approve" or "deny"
- For `human_contact`: "respond"

**Response**:
```json
{
  "success": true,
  "error": ""
}
```

### 10. Subscribe

Subscribe to real-time events (long-polling).

**File Reference**: `hld/rpc/subscription_handlers.go:49`

**Request Parameters**:
- `event_types` ([]string, optional): Event types to subscribe
- `session_id` (string, optional): Filter by session
- `run_id` (string, optional): Filter by run

**Initial Response**:
```json
{
  "subscription_id": "sub_123abc",
  "message": "Subscription established. Waiting for events..."
}
```

**Event Notification**:
```json
{
  "event": {
    "type": "session_status_changed",
    "timestamp": "2025-06-26T10:05:00Z",
    "data": {
      "session_id": "sess_123abc",
      "old_status": "running",
      "new_status": "completed"
    }
  }
}
```

**Event Types**:
- `new_approval`: New approval received
- `approval_resolved`: Approval was resolved
- `session_status_changed`: Session status changed
- `conversation_updated`: New conversation content

**Heartbeat** (every 30 seconds):
```json
{
  "type": "heartbeat",
  "message": "Connection alive"
}
```

## Implementation Details

### Connection Handling
- Each connection handled in separate goroutine
- Graceful shutdown on daemon termination
- Read buffer: 65536 bytes
- Write timeout: None (blocking writes)

### Request Processing
1. Read line-delimited JSON from socket
2. Parse and validate JSON-RPC request
3. Route to appropriate handler
4. Execute business logic
5. Format and send response
6. Log request/response for debugging

### Error Handling
- All errors wrapped with context
- Standard JSON-RPC error codes
- Internal errors logged but sanitized in responses
- Connection errors trigger cleanup

### Concurrency
- Thread-safe handler registration
- Concurrent connection handling
- Mutex protection for shared state
- Channel-based event distribution

## Performance Characteristics

- Connection limit: OS file descriptor limit
- Message size limit: 1MB per message
- Subscription heartbeat: 30-second interval
- No built-in rate limiting
- Synchronous request processing per connection

## Testing

### Unit Tests
- Mock-based handler testing
- Error scenario coverage
- Concurrent access testing

### Integration Tests
- Full daemon lifecycle tests
- Multi-client scenarios
- Event subscription testing

## Security Considerations

- Local-only access via Unix socket
- File system permission-based security
- No authentication tokens in API
- API keys stored securely in config
- Sanitized error messages

## Future Considerations

- WebSocket support for remote access
- Request/response compression
- Batch request support
- Method-level rate limiting
- Request ID validation