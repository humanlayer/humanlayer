---
date: 2025-06-24T17:57:10-07:00
researcher: sundeep
git_commit: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
branch: sundeep/eng-1428-when-session-status-changes-while-on-a-sessiondetail-page
repository: humanlayer
topic: 'Validation of useSession Unsubscribe Behavior and Event Filtering'
tags: [research, codebase, useSession, subscriptions, event-filtering, unsubscribe, validation]
status: complete
last_updated: 2025-06-24
last_updated_by: sundeep
---

# Research: Validation of useSession Unsubscribe Behavior and Event Filtering

**Date**: 2025-06-24 17:57:10 PDT  
**Researcher**: sundeep  
**Git Commit**: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36  
**Branch**: sundeep/eng-1428-when-session-status-changes-while-on-a-sessiondetail-page  
**Repository**: humanlayer

## Research Question

Validate the findings in the previous research document about useSession unsubscribe behavior and re-research everything to ensure accuracy.

## Summary

After comprehensive validation through parallel investigation of all components, I can confirm that the original research document's core findings are **accurate**. The critical architectural mismatch between the frontend's subscription-based lifecycle and the backend's connection-based cleanup is real and leads to subscription accumulation without proper cleanup. The missing unsubscribe RPC method is confirmed, and the event filtering implementation works as documented.

## Detailed Findings

### React Hook Layer (`humanlayer-wui/src/hooks/useSessions.ts`)

**Verified findings:**

- **useSession Hook** (Lines 86-174): Subscribes to `session_status_changed` events for a specific session
- **Event Subscription** (Lines 123-127): Correctly filters by `event_types: ['session_status_changed']` and `session_id`
- **Cleanup Attempt** (Lines 161-165): Calls `unsubscribe?.()` which is the Tauri unlisten function
- **Fallback Polling** (Lines 141-150): Falls back to 3-second polling on subscription error for running/starting sessions

**New insights:**

- The `isActive` flag prevents race conditions during cleanup
- Polling automatically stops after 30 seconds to prevent indefinite resource usage

### TypeScript Client Layer (`humanlayer-wui/src/lib/daemon/client.ts`)

**Verified findings:**

- **subscribeToEvents Method** (Lines 65-86): Uses Tauri's `invoke` and `listen` functions
- **Filter Structure** (`types.ts:281-285`): Supports `event_types`, `session_id`, and `run_id` filters
- **Unsubscribe Return**: Returns Tauri's `unlisten()` function directly

**Confirmed issue:**

- No explicit unsubscribe command to the daemon exists
- The unlisten only stops frontend event handling, not backend subscription

### Tauri Bridge Layer (`humanlayer-wui/src-tauri/src/lib.rs`)

**Verified findings:**

- **subscribe_to_events Command** (Lines 195-249): Creates subscription and spawns forwarding task
- **Missing unsubscribe_to_events**: Confirmed - no such command exists
- **Event Forwarding**: Uses `app.emit("daemon-event", event)` to forward events

**Critical confirmation:**

- The spawned tokio task continues running even after frontend unlisten
- No mechanism to stop the subscription task when frontend unmounts

### Rust Client Layer (`humanlayer-wui/src-tauri/src/daemon_client/`)

**Verified findings:**

- **Subscription Manager** (`subscriptions.rs`): Has `cancel_subscription` method (lines 74-80)
- **Event Processing Loop** (Lines 92-218): Uses tokio::select! with cancellation channel
- **Buffered Channel**: 100-event buffer prevents blocking

**Key issue confirmed:**

- Cancel functionality exists but is never triggered from frontend
- No way to invoke `cancel_subscription` through Tauri commands

### Go Daemon Layer (`hld/rpc/subscription_handlers.go`)

**Verified findings:**

- **SubscribeConn Method** (Lines 65-203): Handles long-polling subscriptions
- **Deferred Cleanup** (Lines 96-99): Properly unsubscribes on connection close
- **Connection Monitoring** (Lines 123-149): Uses 100ms timeouts to detect closure

**Confirmed missing component:**

- No `HandleUnsubscribe` RPC method exists
- Only connection closure triggers cleanup

### Event Bus Layer (`hld/bus/events.go`)

**Verified filtering implementation:**

- **Event Type Filtering** (Lines 129-145): Empty filter = all types allowed
- **Session ID Filtering** (Lines 147-159): Checks `event.Data["session_id"]` for exact match
- **Unsubscribe Method** (Lines 62-79): Properly removes subscriber and closes channel

**Filtering works correctly:**

- Server-side filtering reduces network traffic
- Debug logging provides visibility into filter matching

## Architecture Insights

### Confirmed Design Mismatch

The validation confirms the fundamental architectural mismatch:

1. **HLD Design Philosophy**: Connection closure triggers cleanup (connection-based lifecycle)
2. **WUI Implementation**: Uses subscription IDs with explicit cleanup expectations (subscription-based lifecycle)
3. **Result**: Subscriptions accumulate as connections persist while components unmount/remount

### Event Flow Validation

```
React Component
    ↓ subscribeToEvents()
TypeScript Client
    ↓ invoke('subscribe_to_events')
Tauri Bridge
    ↓ client.subscribe()
Rust Client
    ↓ Subscribe RPC
Go Daemon
    ↓ EventBus.Subscribe()
Event Generation
    ↓ Event Bus Distribution
Go Daemon
    ↓ Write to connection
Rust Client
    ↓ Parse & forward
Tauri Bridge
    ↓ app.emit("daemon-event")
Frontend Listener
    ↓ onEvent callback
React Component
```

## Historical Context (from thoughts/)

The thoughts directory research confirms:

- Event system evolved from SSE to JSON-RPC
- Connection-based design was intentional for simplicity
- The mismatch appears during WUI implementation
- Previous research identified same issues

## Critical Issue Validation

### The Problem: Confirmed Missing Unsubscribe Capability

**Root Cause Validated**:

- HLD expects connection closure for cleanup
- WUI keeps connections open while navigating
- No explicit unsubscribe RPC method exists
- Tauri bridge lacks unsubscribe command

**Evidence Confirmed**:

- Frontend `unlisten()` only stops local event handling
- Backend subscription tasks continue running
- Subscription IDs accumulate without cleanup
- No logs show proper unsubscribe execution

## Recommended Solutions (Validated)

### Option 1: Add Explicit Unsubscribe RPC Method (Still Recommended)

1. **HLD**: Add `HandleUnsubscribe` RPC method
2. **Rust**: Expose `cancel_subscription` through Tauri
3. **TypeScript**: Track subscription IDs for cleanup
4. **React**: Call explicit unsubscribe on unmount

This remains the best long-term solution for proper resource management.

### Option 2: Connection Management Fix

Ensure WUI closes subscription connections on component unmount. Less elegant but works with current architecture.

## Related Research

- Original research: `thoughts/shared/research/2025-06-24_17-46-46_useSession_unsubscribe_behavior.md`
- HLD daemon interface: `thoughts/shared/research/2025-06-24_10-17-43_hld-daemon-interface.md`

## Open Questions

1. How many subscriptions can accumulate before performance degrades?
2. Are there memory leaks in production deployments?
3. What's the migration path for adding unsubscribe without breaking compatibility?
