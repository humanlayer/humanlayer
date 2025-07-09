---
component_name: Sequence Diagrams
component_type: workflow
location: hld/
analyzed_date: 2025-06-26
dependencies: []
dependents: []
test_coverage: n/a
---

# HLD Sequence Diagrams (Language-Agnostic)

## Overview

This document provides detailed sequence diagrams for all major workflows in the HumanLayer Daemon, showing exact message flows, timing, and error handling.

## 1. Session Launch Sequence

```
Client          RPC Server      Session Manager    Store           Event Bus       Claude Process
  |                 |                  |              |                 |                |
  |--launchSession->|                  |              |                 |                |
  |                 |--LaunchSession-->|              |                 |                |
  |                 |                  |              |                 |                |
  |                 |                  |--CreateSession-->|             |                |
  |                 |                  |              |<--OK-----------|                |
  |                 |                  |              |                 |                |
  |                 |                  |--Emit-------->|                 |                |
  |                 |                  |   (starting)  |<--Event--------|                |
  |                 |                  |              |                 |                |
  |                 |                  |--SpawnProcess----------------->|                |
  |                 |                  |              |                 |<--PID----------|
  |                 |                  |              |                 |                |
  |                 |<--SessionCreated-|              |                 |                |
  |<--Response------|                  |              |                 |                |
  |  {session_id,   |                  |              |                 |                |
  |   run_id}       |                  |              |                 |                |
  |                 |                  |              |                 |                |
  |                 |                  |--PollForID--->|                 |                |
  |                 |                  |  (async)      |                 |                |
  |                 |                  |              |                 |                |
  |                 |                  |<--ClaudeID----|                 |                |
  |                 |                  |              |                 |<--SessionID----|
  |                 |                  |              |                 |                |
  |                 |                  |--UpdateStatus->|                |                |
  |                 |                  |   (running)   |<--OK-----------|                |
  |                 |                  |              |                 |                |
  |                 |                  |--Emit-------->|                 |                |
  |                 |                  |              |<--Event--------|                |
```

**Timing**:
- Session creation: < 100ms
- Process spawn: < 500ms
- Claude ID poll: 500ms intervals, up to 60s timeout
- Total launch time: 1-5 seconds typical

## 2. Approval Correlation Sequence

```
API Poller     Approval Manager    Correlator        Store          Event Bus      Session Manager
    |                |                  |                |                |                |
    |--Timer(5s)--->|                  |                |                |                |
    |                |--FetchApprovals->|                |                |                |
    |                |  (HTTP)          |                |                |                |
    |                |<--Approvals------|                |                |                |
    |                |                  |                |                |                |
    |                |--Correlate------>|                |                |                |
    |                |                  |                |                |                |
    |                |                  |--FindSession-->|                |                |
    |                |                  |<--Session------|                |                |
    |                |                  |                |                |                |
    |                |                  |--FindToolCall->|                |                |
    |                |                  |<--ToolCall-----|                |                |
    |                |                  |                |                |                |
    |                |                  |--UpdateApproval->|              |                |
    |                |                  |<--OK-----------|                |                |
    |                |                  |                |                |                |
    |                |                  |--EmitNewApproval->|             |                |
    |                |                  |                |<--Event--------|                |
    |                |                  |                |                |                |
    |                |                  |--UpdateStatus----------------->|                |
    |                |                  |  (waiting_input)               |<--OK-----------|
    |                |                  |                |                |                |
    |                |                  |--EmitStatusChange->|           |                |
    |                |                  |                |<--Event--------|                |
```

**Timing**:
- Poll interval: 5 seconds
- API fetch: < 1 second typical
- Correlation: < 100ms per approval
- Total correlation time: < 2 seconds

## 3. Subscription (Long-Polling) Sequence

```
Client          RPC Server      Event Bus       Session Manager    Timer
  |                 |                |                |              |
  |--Subscribe----->|                |                |              |
  |                 |--Subscribe---->|                |              |
  |                 |<--Channel------|                |              |
  |                 |                |                |              |
  |<--Initial-------|                |                |              |
  |  Response       |                |                |              |
  |  {sub_id}       |                |                |              |
  |                 |                |                |              |
  |                 |--Wait--------->|                |              |
  |                 |  (blocking)    |                |              |
  |                 |                |                |              |
  |                 |                |<--Event--------|              |
  |                 |<--Event--------|                |              |
  |<--Event---------|                |                |              |
  |  Notification   |                |                |              |
  |                 |                |                |              |
  |                 |--Wait--------->|                |              |
  |                 |                |                |              |
  |                 |                |                |<--30s--------|
  |                 |<--Heartbeat----|                |              |
  |<--Heartbeat-----|                |                |              |
  |                 |                |                |              |
  |--Close--------->|                |                |              |
  |                 |--Unsubscribe-->|                |              |
  |                 |                |--Close-------->|              |
```

**Timing**:
- Initial response: < 100ms
- Event delivery: < 10ms from publish
- Heartbeat: Every 30 seconds
- Connection timeout: None (until client disconnects)

## 4. Approval Decision Sequence

```
Client          RPC Server    Approval Manager     API           Store         Event Bus
  |                 |                |              |              |               |
  |--sendDecision-->|                |              |              |               |
  |                 |--SendDecision->|              |              |               |
  |                 |                |              |              |               |
  |                 |                |--HTTP POST-->|              |               |
  |                 |                |  /respond    |              |               |
  |                 |                |<--200 OK-----|              |               |
  |                 |                |              |              |               |
  |                 |                |--UpdateApprovalStatus------>|               |
  |                 |                |<--OK------------------------|               |
  |                 |                |              |              |               |
  |                 |                |--UpdateSessionStatus-------->|               |
  |                 |                |  (running)                   |               |
  |                 |                |<--OK------------------------|               |
  |                 |                |              |              |               |
  |                 |                |--EmitApprovalResolved------->|               |
  |                 |                |              |              |<--Event-------|
  |                 |                |              |              |               |
  |                 |<--Success------|              |              |               |
  |<--Response------|                |              |              |               |
```

**Error Cases**:
- 409 Conflict: Already responded → Return error
- 404 Not Found: Approval doesn't exist → Return error
- 5xx Error: API error → Return error

## 5. Session Continuation Sequence

```
Client          RPC Server    Session Manager      Store          Event Bus
  |                 |                |               |                |
  |--continueSession->|              |               |                |
  |                 |--Continue----->|               |                |
  |                 |                |               |                |
  |                 |                |--GetParent--->|                |
  |                 |                |<--Parent------|                |
  |                 |                |               |                |
  |                 |                |--GetHistory-->|                |
  |                 |                |<--Events------|                |
  |                 |                |               |                |
  |                 |                |--CreateChild->|                |
  |                 |                |  (with parent)|                |
  |                 |                |<--OK----------|                |
  |                 |                |               |                |
  |                 |                |--CopyMCP----->|                |
  |                 |                |<--OK----------|                |
  |                 |                |               |                |
  |                 |                |--LaunchClaude-|                |
  |                 |                |  (with history)                |
  |                 |                |               |                |
  |                 |<--NewSession---|               |                |
  |<--Response------|                |               |                |
  |  {session_id,   |                |               |                |
  |   parent_id}    |                |               |                |
```

**Key Points**:
- Parent session history included in child
- New session ID generated
- Independent state tracking
- MCP config inherited from parent

## 6. Daemon Startup Sequence

```
Main            Daemon          Store         Session Manager    Approval Manager    RPC Server
  |                |               |                |                   |                |
  |--New---------->|               |                |                   |                |
  |                |--Initialize-->|                |                   |                |
  |                |               |--CreateTables->|                   |                |
  |                |               |<--OK-----------|                   |                |
  |                |               |                |                   |                |
  |                |--NewManager---------------->|                   |                |
  |                |               |                |--CleanupOrphans-->|                |
  |                |               |                |<--Count-----------|                |
  |                |               |                |                   |                |
  |                |--NewManager---------------------------------->|                |
  |                |               |                |                   |--Start-------->|
  |                |               |                |                   |  (polling)     |
  |                |               |                |                   |                |
  |                |--NewServer--------------------------------------------------->|
  |                |               |                |                   |                |
  |                |--Listen------------------------------------------------------>|
  |                |               |                |                   |                |
  |<--Ready---------|               |                |                   |                |
  |                |               |                |                   |                |
  |--Run----------->|               |                |                   |                |
  |                |--Accept------------------------------------------------------->|
  |                |  (loop)        |                |                   |                |
```

**Timing**:
- Database init: < 100ms
- Orphan cleanup: < 500ms
- Total startup: < 1 second

## 7. Error Recovery Sequences

### 7.1 API Polling Error Recovery
```
Poller          Approval Manager       Logger
  |                   |                   |
  |--Timer(5s)------->|                   |
  |                   |--FetchApprovals-->|
  |                   |<--Error-----------|
  |                   |                   |
  |                   |--LogError-------->|
  |                   |                   |
  |--Timer(10s)------>|  (backoff x2)    |
  |                   |--FetchApprovals-->|
  |                   |<--Error-----------|
  |                   |                   |
  |--Timer(20s)------>|  (backoff x2)    |
  |                   |--FetchApprovals-->|
  |                   |<--Success---------|
  |                   |                   |
  |--Timer(5s)------->|  (reset backoff) |
```

### 7.2 Connection Error Recovery
```
Client          RPC Server      Logger
  |                 |              |
  |--Request------->|              |
  |                 |--Process---->|
  |                 |              |
  |  (disconnect)   |              |
  |                 |--Write------>|
  |                 |<--EPIPE------|
  |                 |              |
  |                 |--LogError--->|
  |                 |--Cleanup---->|
  |                 |              |
```

## Message Formats

### RPC Messages
```json
// Request
{
  "jsonrpc": "2.0",
  "method": "methodName",
  "params": {...},
  "id": 1
}

// Response
{
  "jsonrpc": "2.0",
  "result": {...},
  "id": 1
}

// Error
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Error message",
    "data": {...}
  },
  "id": 1
}
```

### Event Messages
```json
// Session Status Changed
{
  "type": "session_status_changed",
  "timestamp": "2025-06-26T10:00:00Z",
  "data": {
    "session_id": "sess_123",
    "old_status": "running",
    "new_status": "waiting_input"
  }
}

// New Approval
{
  "type": "new_approval",
  "timestamp": "2025-06-26T10:00:00Z",
  "data": {
    "approvals": [...],
    "run_id": "run_123"
  }
}
```

## Implementation Notes

1. **Async Operations**: Background tasks use goroutines/threads
2. **Timeouts**: All external calls have timeouts (30s default)
3. **Retries**: API calls retry with exponential backoff
4. **Cleanup**: All resources cleaned up on error/disconnect
5. **Ordering**: Events delivered in order per subscriber