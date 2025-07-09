---
date: 2025-07-01T11:45:24-07:00
researcher: allison
git_commit: 55a810b74a9abe727acfee419b1e732825b7a53e
branch: claude/issue-258-20250630_191418
repository: issue-258-20250630_191418
topic: "Transient Failed Status Bug Investigation"
tags: [research, codebase, failed-status, daemon, interrupt, race-condition]
status: complete
last_updated: 2025-07-01
last_updated_by: allison
---

# Research: Transient Failed Status Bug Investigation

**Date**: 2025-07-01 11:45:24 PDT
**Researcher**: allison
**Git Commit**: 55a810b74a9abe727acfee419b1e732825b7a53e
**Branch**: claude/issue-258-20250630_191418
**Repository**: issue-258-20250630_191418

## Research Question
Why does the session show a "failed" state for a moment and then come back? Investigation into a bug where sessions briefly show as failed before transitioning to waiting_input state, specifically related to interrupt implementation on this branch.

## Summary
The transient failed status bug is caused by a race condition in the interrupt handling flow. When a session is interrupted, the monitoring goroutine incorrectly marks it as failed because it doesn't distinguish between intentional interrupts and actual failures. This happens because `cmd.Wait()` returns an error for SIGINT, which the monitor interprets as a failure.

## Detailed Findings

### Root Cause: Interrupt Handler Race Condition
The primary issue is in the session monitoring logic:
- Finding: When Claude process exits from SIGINT, `Wait()` returns an error
- Connection: This causes the monitor to mark session as failed instead of completed
- Implementation: `hld/session/manager.go:279-282`

```go
// Wait for session to complete
result, err := claudeSession.Wait()

endTime := time.Now()
if err != nil {
    m.updateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
}
```

### Session Status Transition Flow
- Finding: Interrupt sets status to `StatusCompleting` (`hld/session/manager.go:952-1001`)
- Finding: Monitor overwrites with `StatusFailed` when process exits (`hld/session/manager.go:279`)
- Connection: This creates the brief failed state before UI refreshes

### Daemon Startup Behavior
- Finding: `markOrphanedSessionsAsFailed` runs on every daemon startup (`hld/daemon/daemon.go:244-287`)
- Implementation: Marks all running/waiting/starting sessions as failed with message "daemon restarted while session was active"
- Connection: However, the daemon didn't restart in your case, so this isn't the cause

### Additional Contributing Factors

#### 1. Status Update Events Not Published
- Finding: `updateSessionStatus` doesn't publish events (`hld/session/manager.go:369-372`)
- Implementation: Can't determine old status, so skips event publishing
- Connection: UI might show stale status until polling catches up

#### 2. Subscription Race Conditions
- Finding: 100ms delay to avoid hot reload races (`humanlayer-wui/src/hooks/useSubscriptions.ts:48-49`)
- Finding: 5-second timeout for subscription confirmation (`hlyr/src/daemonClient.ts:191-200`)
- Connection: During reconnection, temporary incorrect status might display

#### 3. Approval Reconciliation Delay
- Finding: 2-second delay before reconciling approvals (`hld/session/manager.go:166-178`)
- Connection: Could contribute to status synchronization issues

## Code References
- `hld/session/manager.go:279-282` - Monitor marks interrupted sessions as failed
- `hld/session/manager.go:952-1001` - InterruptSession function
- `hld/session/types.go:23` - StatusCompleting definition
- `hld/daemon/daemon.go:244-287` - Orphaned session recovery
- `claudecode-go/client.go:280-286` - Low-level interrupt sending
- `humanlayer-wui/src/hooks/useSessionEventsWithNotifications.ts:22-45` - UI status tracking

## Architecture Insights
1. **No Distinction Between Exit Types**: The monitoring goroutine treats all non-zero exits as failures, including intentional interrupts
2. **Event System Limitations**: Status updates don't always publish events, relying on polling for UI updates
3. **Multiple Status Sources**: UI receives status from both events and polling, creating potential for inconsistency
4. **Graceful Shutdown Not Graceful**: Interrupt flow doesn't properly transition to completed state

## Historical Context (from thoughts/)
- `thoughts/allison/tickets/eng_1441.md` - Dexter reported the exact issue: session going from failed to waiting_input
- `thoughts/shared/prs/259_description.md` - Recent interrupt feature maintains "consistent failed state handling" but issue persists
- `thoughts/shared/research/2025-07-01_11-26-35_eng-1470-approval-response-error-analysis.md` - Shows existing race conditions in polling architecture

## Related Research
- Previous error handling research shows WUI has poor error visibility, making the issue appear more "random" than it is
- Architecture analysis revealed dual polling issues that could affect status synchronization

## Open Questions
1. Should the monitor distinguish between SIGINT exits and actual failures?
2. Why doesn't `updateSessionStatus` publish events for all status changes?
3. Could the interrupt handler wait for graceful shutdown before allowing status updates?
4. Is there a way to make the status transition atomic to prevent intermediate states?

## Recommended Fix
The monitor goroutine should check if the session is in `StatusCompleting` state before marking it as failed when `Wait()` returns an error. This would preserve the intended graceful shutdown flow while still catching actual failures.