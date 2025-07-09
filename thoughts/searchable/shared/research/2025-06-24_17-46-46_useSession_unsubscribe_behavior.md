# Research: useSession Unsubscribe Behavior and Event Filtering

**Date**: 2025-06-24 17:46:37 PDT  
**Researcher**: nyx  
**Git Commit**: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36  
**Branch**: sundeep/eng-1428-when-session-status-changes-while-on-a-sessiondetail-page

## Research Question

How does the "unlisten" behavior tied to `@humanlayer-wui/src/hooks/useSessions.ts` (specifically `useSession`) work? How are `event_types` and `session_id` used when subscribing, and how are these used to filter what comes back?

## Summary

The `useSession` hook implements a multi-layer subscription system for real-time session status updates. However, there's a **critical architectural mismatch**: the frontend implements subscription-based lifecycle management while the HLD daemon expects connection-based cleanup. This results in subscriptions accumulating without proper cleanup, as evidenced by missing unsubscribe logs and increasing subscription IDs.

## Detailed Findings

### Event Subscription Architecture

The event system follows this multi-layer architecture:

```
React → TypeScript Client → Tauri Bridge → Rust Client → Unix Socket → Go Daemon → Event Bus
```

### 1. React Hook Layer (`humanlayer-wui/src/hooks/useSessions.ts`)

**useSession Hook** (Lines 86-174):

- **Subscription Setup** (Lines 123-127): Filters events by `event_types: ['session_status_changed']` and `session_id`
- **Event Handling** (Lines 129-137): Refreshes session data when status changes
- **Cleanup Attempt** (Lines 161-165): Calls `unsubscribe?.()` on component unmount
- **Fallback Polling** (Lines 141-150): Falls back to 3-second polling if subscription fails

### 2. TypeScript Client Layer (`humanlayer-wui/src/lib/daemon/client.ts`)

**subscribeToEvents Method** (Lines 65-86):

- **Tauri Integration**: Calls `invoke('subscribe_to_events')` with filter parameters
- **Event Listening**: Listens for `'daemon-event'` events via Tauri
- **Unsubscribe Return**: Returns Tauri's `unlisten()` function

**Filter Structure** (`humanlayer-wui/src/lib/daemon/types.ts:281-285`):

```typescript
export interface SubscribeRequest {
  event_types?: string[] // Filter by event types
  session_id?: string // Filter by session ID
  run_id?: string // Filter by run ID
}
```

### 3. Tauri Bridge Layer (`humanlayer-wui/src-tauri/src/lib.rs`)

**subscribe_to_events Command** (Lines 195-249):

- **Input Processing**: Logs subscription parameters for debugging
- **Client Delegation**: Calls Rust client's `subscribe()` method
- **Event Forwarding**: Spawns async task to forward events via `app.emit("daemon-event")`
- **⚠️ Missing Unsubscribe Command**: No corresponding `unsubscribe_to_events` command exists

### 4. Rust Client Layer (`humanlayer-wui/src-tauri/src/daemon_client/`)

**Subscription Manager** (`subscriptions.rs`):

**create_subscription** (Lines 25-71):

- **Buffered Channel**: Creates 100-event buffer to prevent blocking
- **JSON-RPC Request**: Sends "Subscribe" request to daemon
- **Connection Lifecycle**: Spawns async handler for connection management

**Cancellation Mechanism** (Lines 74-80):

```rust
pub async fn cancel_subscription(&self, id: u64) {
    let mut subs = self.active_subscriptions.lock().await;
    if let Some(cancel_tx) = subs.remove(&id) {
        let _ = cancel_tx.send(()).await;
        info!("Cancelled subscription {}", id);
    }
}
```

**Event Processing Loop** (Lines 115-217):

- **Connection Monitoring**: Detects closure via `reader.read_line()`
- **Heartbeat Filtering**: Filters out 30-second heartbeats
- **Cancellation Handling** (Lines 198-200): Exits loop on cancel signal

### 5. Go Daemon Layer (`hld/rpc/subscription_handlers.go`)

**SubscribeConn Method** (Lines 65-203):

- **Filter Creation** (Lines 87-92): Converts request to `bus.EventFilter`
- **Event Bus Integration**: Calls `eventBus.Subscribe()` with filter
- **Connection Monitoring** (Lines 128-149): Uses 100ms read timeouts to detect closure
- **Deferred Cleanup** (Lines 96-99):
  ```go
  defer func() {
      slog.Debug("subscription handler cleaning up", "subscription_id", sub.ID)
      h.eventBus.Unsubscribe(sub.ID)
  }()
  ```

### 6. Event Bus Layer (`hld/bus/events.go`)

**Server-Side Filtering** (Lines 127-179):

**Event Type Filtering** (Lines 129-145):

- **Empty Filter**: No types specified = all types allowed
- **Type Matching**: Iterates through filter types for exact matches

**Session ID Filtering** (Lines 147-159):

- **Data Location**: Checks `event.Data["session_id"]` field
- **Exact Match**: Requires string exact match with filter
- **Debug Logging**: Logs filter comparison details

**Unsubscribe Implementation** (Lines 62-79):

```go
func (eb *eventBus) Unsubscribe(subscriberID string) {
    eb.mu.Lock()
    defer eb.mu.Unlock()

    if sub, ok := eb.subscribers[subscriberID]; ok {
        delete(eb.subscribers, subscriberID)
        sub.cancelFn()
        close(sub.Channel)
        slog.Debug("event bus unsubscribe", "subscriber_id", subscriberID)
    }
}
```

## Code References

- `humanlayer-wui/src/hooks/useSessions.ts:123-127` - Event subscription with filtering
- `humanlayer-wui/src/hooks/useSessions.ts:161-165` - Cleanup attempt on unmount
- `humanlayer-wui/src-tauri/src/lib.rs:195-249` - Tauri subscription command (no unsubscribe)
- `humanlayer-wui/src-tauri/src/daemon_client/subscriptions.rs:74-80` - Rust cancellation mechanism
- `hld/rpc/subscription_handlers.go:96-99` - Go deferred cleanup
- `hld/bus/events.go:62-79` - Event bus unsubscribe implementation
- `hld/bus/events.go:147-159` - Session ID filtering logic

## Architecture Insights

### Event Filtering Design

1. **Client-Side Specification**: Filters defined in React/TypeScript as `{event_types: [], session_id: string}`
2. **Server-Side Processing**: Go daemon performs actual filtering to reduce network traffic
3. **Efficient Distribution**: Only matching events sent to subscribers

### Connection Management Philosophy

- **HLD Design**: Expects connection closure to trigger cleanup (connection-based lifecycle)
- **WUI Implementation**: Uses subscription IDs and explicit cleanup (subscription-based lifecycle)
- **Mismatch Result**: Subscriptions accumulate without proper cleanup

### Real-Time Architecture Benefits

- **Immediate Updates**: Events propagate from session manager to UI without polling
- **Resource Efficiency**: Server-side filtering reduces bandwidth
- **Session Isolation**: Fine-grained subscriptions prevent unnecessary updates

## Critical Issue Identified

### The Problem: Missing Unsubscribe RPC Method

**Root Cause**: Architectural mismatch between design assumptions:

- **HLD Assumes**: "connection closes = unsubscribe"
- **WUI Implements**: "stop listening ≠ close connection"

**Evidence from Testing**:

- ✅ Frontend logs show "unsubscribe called"
- ❌ No Rust client cancellation logs (`"Subscription {} cancelled"`)
- ❌ No HLD cleanup logs (`"subscription handler cleaning up"`)
- ❌ No event bus unsubscribe logs (`"event bus unsubscribe"`)
- ❌ Subscription IDs accumulate (907, 909, 915, 917) without cleanup

**Technical Analysis**:

1. **React calls** `unsubscribe?.()` → Tauri `unlisten()`
2. **Tauri stops** forwarding events to frontend
3. **Unix socket connection** remains open to daemon
4. **Daemon subscription** continues running indefinitely
5. **Event bus subscriber** never removed from active list

### Missing Components

**No Unsubscribe RPC Method**:

- HLD has no `HandleUnsubscribe` method registered
- Only `server.Register("Subscribe", h.HandleSubscribe)` exists
- No way for clients to explicitly terminate subscriptions

**Incomplete Tauri Bridge**:

- `subscribe_to_events` command exists
- No corresponding `unsubscribe_to_events` command
- Rust client has cancellation capability but no way to trigger it

## Historical Context (from thoughts/)

### Event System Evolution

From **thoughts/allison/daemon_api/docs/events.md**:

- Originally designed with Server-Sent Events (SSE) for HTTP compatibility
- Current JSON-RPC implementation uses long-polling with 30-second heartbeats
- Event filtering supported: `GET /api/v1/events?types=new_approval&session_id=abc123`

### Architecture Philosophy

From **thoughts/allison/daemon_api/docs/design-rationale.md**:

- **Daemon-First Architecture**: Data sovereignty, low latency, offline capable
- **Connection-Based Design**: Unix sockets with single persistent connections
- **Event Distribution**: Server-side filtering for efficiency

### Known Session Management Issues

From **thoughts/shared/research/2025-06-24_10-17-43_hld-daemon-interface.md**:

- 100-item buffered channels prevent blocking on slow consumers
- Session resume loses MCP configuration (critical bug identified)
- 13 distinct request types across 5 functional areas

## Recommended Solutions

### Option 1: Add Explicit Unsubscribe RPC Method (Recommended)

**Implementation Steps**:

1. **HLD**: Add `HandleUnsubscribe` method and register "Unsubscribe" RPC
2. **Rust Client**: Add `unsubscribe()` method calling daemon RPC
3. **Tauri**: Add `unsubscribe_from_events` command
4. **React**: Track subscription IDs and call explicit unsubscribe on unmount

**Benefits**:

- Follows standard pub/sub patterns
- Explicit lifecycle management
- Better debugging and resource tracking
- Supports multiple subscriptions per connection

### Option 2: Fix Connection Lifecycle Management

**Make WUI properly close Unix socket connections when components unmount**

- Let existing deferred cleanup handle unsubscribe
- Works with current HLD design but less efficient

### Option 3: Hybrid Reference Counting

**Track active subscriptions per connection**

- Multiple subscriptions share connections
- Close connection only when all subscriptions cancelled

## Open Questions

1. **Performance Impact**: How many accumulated subscriptions before performance degrades?
2. **Memory Leaks**: Are event bus subscribers causing memory leaks in long-running daemons?
3. **Connection Limits**: Unix socket connection limits with current architecture?
4. **Migration Strategy**: How to implement unsubscribe without breaking existing clients?

## Related Research

- Architecture evolution documented in `thoughts/allison/daemon_api/docs/architecture.md`
- JSON-RPC protocol details in `thoughts/allison/daemon_api/docs/jsonrpc-protocol.md`
- Session management context in `thoughts/shared/research/2025-06-24_10-17-43_hld-daemon-interface.md`
