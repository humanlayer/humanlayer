---
component_name: RPC Protocol Specification
component_type: protocol
location: hld/rpc/
analyzed_date: 2025-06-26
dependencies: []
dependents: [all_clients]
test_coverage: 95
---

# HLD JSON-RPC Protocol Specification (Language-Agnostic)

## Overview

This document provides a complete specification of the HumanLayer Daemon's RPC protocol, sufficient to implement a compatible client or server in any programming language.

## Transport Layer

### Connection Type
- **Protocol**: Unix Domain Socket
- **Socket Path**: `~/.humanlayer/daemon.sock` (configurable)
- **Connection Model**: Multiple concurrent connections allowed
- **Connection Lifecycle**: Request-response (close after response) or long-lived (subscriptions)

### Message Framing
- **Format**: Line-delimited JSON (NDJSON)
- **Delimiter**: Single newline character (`\n`, ASCII 10)
- **Encoding**: UTF-8
- **Maximum Message Size**: 1,048,576 bytes (1MB)

### Message Structure
```
[JSON object 1]\n
[JSON object 2]\n
...
```

## JSON-RPC 2.0 Protocol

### Request Format
```json
{
  "jsonrpc": "2.0",
  "method": "methodName",
  "params": {
    "param1": "value1",
    "param2": "value2"
  },
  "id": 1
}
```

**Field Requirements**:
- `jsonrpc`: MUST be exactly "2.0" (string)
- `method`: Method name (string, case-sensitive)
- `params`: Method parameters (object, can be empty `{}`)
- `id`: Request identifier (number or string, MUST be unique per connection)

### Success Response Format
```json
{
  "jsonrpc": "2.0",
  "result": {
    "field1": "value1",
    "field2": "value2"
  },
  "id": 1
}
```

### Error Response Format
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": {
      "details": "Additional error information"
    }
  },
  "id": 1
}
```

### Standard Error Codes
| Code | Message | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid request | Not a valid Request object |
| -32601 | Method not found | Method does not exist |
| -32602 | Invalid params | Invalid method parameters |
| -32603 | Internal error | Internal JSON-RPC error |

## Connection Handling Algorithm

### Server-Side Connection Loop
```
1. Accept connection on Unix socket
2. Create new goroutine for connection
3. In goroutine:
   a. Create line scanner with 1MB buffer
   b. While scanner.Scan():
      i. Read line (up to \n)
      ii. Parse JSON
      iii. Validate JSON-RPC request
      iv. Route to method handler
      v. Send response
      vi. If not subscription, continue loop
      vii. If subscription, enter event loop
   c. On error or EOF, close connection
```

### Client-Side Connection
```
1. Connect to Unix socket
2. Send request as JSON + \n
3. Read response until \n
4. Parse JSON response
5. For normal requests: close connection
6. For subscriptions: keep reading events
```

## Method Registry

### Available Methods
1. `health` - Health check
2. `launchSession` - Start new Claude session
3. `listSessions` - List all sessions
4. `getConversation` - Get conversation history
5. `getSessionState` - Get session details
6. `continueSession` - Continue from parent session
7. `interruptSession` - Stop running session
8. `fetchApprovals` - Get pending approvals
9. `sendDecision` - Send approval decision
10. `Subscribe` - Long-polling event subscription (capital S)

## Subscription Protocol (Long-Polling)

### Subscription Flow
```
Client                          Server
  |                               |
  |-- Subscribe request --------->|
  |                               |
  |<-- Initial response -----------|
  |    (subscription established)  |
  |                               |
  |<-- Event notification ---------|
  |<-- Event notification ---------|
  |<-- Heartbeat (30s) -----------|
  |<-- Event notification ---------|
  |                               |
  |-- Connection close ----------->|
```

### Subscription Request
```json
{
  "jsonrpc": "2.0",
  "method": "Subscribe",
  "params": {
    "event_types": ["session_status_changed", "new_approval"],
    "session_id": "sess_123",
    "run_id": "run_456"
  },
  "id": 1
}
```

### Initial Response
```json
{
  "jsonrpc": "2.0",
  "result": {
    "subscription_id": "sub_<uuid>",
    "message": "Subscription established. Waiting for events..."
  },
  "id": 1
}
```

### Event Notification Format
```json
{
  "jsonrpc": "2.0",
  "result": {
    "event": {
      "type": "session_status_changed",
      "timestamp": "2025-06-26T10:00:00Z",
      "data": {
        "session_id": "sess_123",
        "old_status": "running",
        "new_status": "completed"
      }
    }
  }
}
```

### Heartbeat Format
```json
{
  "jsonrpc": "2.0",
  "result": {
    "type": "heartbeat",
    "message": "Connection alive"
  }
}
```

### Subscription Timing
- **Heartbeat Interval**: 30 seconds (30000ms)
- **Connection Check**: Every 100ms
- **Event Buffer**: 100 events per subscriber
- **Overflow Behavior**: Drop events if buffer full

## Validation Rules

### Request Validation
1. **JSON Parsing**: Must be valid JSON
2. **JSON-RPC Version**: `jsonrpc` field must equal "2.0"
3. **Method Existence**: Method must be in registry
4. **Parameter Structure**: `params` must be object (not array)
5. **Required Parameters**: Method-specific validation

### Method-Specific Validation

#### launchSession
- `query` (string): Required, non-empty
- `model` (string): Optional, ignored if invalid

#### continueSession
- `session_id` (string): Required, must exist
- `query` (string): Required, non-empty

#### sendDecision
- `call_id` (string): Required
- `type` (string): Required, must be "function_call" or "human_contact"
- `decision` (string): Required, validated by type:
  - For "function_call": must be "approve" or "deny"
  - For "human_contact": must be "respond"
- `comment` (string): Required for "deny" and "respond"

## Concurrency Model

### Server Concurrency
- Each connection handled in separate thread/goroutine
- No shared state between connections
- Thread-safe method handlers required
- Event bus uses mutex for subscriber management

### Client Concurrency
- Clients should use separate connections for:
  - Normal requests (short-lived)
  - Subscriptions (long-lived)
- Request IDs must be unique per connection

## Implementation Constants

```
# Version
DAEMON_VERSION = "0.1.0"
JSONRPC_VERSION = "2.0"

# Buffer Sizes
MAX_MESSAGE_SIZE = 1048576  # 1MB
SCANNER_BUFFER_SIZE = 1048576  # 1MB
EVENT_CHANNEL_SIZE = 100

# Timeouts (milliseconds)
HEARTBEAT_INTERVAL = 30000
CONNECTION_CHECK_INTERVAL = 100
DEFAULT_POLL_INTERVAL = 5000
MAX_BACKOFF = 300000  # 5 minutes

# Approval Constants
BACKOFF_FACTOR = 2.0
CORRELATION_TIME_WINDOW = 300  # 5 minutes in seconds
```

## Error Handling Patterns

### Connection Errors
- EOF: Normal disconnection, clean up resources
- Write error: Client disconnected, clean up
- Read timeout: Continue waiting (subscriptions only)

### Protocol Errors
- Invalid JSON: Return parse error (-32700)
- Missing method: Return method not found (-32601)
- Bad parameters: Return invalid params (-32602)
- Handler error: Return internal error (-32603)

## Security Considerations

1. **Authentication**: None - relies on Unix socket permissions
2. **Message Size Limit**: 1MB prevents memory exhaustion
3. **Connection Limit**: OS file descriptor limit
4. **Input Validation**: All inputs validated before processing

## Implementation Checklist

- [ ] Unix socket creation with proper permissions (0600)
- [ ] Line-delimited JSON parser with 1MB limit
- [ ] JSON-RPC 2.0 request/response handling
- [ ] Method registry and routing
- [ ] Concurrent connection handling
- [ ] Subscription event loop with heartbeat
- [ ] Error code mapping
- [ ] Input validation for all methods
- [ ] Graceful shutdown handling
- [ ] Connection cleanup on disconnect