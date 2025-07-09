# Fix Session List Update After Continue Implementation Plan

## Overview

Fix the UI state issue where the WUI session list doesn't immediately update to show the correct leaf sessions after continuing a session. Currently, users see the old parent session remain in the list until the next manual refresh trigger.

## Current State Analysis

When a user continues a session:
1. `continueSession` creates a new child session on the backend
2. The UI navigates to the new session page
3. The session list in the sidebar still shows the parent as a leaf
4. The list only updates on the next window focus or manual refresh

### Key Discoveries:
- Session list uses `getSessionLeaves` endpoint (already implemented in ENG-1491)
- `refreshSessions()` method exists in AppStore (`humanlayer-wui/src/AppStore.ts:39-46`)
- Continue session handler doesn't trigger any session list refresh (`humanlayer-wui/src/components/internal/SessionDetail.tsx:1002-1027`)
- Session list only updates via manual triggers or event subscriptions

## What We're NOT Doing

- Modifying the backend `getSessionLeaves` implementation
- Changing the polling intervals or mechanisms
- Adding complex state management or optimistic updates
- Implementing WebSocket/real-time updates for session list changes
- Modifying how session parent-child relationships work

## Implementation Approach

Use the reactive approach: After successful `continueSession`, immediately call `refreshSessions()` from the store. This ensures the session list updates to reflect that the parent is no longer a leaf.

## Implementation

### Overview
Add a session list refresh immediately after successful session continuation to ensure the UI accurately reflects the current session tree state.

### Changes Required:

#### SessionDetail Component
**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
**Changes**: Import store and add refresh call after successful continuation

```typescript
// Add import at the top
import { useAppStore } from '@/AppStore'

// Inside the SessionDetail component, get the refreshSessions function
const refreshSessions = useAppStore((state) => state.refreshSessions)

// Update handleContinueSession (around line 1002)
const handleContinueSession = useCallback(async () => {
  if (!responseInput.trim() || !session) {
    return
  }

  setIsResponding(true)
  const currentMessage = responseInput

  try {
    const response = await daemonClient.continueSession({
      session_id: session.id,
      query: responseInput,
    })

    // Add this line to refresh the session list
    await refreshSessions()

    setResponseInput('')
    navigate(`/sessions/${response.session_id}`)
  } catch (error) {
    console.error('Failed to continue session:', error)
    setResponseInput(currentMessage)
  } finally {
    setIsResponding(false)
  }
}, [session, responseInput, navigate, daemonClient, refreshSessions])
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `bun run build`
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`

#### Manual Verification:
- [ ] Start WUI and create a session
- [ ] Continue the session with a new query
- [ ] Verify the parent session immediately disappears from the session list
- [ ] Verify the new child session appears in the list
- [ ] No UI flicker or loading states visible during the update
- [ ] Session navigation works correctly

## Testing Strategy

### Manual Testing Steps:
1. Open WUI and ensure at least one session exists
2. Open a session and type a continuation query
3. Press Enter or click Continue
4. Immediately observe the session list in the sidebar
5. Verify the parent session is no longer visible
6. Verify the new child session appears

### Edge Cases to Test:
- Continuing a session that already has children
- Continuing multiple sessions rapidly
- Network errors during continuation

## Performance Considerations

- The additional `refreshSessions()` call adds one extra API request
- This is acceptable given the importance of UI consistency
- The call is async and doesn't block navigation
- Total added latency is minimal (typically <100ms)

## References

- Original ticket: `thoughts/allison/tickets/eng_1510.md`
- Related ticket: `thoughts/allison/tickets/eng_1491.md`
- Continue session handler: `humanlayer-wui/src/components/internal/SessionDetail.tsx:1002-1027`
- Session store: `humanlayer-wui/src/AppStore.ts:39-46`