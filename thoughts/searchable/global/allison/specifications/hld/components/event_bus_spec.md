---
component_name: EventBus
component_type: utility
location: hld/bus/
analyzed_date: 2025-06-26
dependencies: []
dependents: [daemon.Daemon, session.Manager, approval.Manager, rpc.Server]
test_coverage: 90
---

# Event Bus Component Specification

## Overview

**Purpose**: In-memory publish-subscribe system for distributing events between daemon components
**Responsibility**: Event routing, subscriber management, and filtered event delivery
**Location**: `hld/bus/`

## Public API

### Exported Types

#### `EventBus`

**Purpose**: Central event distribution system

**Constructor**:
```go
func New(logger *slog.Logger) *EventBus
```

**Methods**:

##### `Publish(event Event)`
- **Purpose**: Publish an event to all interested subscribers
- **Access**: public
- **Parameters**: 
  - `event` (Event): Event to publish
- **Returns**: Nothing (fire-and-forget)
- **File Reference**: `hld/bus/events.go:62`

##### `Subscribe(eventTypes []EventType, filter EventFilter) <-chan Event`
- **Purpose**: Subscribe to specific event types with optional filtering
- **Access**: public
- **Parameters**:
  - `eventTypes` ([]EventType): Event types to subscribe to (empty = all)
  - `filter` (EventFilter): Optional filter function
- **Returns**: Read-only channel for receiving events
- **File Reference**: `hld/bus/events.go:75`

##### `Unsubscribe(ch <-chan Event)`
- **Purpose**: Remove a subscription
- **Access**: public
- **Parameters**:
  - `ch` (<-chan Event): Channel returned from Subscribe
- **Returns**: Nothing
- **File Reference**: `hld/bus/events.go:95`

##### `Close()`
- **Purpose**: Shutdown event bus and close all subscriptions
- **Access**: public
- **Parameters**: None
- **Returns**: Nothing
- **File Reference**: `hld/bus/events.go:108`

### Exported Types

#### `Event`
```go
type Event struct {
    Type      EventType
    Timestamp time.Time
    Data      interface{}
}
```

#### `EventType`
```go
type EventType string

const (
    EventNewApproval         EventType = "new_approval"
    EventApprovalResolved    EventType = "approval_resolved"
    EventSessionStatusChanged EventType = "session_status_changed"
    EventConversationUpdated EventType = "conversation_updated"
)
```

#### `EventFilter`
```go
type EventFilter func(event Event) bool
```

### Event Data Types

#### `NewApprovalData`
```go
type NewApprovalData struct {
    Approvals []*types.Approval
    RunID     string
}
```

#### `ApprovalResolvedData`
```go
type ApprovalResolvedData struct {
    ApprovalID string
    CallID     string
    RunID      string
    Decision   string // "approved", "denied", "responded"
    SessionID  string
}
```

#### `SessionStatusChangedData`
```go
type SessionStatusChangedData struct {
    SessionID string
    OldStatus string
    NewStatus string
}
```

#### `ConversationUpdatedData`
```go
type ConversationUpdatedData struct {
    SessionID       string
    ClaudeSessionID string
    EventType       string // "message", "tool_call", "tool_result"
    Sequence        int
}
```

## Internal Implementation

### Private Types

#### `subscription`
```go
type subscription struct {
    channel    chan Event
    eventTypes map[EventType]bool
    filter     EventFilter
}
```

### Private Fields
- `subscribers` (map[chan Event]*subscription): Active subscriptions
- `mu` (sync.RWMutex): Protects subscriber map
- `logger` (*slog.Logger): Structured logger
- `closed` (bool): Shutdown flag

### Private Methods

##### `shouldReceive(sub *subscription, event Event) bool`
- **Purpose**: Check if subscriber should receive event
- **Algorithm**: Check event type match and apply filter

##### `sendEvent(sub *subscription, event Event)`
- **Purpose**: Send event to subscriber with overflow protection
- **Algorithm**: Non-blocking send with warning on full buffer

### Design Patterns

- **Pattern Used**: Observer/Pub-Sub
- **Rationale**: Decouples event producers from consumers
- **Implementation Details**: Channel-based delivery with filtering

## State Management

### Component State
- **Subscribers Map**: All active subscriptions
- **Closed Flag**: Prevents new operations after close
- **Mutex Protection**: Thread-safe operations

### Channel Management
- **Buffer Size**: 100 events per subscriber
- **Overflow Behavior**: Drop events with warning
- **Cleanup**: Channels closed on unsubscribe/shutdown

## Error Handling

### Error Scenarios
- **Buffer Overflow**: Log warning and drop event
- **Closed EventBus**: Panic on operations after close
- **Nil Filter**: Treated as match-all

### Recovery Strategies
- Non-blocking sends prevent deadlock
- Defensive nil checks
- Graceful degradation on overflow

## Configuration

### Constants
- `SubscriberBufferSize`: 100 events per channel
- No external configuration required

## Performance Characteristics

- **Publish Time**: O(n) where n = number of subscribers
- **Subscribe Time**: O(1)
- **Memory Usage**: 100 events × 8 bytes × subscribers
- **Concurrency**: Read-write lock for subscriber map

## Testing

### Test Coverage
- Unit Tests: 90% coverage
- Concurrency Tests: Race condition testing

### Key Test Scenarios
1. Basic pub-sub functionality
2. Event type filtering
3. Custom filter functions
4. Multiple subscribers
5. Concurrent publish/subscribe
6. Buffer overflow handling
7. Graceful shutdown

### Test File Location
- Unit tests: `hld/bus/events_test.go`
- Mock: `hld/bus/mock_bus.go`

## Security Considerations

- **Local Only**: In-memory, no network exposure
- **No Authentication**: Assumes trusted environment
- **No Persistence**: Events lost on restart
- **Type Safety**: Interface{} data requires careful casting

## Future Considerations

- **Persistent Events**: Add optional event logging
- **Priority Events**: High-priority event lanes
- **Event Replay**: Replay recent events to new subscribers
- **Metrics**: Event count and latency tracking
- **Dead Letter Queue**: Handle failed deliveries

## Code Examples

### Basic Publisher
```go
eventBus := bus.New(logger)

// Publish session status change
eventBus.Publish(bus.Event{
    Type:      bus.EventSessionStatusChanged,
    Timestamp: time.Now(),
    Data: bus.SessionStatusChangedData{
        SessionID: "sess_123",
        OldStatus: "running",
        NewStatus: "completed",
    },
})
```

### Filtered Subscriber
```go
// Subscribe to approval events for specific run
events := eventBus.Subscribe(
    []bus.EventType{bus.EventNewApproval, bus.EventApprovalResolved},
    func(event bus.Event) bool {
        switch data := event.Data.(type) {
        case bus.NewApprovalData:
            return data.RunID == "run_456"
        case bus.ApprovalResolvedData:
            return data.RunID == "run_456"
        }
        return false
    },
)

// Process events
for event := range events {
    switch event.Type {
    case bus.EventNewApproval:
        // Handle new approval
    case bus.EventApprovalResolved:
        // Handle resolved approval
    }
}
```

### Graceful Shutdown
```go
// In main shutdown
eventBus.Close()
// All subscriber channels will be closed
```

## Related Documentation

- RPC Subscriptions: [`../rpc_server_spec.md`](../rpc_server_spec.md)
- Session Manager: [`../session_manager_spec.md`](../session_manager_spec.md)
- Approval Manager: [`../approval_manager_spec.md`](../approval_manager_spec.md)