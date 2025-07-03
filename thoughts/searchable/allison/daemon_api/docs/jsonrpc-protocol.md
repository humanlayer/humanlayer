# HumanLayer Daemon (HLD) Protocol Documentation

## Overview

The HumanLayer Daemon (HLD) uses a JSON-RPC 2.0 protocol over Unix domain sockets for communication. The daemon provides session management, approval handling, and event subscription capabilities for Claude Code interactions.

## Transport Layer

- **Protocol**: Unix domain socket
- **Socket Path**: Configurable via `HUMANLAYER_DAEMON_SOCKET` environment variable
- **Default Path**: `~/.humanlayer/daemon.sock`
- **Permissions**: 0600 (read/write for owner only)
- **Message Format**: Line-delimited JSON (each JSON-RPC message followed by newline)

## JSON-RPC 2.0 Format

All requests and responses follow the JSON-RPC 2.0 specification:

### Request Format

```json
{
  "jsonrpc": "2.0",
  "method": "methodName",
  "params": { ... },
  "id": 1
}
```

### Response Format

```json
{
  "jsonrpc": "2.0",
  "result": { ... },
  "id": 1
}
```

### Error Response Format

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Error description",
    "data": { ... }
  },
  "id": 1
}
```

## Error Codes

Standard JSON-RPC 2.0 error codes:

- `-32700`: Parse error
- `-32600`: Invalid request
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error

## API Methods

### Health Check

**Method**: `health`

**Request Parameters**: None

**Response**:

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

### Session Management

#### Launch Session

**Method**: `launchSession`

**Request Parameters**:

```json
{
  "query": "string (required)",
  "model": "string (optional: 'opus' or 'sonnet')",
  "mcp_config": {
    // MCPConfig object (optional)
  },
  "permission_prompt_tool": "string (optional)",
  "working_dir": "string (optional)",
  "max_turns": "number (optional)",
  "system_prompt": "string (optional)",
  "append_system_prompt": "string (optional)",
  "allowed_tools": ["string array (optional)"],
  "disallowed_tools": ["string array (optional)"],
  "custom_instructions": "string (optional)",
  "verbose": "boolean (optional)"
}
```

**Response**:

```json
{
  "session_id": "string",
  "run_id": "string"
}
```

#### List Sessions

**Method**: `listSessions`

**Request Parameters**: None or empty object

**Response**:

```json
{
  "sessions": [
    {
      "id": "string",
      "run_id": "string",
      "claude_session_id": "string (optional)",
      "parent_session_id": "string (optional)",
      "status": "starting|running|completed|failed",
      "start_time": "ISO 8601 timestamp",
      "end_time": "ISO 8601 timestamp (optional)",
      "last_activity_at": "ISO 8601 timestamp",
      "error": "string (optional)",
      "query": "string",
      "model": "string (optional)",
      "working_dir": "string (optional)",
      "result": {
        // Claude Code Result object (optional)
      }
    }
  ]
}
```

#### Get Session State

**Method**: `getSessionState`

**Request Parameters**:

```json
{
  "session_id": "string (required)"
}
```

**Response**:

```json
{
  "session": {
    "id": "string",
    "run_id": "string",
    "claude_session_id": "string (optional)",
    "parent_session_id": "string (optional)",
    "status": "starting|running|completed|failed|waiting_input",
    "query": "string",
    "model": "string (optional)",
    "working_dir": "string (optional)",
    "created_at": "ISO 8601 timestamp",
    "last_activity_at": "ISO 8601 timestamp",
    "completed_at": "ISO 8601 timestamp (optional)",
    "error_message": "string (optional)",
    "cost_usd": "number (optional)",
    "total_tokens": "number (optional)",
    "duration_ms": "number (optional)"
  }
}
```

#### Continue Session

**Method**: `continueSession`

**Request Parameters**:

```json
{
  "session_id": "string (required)",
  "query": "string (required)",
  "system_prompt": "string (optional)",
  "append_system_prompt": "string (optional)",
  "mcp_config": "string (JSON string of MCP config, optional)",
  "permission_prompt_tool": "string (optional)",
  "allowed_tools": ["string array (optional)"],
  "disallowed_tools": ["string array (optional)"],
  "custom_instructions": "string (optional)",
  "max_turns": "number (optional)"
}
```

**Response**:

```json
{
  "session_id": "string",
  "run_id": "string",
  "claude_session_id": "string",
  "parent_session_id": "string"
}
```

#### Interrupt Session

**Method**: `interruptSession`

**Request Parameters**:

```json
{
  "session_id": "string (required)"
}
```

**Response**:

```json
{
  "success": true,
  "message": "Session interrupted successfully"
}
```

### Conversation History

#### Get Conversation

**Method**: `getConversation`

**Request Parameters**:

```json
{
  "session_id": "string (optional)",
  "claude_session_id": "string (optional)"
}
```

Note: Either `session_id` or `claude_session_id` is required.

**Response**:

```json
{
  "events": [
    {
      "id": "number",
      "session_id": "string",
      "claude_session_id": "string",
      "sequence": "number",
      "event_type": "message|tool_call|tool_result|system",
      "created_at": "ISO 8601 timestamp",
      "role": "user|assistant|system (optional)",
      "content": "string (optional)",
      "tool_id": "string (optional)",
      "tool_name": "string (optional)",
      "tool_input_json": "string (optional)",
      "tool_result_for_id": "string (optional)",
      "tool_result_content": "string (optional)",
      "is_completed": "boolean",
      "approval_status": "string (optional: NULL|pending|approved|denied)",
      "approval_id": "string (optional)"
    }
  ]
}
```

### Approval Management

#### Fetch Approvals

**Method**: `fetchApprovals`

**Request Parameters**:

```json
{
  "session_id": "string (optional)"
}
```

**Response**:

```json
{
  "approvals": [
    {
      "type": "function_call|human_contact",
      "function_call": {
        // HumanLayer FunctionCall object (when type is function_call)
      },
      "human_contact": {
        // HumanLayer HumanContact object (when type is human_contact)
      }
    }
  ]
}
```

#### Send Decision

**Method**: `sendDecision`

**Request Parameters**:

```json
{
  "call_id": "string (required)",
  "type": "function_call|human_contact (required)",
  "decision": "approve|deny|respond (required)",
  "comment": "string (optional/required based on decision)"
}
```

Decision rules:

- For `function_call` type: `approve` or `deny` (deny requires comment)
- For `human_contact` type: `respond` (requires comment)

**Response**:

```json
{
  "success": "boolean",
  "error": "string (optional)"
}
```

### Event Subscription

#### Subscribe to Events

**Method**: `Subscribe`

**Request Parameters**:

```json
{
  "event_types": ["string array (optional)"],
  "session_id": "string (optional)",
  "run_id": "string (optional)"
}
```

Event types:

- `new_approval`: New approval(s) received
- `approval_resolved`: Approval resolved (approved/denied/responded)
- `session_status_changed`: Session status changed
- `conversation_updated`: New conversation content added

**Initial Response**:

```json
{
  "subscription_id": "string",
  "message": "Subscription established. Waiting for events..."
}
```

**Event Notifications** (streamed):

```json
{
  "event": {
    "type": "event_type",
    "timestamp": "ISO 8601 timestamp",
    "data": {
      // Event-specific data
    }
  }
}
```

**Heartbeat** (sent every 30 seconds):

```json
{
  "type": "heartbeat",
  "message": "Connection alive"
}
```

Note: The Subscribe method uses long-polling and maintains the connection until closed by the client or server.

## Connection Management

- Each client connection is handled independently
- Connections can be closed at any time
- The daemon supports concurrent connections
- Socket buffer size: 1MB

## Data Types

### Session Status Values

- `starting`: Session is initializing
- `running`: Session is actively processing
- `completed`: Session finished successfully
- `failed`: Session encountered an error
- `waiting_input`: Session is waiting for user input

### Approval Status Values

- `NULL`: No approval needed
- `pending`: Awaiting approval decision
- `approved`: Approved
- `denied`: Denied
- `resolved`: Generically resolved (external resolution)

### Event Types

- `message`: Chat message (user/assistant/system)
- `tool_call`: Tool invocation
- `tool_result`: Tool execution result
- `system`: System event

## Example Usage

### Connecting to the daemon

```bash
# Using netcat (for testing)
nc -U ~/.humanlayer/daemon.sock

# Send a health check
{"jsonrpc":"2.0","method":"health","id":1}
```

### Launching a session

```json
{
  "jsonrpc": "2.0",
  "method": "launchSession",
  "params": {
    "query": "Help me write a Python script",
    "model": "opus",
    "working_dir": "/path/to/project"
  },
  "id": 2
}
```

### Subscribing to events

```json
{
  "jsonrpc": "2.0",
  "method": "Subscribe",
  "params": {
    "event_types": ["new_approval", "session_status_changed"],
    "session_id": "session-123"
  },
  "id": 3
}
```

## Security Considerations

- The daemon only accepts connections via Unix domain socket
- Socket permissions are set to 0600 (owner read/write only)
- No authentication is required as security is handled by filesystem permissions
- The daemon runs with the same privileges as the user who started it
