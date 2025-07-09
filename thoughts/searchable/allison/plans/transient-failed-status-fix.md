---
date: 2025-07-01T11:56:03-07:00
researcher: allison
git_commit: 55a810b74a9abe727acfee419b1e732825b7a53e
branch: claude/issue-258-20250630_191418
repository: issue-258-20250630_191418
topic: "Transient Failed Status Bug Implementation Plan"
tags: [research, codebase, failed-status, interrupt, implementation-plan, wui, hld]
status: complete
last_updated: 2025-07-01
last_updated_by: allison
---

# Research: Transient Failed Status Bug Implementation Plan

**Date**: 2025-07-01 11:56:03 PDT
**Researcher**: allison
**Git Commit**: 55a810b74a9abe727acfee419b1e732825b7a53e
**Branch**: claude/issue-258-20250630_191418
**Repository**: issue-258-20250630_191418

## Research Question
Can we come up with an implementation plan to squash the transient failed status bug? Do we need to re-engineer how session watching happens? Do we need to add code to the interrupt logic? What are the requirements for a follow-up ticket?

## Summary
The transient failed status bug can be fixed with a targeted solution that doesn't require re-engineering the session watching system. The fix involves modifying the monitoring goroutine to check the session's current status before marking it as failed when the process exits with an error. This is a relatively small change that maintains backward compatibility while fixing the race condition.

## Root Cause Analysis

The bug occurs due to this sequence:
1. User interrupts session → Status changes to `StatusCompleting`
2. SIGINT sent to Claude process → Process exits with non-zero code
3. Monitor's `cmd.Wait()` returns error → Monitor sets status to `StatusFailed`
4. UI shows "failed" briefly until next poll/event corrects it

The core issue: The monitor doesn't distinguish between intentional interrupts and actual failures.

## Implementation Plan

### Option 1: Minimal Fix (Recommended for Current PR)

**Step 1: Modify the monitoring logic in `hld/session/manager.go`**

Replace lines 279-283:
```go
// Wait for session to complete
result, err := claudeSession.Wait()

endTime := time.Now()
if err != nil {
    m.updateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
}
```

With:
```go
// Wait for session to complete
result, err := claudeSession.Wait()

endTime := time.Now()
if err != nil {
    // Check if this was an intentional interrupt
    session, dbErr := m.repo.GetSession(ctx, sessionID)
    if dbErr == nil && session != nil && session.Status == StatusCompleting {
        // This was an interrupted session, not a failure
        // Let it transition to completed naturally
    } else {
        m.updateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
    }
}
```

**Pros:**
- Minimal change, low risk
- Fixes the immediate issue
- Maintains existing behavior for actual failures

**Cons:**
- Adds a database read in the error path
- Doesn't address the deeper architectural issue

### Option 2: Comprehensive Fix (Follow-up Ticket)

**Step 1: Add exit code tracking to `claudecode-go`**

Modify `claudecode-go/client.go` to track exit codes:
```go
type Session struct {
    // ... existing fields ...
    exitCode int
    wasInterrupted bool
}

func (s *Session) Wait() (*SessionResult, error) {
    // ... existing code ...
    if exitErr, ok := err.(*exec.ExitError); ok {
        s.exitCode = exitErr.ExitCode()
        // Check if this was SIGINT (exit code 130 on Unix)
        if s.exitCode == 130 || s.wasInterrupted {
            // Return a special error type or nil
            return result, nil
        }
    }
    return result, err
}

func (s *Session) Interrupt() error {
    s.wasInterrupted = true
    // ... existing interrupt code ...
}
```

**Step 2: Update monitoring to use exit code information**

The monitor can then make informed decisions based on whether the session was interrupted.

**Step 3: Fix event publishing for all status transitions**

Modify `updateSessionStatus` to fetch old status and publish events:
```go
func (m *Manager) updateSessionStatus(ctx context.Context, sessionID string, status Status, errorMsg string) {
    // Fetch old status
    oldSession, err := m.repo.GetSession(ctx, sessionID)
    if err != nil {
        // Log error but continue
    }
    
    // Update status
    err = m.repo.UpdateSessionStatus(ctx, sessionID, status, errorMsg)
    if err != nil {
        // ... error handling ...
    }
    
    // Publish event if we have old status
    if oldSession != nil && m.eventBus != nil {
        m.eventBus.Publish(ctx, EventSessionStatusChanged, map[string]interface{}{
            "session_id": sessionID,
            "old_status": string(oldSession.Status),
            "new_status": string(status),
        })
    }
}
```

## Requirements for Follow-up Ticket

### Title: "Fix session status transition race conditions and event publishing gaps"

### Description:
The current implementation has several issues with session status management:
1. Interrupted sessions are temporarily marked as failed
2. Status change events aren't published for failure transitions
3. No distinction between different types of process exits

### Acceptance Criteria:
1. ✅ Interrupted sessions transition from `completing` → `completed` without showing `failed`
2. ✅ All status transitions publish events for real-time UI updates
3. ✅ Exit codes are tracked and used to determine session outcome
4. ✅ No race conditions during rapid status transitions
5. ✅ UI never shows incorrect transient states

### Technical Requirements:
1. Modify `claudecode-go` to track exit codes and interrupt state
2. Update monitoring logic to handle different exit scenarios
3. Fix `updateSessionStatus` to publish events for all transitions
4. Add integration tests for interrupt scenarios
5. Consider adding status transition validation

### Impact Analysis:
- **If we merge current PR as-is**: 
  - Users will occasionally see "failed" status for ~1-3 seconds after interrupting
  - No functional impact - just a visual glitch
  - Events continue to be processed normally
  - Session can still be continued without issues

## Recommended Approach

1. **For this PR**: Implement Option 1 (minimal fix) to address the immediate issue
2. **Create follow-up ticket**: Use the comprehensive requirements above
3. **Priority**: Medium - it's a UX issue but not blocking functionality

## Code References
- `hld/session/manager.go:279-283` - Where the fix needs to be applied
- `hld/session/manager.go:345-372` - updateSessionStatus that needs event publishing
- `claudecode-go/client.go:232-243` - Where exit code tracking should be added
- `hld/session/types.go:23` - StatusCompleting definition

## Architecture Insights
1. The system wasn't originally designed with graceful shutdown in mind
2. The `StatusCompleting` state was added later but not fully integrated
3. Event publishing was designed for happy-path transitions only
4. The monitoring architecture is sound - just needs better exit handling

## Historical Context (from thoughts/)
- `thoughts/allison/tickets/eng_1441.md` - Original bug report from Dexter
- `thoughts/shared/prs/259_description.md` - Interrupt feature that exposed this issue
- `thoughts/shared/research/2025-07-01_11-46-12_transient-failed-status-bug.md` - Initial investigation

## Related Research
- The broader architecture has multiple race conditions that could benefit from a systematic review
- Event-driven updates vs polling creates potential for inconsistent state
- Consider implementing a proper state machine with validated transitions