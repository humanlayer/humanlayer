---
date: 2025-06-30T11:12:45-07:00
researcher: allison
git_commit: 733e970a6ee7c5e1d7a8b09918aa2ef38ec80bb8
branch: main
repository: humanlayer
topic: "Accept user messages while Claude is running (queuing/interrupt flow)"
tags: [research, codebase, message-queue, interrupt, claude-sessions, hld, wui, architecture]
status: complete
last_updated: 2025-06-30
last_updated_by: allison
---

# Research: Accept user messages while Claude is running (queuing/interrupt flow)

**Date**: 2025-06-30 11:12:45 PDT
**Researcher**: allison
**Git Commit**: 733e970a6ee7c5e1d7a8b09918aa2ef38ec80bb8
**Branch**: main
**Repository**: humanlayer

## Research Question
Investigate the feasibility and implementation plan for accepting user messages while Claude is running, including queuing and interrupt flow capabilities. Determine if this is straightforward (as suspected) with changes only needed in the WUI.

## Summary
The implementation is **very straightforward**! The hld daemon already supports calling `ContinueSession` on running sessions - it automatically interrupts the running session, waits for it to complete gracefully, then starts the new session. The WUI just needs to enable the input field during the `running` state. This is a **small, UI-only change**.

## Detailed Findings

### Daemon Already Supports This Feature

The key discovery is in [`hld/session/manager.go:706-753`](https://github.com/HumanLayerInc/humanlayer/blob/733e970a6ee7c5e1d7a8b09918aa2ef38ec80bb8/hld/session/manager.go#L706-L753):

```go
// Validate parent session status - allow completed or running sessions
if parentSession.Status != store.SessionStatusCompleted && parentSession.Status != store.SessionStatusRunning {
    return nil, fmt.Errorf("cannot continue session with status %s (must be completed or running)", parentSession.Status)
}

// If session is running, interrupt it and wait for completion
if parentSession.Status == store.SessionStatusRunning {
    slog.Info("interrupting running session before resume",
        "parent_session_id", req.ParentSessionID)
    
    if err := m.InterruptSession(ctx, req.ParentSessionID); err != nil {
        return nil, fmt.Errorf("failed to interrupt running session: %w", err)
    }
    
    // Wait for the interrupted session to complete gracefully
    // ... then proceed with resume
}
```

The daemon:
1. Accepts `ContinueSession` calls for both `completed` AND `running` sessions
2. Automatically interrupts running sessions
3. Waits for graceful completion
4. Then starts the new session with the user's message

### WUI Currently Blocks Input

The WUI prevents input during running sessions in [`SessionDetail.tsx`](https://github.com/HumanLayerInc/humanlayer/blob/733e970a6ee7c5e1d7a8b09918aa2ef38ec80bb8/humanlayer-wui/src/components/internal/SessionDetail.tsx):

1. **Line 1044**: Button disabled when `session.status !== 'completed'`
2. **Line 1073**: Input field disabled when `session.status !== 'completed'`
3. **Line 1078**: Send button disabled when `session.status !== 'completed'`

## Implementation Spec

### Changes Required (WUI Only)

**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`

1. **Line 1044**: Change button disable condition
   ```tsx
   // FROM:
   disabled={session.status !== 'completed'}
   // TO:
   disabled={session.status === 'failed'}
   ```

2. **Line 1073**: Change input disable condition
   ```tsx
   // FROM:
   disabled={isResponding || session.status !== 'completed'}
   // TO:
   disabled={isResponding || session.status === 'failed'}
   ```

3. **Line 1078**: Change send button disable condition
   ```tsx
   // FROM:
   disabled={!responseInput.trim() || isResponding || session.status !== 'completed'}
   // TO:
   disabled={!responseInput.trim() || isResponding || session.status === 'failed'}
   ```

4. **Lines 1065-1067**: Update placeholder text
   ```tsx
   // FROM:
   placeholder={
     session.status === 'completed'
       ? 'Enter your message to continue the conversation...'
       : 'Session must be completed to continue...'
   }
   // TO:
   placeholder={
     session.status === 'failed'
       ? 'Session failed - cannot continue...'
       : session.status === 'running' || session.status === 'starting'
       ? 'Enter message (will interrupt current response)...'
       : 'Enter your message to continue the conversation...'
   }
   ```

5. **Lines 1085-1092**: Update help text
   ```tsx
   // FROM:
   {session.status === 'completed' ? (
     <>
       Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to send,
       <kbd className="px-1 py-0.5 bg-muted rounded ml-1">Escape</kbd> to cancel
     </>
   ) : (
     'Wait for the session to complete before continuing'
   )}
   // TO:
   {session.status === 'failed' ? (
     'Session failed - cannot continue'
   ) : session.status === 'running' || session.status === 'starting' ? (
     <>
       Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to interrupt and send,
       <kbd className="px-1 py-0.5 bg-muted rounded ml-1">Escape</kbd> to cancel
     </>
   ) : (
     <>
       Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to send,
       <kbd className="px-1 py-0.5 bg-muted rounded ml-1">Escape</kbd> to cancel
     </>
   )}
   ```

### Testing Plan

1. Start a Claude session with a long-running task
2. While Claude is processing, type a new message
3. Press Enter to send
4. Verify:
   - Current session gets interrupted
   - New session starts with the typed message
   - UI shows appropriate feedback during transition

### UI/UX Considerations

- The placeholder text should indicate that sending will interrupt the current response
- Consider adding a tooltip or visual indicator showing this behavior
- The transition should feel smooth to the user

## Summary

This is indeed a straightforward change - the backend already supports the feature perfectly. We just need to enable the UI controls during the `running` state and update the messaging to inform users that sending a message will interrupt the current response.

No changes needed to:
- hld daemon (already supports it)
- hlyr/MCP protocol
- Any backend infrastructure

Just 5 small changes in one TypeScript file!