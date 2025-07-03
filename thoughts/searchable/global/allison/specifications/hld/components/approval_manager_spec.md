---
component_name: ApprovalManager
component_type: service
location: hld/approval/
analyzed_date: 2025-06-26
dependencies: [client.Client, bus.EventBus, store.Store]
dependents: [daemon.Daemon, rpc.Server]
test_coverage: 70
---

# Approval Manager Component Specification

## Overview

**Purpose**: Manages human-in-the-loop approval workflows by polling HumanLayer API and correlating approvals with local sessions
**Responsibility**: Fetch approvals, track state changes, emit events, and handle approval decisions
**Location**: `hld/approval/`

## Public API

### Exported Types

#### `Manager`

**Purpose**: Main approval management service

**Constructor**:
```go
func NewManager(logger *slog.Logger, client client.Client, eventBus *bus.EventBus, correlator *Correlator) *Manager
```

**Methods**:

##### `Start(ctx context.Context) error`
- **Purpose**: Start the approval polling loop
- **Access**: public
- **Parameters**: 
  - `ctx` (context.Context): Context for cancellation
- **Returns**: error if startup fails
- **File Reference**: `hld/approval/manager.go:66`

##### `FetchApprovals(ctx context.Context, runID string) ([]*types.Approval, error)`
- **Purpose**: Fetch pending approvals from HumanLayer API
- **Access**: public
- **Parameters**:
  - `ctx` (context.Context): Context
  - `runID` (string): Optional filter by run ID
- **Returns**: Array of approvals or error
- **File Reference**: `hld/approval/manager.go:87`

##### `SendDecision(ctx context.Context, callID string, decision types.Decision) error`
- **Purpose**: Send approval decision to HumanLayer API
- **Access**: public
- **Parameters**:
  - `ctx` (context.Context): Context
  - `callID` (string): Call ID to decide on
  - `decision` (types.Decision): Decision details
- **Returns**: error if send fails
- **File Reference**: `hld/approval/manager.go:107`

#### `Correlator`

**Purpose**: Correlates approvals with tool calls in conversations

**Constructor**:
```go
func NewCorrelator(logger *slog.Logger, store store.Store, eventBus *bus.EventBus) *Correlator
```

**Methods**:

##### `CorrelateApprovals(ctx context.Context, approvals []*types.Approval) error`
- **Purpose**: Match approvals with pending tool calls
- **Access**: public
- **Parameters**:
  - `ctx` (context.Context): Context
  - `approvals` ([]*types.Approval): Approvals to correlate
- **Returns**: error if correlation fails
- **File Reference**: `hld/approval/correlator.go:39`

#### `Poller`

**Purpose**: Polls for approvals with exponential backoff

**Constructor**:
```go
func NewPoller(config PollerConfig) *Poller
```

**Configuration**:
```go
type PollerConfig struct {
    FetchFunc      func(context.Context) ([]*types.Approval, error)
    CorrelateFunc  func(context.Context, []*types.Approval) error
    Logger         *slog.Logger
    EventBus       *bus.EventBus
    PollInterval   time.Duration // Default: 5s
    MaxBackoff     time.Duration // Default: 5m
    BackoffFactor  float64       // Default: 2.0
}
```

##### `Start(ctx context.Context)`
- **Purpose**: Start polling loop with backoff
- **Access**: public
- **File Reference**: `hld/approval/poller.go:53`

### Exported Types

#### `types.Approval`
```go
type Approval struct {
    ID           string
    CallID       string
    RunID        string
    Type         string // "function_call" or "human_contact"
    Status       string // "pending", "approved", "denied"
    FunctionName string
    FunctionArgs map[string]interface{}
    RequestedAt  time.Time
    TimeoutAt    time.Time
}
```

#### `types.Decision`
```go
type Decision struct {
    Type     string // "function_call" or "human_contact"
    Decision string // "approve", "deny", or "respond"
    Comment  string // Required for deny/respond
}
```

## Internal Implementation

### Private Functions

#### Manager Private Methods

##### `pollOnce(ctx context.Context) error`
- **Purpose**: Single poll iteration
- **Algorithm**: Fetch approvals → correlate → handle errors

#### Correlator Private Methods

##### `findToolCall(ctx context.Context, approval *types.Approval) (*store.ConversationEvent, error)`
- **Purpose**: Find matching tool call for approval
- **Algorithm**: Query by function name and args within time window

##### `updateToolCallApproval(ctx context.Context, event *store.ConversationEvent, approval *types.Approval) error`
- **Purpose**: Update tool call with approval status
- **Algorithm**: Update database and emit events

##### `updateSessionStatus(ctx context.Context, sessionID string) error`
- **Purpose**: Update session status based on approvals
- **Algorithm**: Set to waiting_input if pending, running if none

### Design Patterns

- **Pattern Used**: Observer (via EventBus) + Strategy (pluggable fetch/correlate)
- **Rationale**: Decoupled approval sources and flexible correlation
- **Implementation Details**: Event-driven updates, pluggable functions

## Dependencies

### External Dependencies
- None directly (uses injected interfaces)

### Internal Dependencies
- `../client`: HumanLayer API client interface
- `../bus`: Event bus for notifications
- `../store`: Database for correlation
- `./types`: Shared type definitions

## State Management

### Component State
- **Poller State**: 
  - Current backoff duration
  - Last poll time
  - Error count
- **Manager State**: Stateless (delegates to poller)
- **Correlator State**: Stateless (uses store)

## Error Handling

### Error Types
- API communication errors
- Correlation failures
- Database errors
- Validation errors

### Recovery Strategies
- **Exponential Backoff**: Increases delay on consecutive errors
- **Maximum Backoff**: Caps at 5 minutes
- **Reset on Success**: Returns to normal polling interval
- **Partial Success**: Continues despite individual correlation failures

## Configuration

### Polling Configuration
- `PollInterval`: Base polling interval (default: 5s)
- `MaxBackoff`: Maximum backoff duration (default: 5m)
- `BackoffFactor`: Backoff multiplier (default: 2.0)

### API Configuration
- Requires `HUMANLAYER_API_KEY` for API access
- Uses client's base URL configuration

## Performance Characteristics

- **Polling Frequency**: 5s base, up to 5m on errors
- **Correlation Time**: O(n) with n approvals
- **Memory Usage**: Minimal, approvals not cached
- **API Calls**: 1 per poll interval + 1 per decision

## Testing

### Test Coverage
- Unit Tests: 70% coverage
- Integration Tests: Correlation scenarios

### Key Test Scenarios
1. Successful approval correlation
2. Backoff behavior on errors
3. Multiple approval handling
4. Status update logic
5. External resolution detection
6. Partial correlation failures

### Test File Location
- Unit tests: `hld/approval/*_test.go`
- Mocks: `hld/approval/mock_approval.go`

## Security Considerations

- **API Key**: Required for HumanLayer API access
- **Approval Validation**: Ensures approval matches tool call
- **Time Window**: 5-minute window for correlation
- **No Direct Execution**: Only updates status, doesn't execute

## Future Considerations

- **Webhook Support**: Replace polling with push notifications
- **Batch Decisions**: Send multiple decisions in one call
- **Caching**: Cache recent approvals to reduce API calls
- **Metrics**: Add approval resolution time tracking

## Code Examples

### Basic Usage
```go
// Create approval manager
manager := approval.NewManager(logger, apiClient, eventBus, correlator)

// Start polling
go manager.Start(ctx)

// Fetch approvals manually
approvals, err := manager.FetchApprovals(ctx, runID)

// Send decision
decision := types.Decision{
    Type:     "function_call",
    Decision: "approve",
    Comment:  "Looks good",
}
err = manager.SendDecision(ctx, callID, decision)
```

### Custom Polling Configuration
```go
poller := approval.NewPoller(approval.PollerConfig{
    FetchFunc:     fetchFunc,
    CorrelateFunc: correlateFunc,
    Logger:        logger,
    EventBus:      eventBus,
    PollInterval:  10 * time.Second,
    MaxBackoff:    10 * time.Minute,
    BackoffFactor: 1.5,
})
```

## Related Documentation

- Event Bus: [`../event_bus_spec.md`](../event_bus_spec.md)
- Store Interface: [`../store_spec.md`](../store_spec.md)
- API Client: [`../client_spec.md`](../client_spec.md)