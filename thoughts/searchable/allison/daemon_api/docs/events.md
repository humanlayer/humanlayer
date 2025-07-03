# Event System Documentation

## Overview

The daemon provides real-time updates through Server-Sent Events (SSE), a standard HTTP streaming protocol supported by OpenAPI.

## Event Types

### Session Events

```typescript
// Session status changed
{
  "type": "session_status_changed",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "session_id": "abc123",
    "old_status": "running",
    "new_status": "waiting_input",
    "run_id": "xyz789"
  }
}

// New conversation content
{
  "type": "conversation_updated",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "session_id": "abc123",
    "event_type": "message",
    "role": "assistant",
    "content": "I'll help you with that..."
  }
}
```

### Approval Events

```typescript
// New approval created
{
  "type": "new_approval",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "approval_id": "app123",
    "session_id": "abc123",
    "tool_name": "Edit",
    "created": true
  }
}

// Approval resolved
{
  "type": "approval_resolved",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "approval_id": "app123",
    "decision": "approved",
    "comment": "Looks good"
  }
}
```

## Client Implementation

### JavaScript/TypeScript

```typescript
const eventSource = new EventSource('/api/v1/events?session_id=abc123')

eventSource.onmessage = event => {
  const data = JSON.parse(event.data)
  console.log('Event:', data)
}

eventSource.onerror = error => {
  console.error('SSE error:', error)
  // EventSource automatically reconnects
}

// Clean up when done
eventSource.close()
```

### Go Client

```go
resp, err := http.Get("http://localhost:7777/api/v1/events")
if err != nil {
    return err
}
defer resp.Body.Close()

reader := bufio.NewReader(resp.Body)
for {
    line, err := reader.ReadString('\n')
    if err != nil {
        return err
    }

    if strings.HasPrefix(line, "data: ") {
        data := strings.TrimPrefix(line, "data: ")
        var event Event
        if err := json.Unmarshal([]byte(data), &event); err != nil {
            continue
        }
        handleEvent(event)
    }
}
```

## Filtering

Subscribe to specific event types or sessions:

```
GET /api/v1/events?types=new_approval,approval_resolved&session_id=abc123
```

## Benefits

1. **Standard Protocol** - Works in all browsers
2. **Auto-reconnect** - Built-in resilience
3. **Simple** - Just HTTP, no WebSocket complexity
4. **Efficient** - Single connection for all events
5. **OpenAPI Compatible** - Fully documented in spec
