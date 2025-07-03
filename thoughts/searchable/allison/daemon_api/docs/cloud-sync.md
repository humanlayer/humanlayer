# Cloud Sync Architecture

## Overview

The cloud sync feature enables remote access to locally running daemons through a NAT-friendly architecture.

## Design Principles

1. **Outbound-only connections** - Daemons connect to cloud, not vice versa
2. **HTTP/2 for efficiency** - Single connection, multiple streams
3. **Long polling** - Near real-time without WebSockets
4. **Same API surface** - Cloud mirrors daemon API

## Sync Protocol

### Daemon → Cloud Communication

```go
// Daemon initiates sync session
POST /sync/connect
{
  "daemon_id": "abc123",
  "version": "1.0.0",
  "capabilities": ["approvals", "sessions", "streaming"]
}

// Long poll for commands
POST /sync/poll
{
  "daemon_id": "abc123",
  "updates": [
    {
      "type": "session_created",
      "data": { ... }
    },
    {
      "type": "approval_resolved",
      "data": { ... }
    }
  ],
  "wait_for_commands": true,
  "timeout": 30
}

// Response includes commands for daemon
{
  "commands": [
    {
      "id": "cmd-123",
      "method": "getApproval",
      "params": { "approval_id": "xyz" }
    }
  ]
}

// Daemon sends command results
POST /sync/results
{
  "daemon_id": "abc123",
  "results": [
    {
      "command_id": "cmd-123",
      "result": { /* approval data */ },
      "error": null
    }
  ]
}
```

### Cloud → Client API

The cloud exposes the same REST API as the daemon:

```
GET  /api/v1/daemons/{daemon_id}/sessions
POST /api/v1/daemons/{daemon_id}/sessions
GET  /api/v1/daemons/{daemon_id}/approvals
...
```

When a client calls the cloud API:

1. Cloud queues the command for the daemon
2. Daemon picks up command in next poll
3. Daemon executes and returns result
4. Cloud returns result to client

## Implementation Details

### Connection Management

```go
type CloudSync struct {
    daemonID   string
    cloudURL   string
    httpClient *http.Client  // HTTP/2 enabled

    // Command queue
    commandQueue chan CloudCommand
    resultQueue  chan CommandResult
}

func (cs *CloudSync) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            cs.pollAndProcess(ctx)
        }
    }
}
```

### State Synchronization

The daemon maintains a change log:

```go
type ChangeLog struct {
    changes []Change
    mu      sync.RWMutex
}

type Change struct {
    Type      string    // session_created, approval_updated, etc
    Timestamp time.Time
    Data      interface{}
}

// Batch changes for efficient sync
func (cl *ChangeLog) Batch(since time.Time) []Change {
    cl.mu.RLock()
    defer cl.mu.RUnlock()

    var batch []Change
    for _, change := range cl.changes {
        if change.Timestamp.After(since) {
            batch = append(batch, change)
        }
    }
    return batch
}
```

### Security

1. **Authentication**: API key or mutual TLS
2. **Encryption**: All traffic over HTTPS
3. **Access Control**: Daemon-specific namespacing
4. **Rate Limiting**: Prevent abuse

## Streaming Considerations

The REST API includes a streaming endpoint for large contexts:

```
GET /api/v1/approvals/{id}/context/stream
```

This creates challenges for cloud sync:

### Option 1: Proxy Streaming (Simple)

Cloud acts as a pass-through:

```
Client → Cloud → Daemon (streaming)
Cloud holds connection open and proxies chunks
```

### Option 2: Cache and Serve (Complex)

Cloud fetches full context, then streams to client:

```
1. Cloud requests context from daemon
2. Daemon sends full context in sync response
3. Cloud streams to client from cache
```

### Option 3: Stream Commands (Advanced)

Special streaming support in sync protocol:

```json
// Cloud sends stream command
{
  "id": "cmd-123",
  "method": "streamApprovalContext",
  "params": { "approval_id": "xyz" },
  "stream": true
}

// Daemon sends multiple responses
{
  "command_id": "cmd-123",
  "chunk": 0,
  "data": "...",
  "complete": false
}
```

### Recommendation

Start with Option 1 (proxy streaming) for simplicity. The cloud holds the connection open and proxies SSE chunks between daemon and client. This requires minimal changes to the sync protocol.

## Benefits

1. **No port forwarding** required
2. **Works behind firewalls** and NAT
3. **Efficient** - single HTTP/2 connection
4. **Type-safe** - same OpenAPI spec
5. **Graceful degradation** - works offline
6. **Streaming support** - via proxy or caching
