## What problem(s) was I solving?

The SessionDetail page in humanlayer-wui was not updating in real-time when the session status changed. Specifically:

1. When new approvals arrived (requiring human input), the UI didn't reflect that the session was waiting for input
2. When approvals were resolved (approved/denied), the UI didn't update to show the session was running again
3. Users had to manually refresh the page to see status changes

Additionally, there was a resource leak where event subscriptions were accumulating without proper cleanup when navigating between session views.

## What user-facing changes did I ship?

- **Real-time session status updates**: The SessionDetail page now automatically updates when:
  - A new approval arrives → Session status shows "waiting_input" 
  - An approval is approved/denied → Session status returns to "running"
  - An approval is resolved externally → Session status returns to "running"
  
- **Better resource management**: Fixed subscription cleanup to prevent memory leaks when navigating between sessions

- **Improved UI spacing**: Added better spacing between multiple edits in the MultiEdit tool display

## How I implemented it

### 1. Fixed subscription cleanup architecture
- Added proper unsubscribe mechanism across the stack (Rust → Tauri → TypeScript → React)
- Modified `subscribeToEvents` to return both an unlisten function and subscription ID
- Implemented `unsubscribe_from_events` Tauri command that properly closes the Unix socket
- Updated React hooks to call both unlisten() and unsubscribeFromEvents() on cleanup
- Added protection against React StrictMode double-subscriptions

### 2. Added missing event publishing
- Modified `correlateApproval` in `approval/poller.go` to publish `EventSessionStatusChanged` when status changes to `waiting_input`
- Updated `ApproveFunctionCall` and `DenyFunctionCall` in `approval/manager.go` to publish events when status changes back to `running`
- Added event publishing when approvals are resolved externally (in the poller reconciliation)

### 3. Updated frontend subscriptions
- Modified `useSession` hook to listen for both `session_status_changed` and `new_approval` events
- Fixed `useApprovalsWithSubscription` and `useSubscriptions` hooks to handle the new subscription return type

## How to verify it

- [x] I have ensured `make check test` passes (Note: claudecode-go tests fail but are unrelated to this PR - all modified components pass)

### Manual testing steps:
1. Open a SessionDetail page for a running session
2. Trigger an approval (e.g., have the agent try to use a tool)
3. Verify the session status changes to "waiting_input" automatically
4. Approve or deny the approval
5. Verify the session status changes back to "running" automatically
6. Navigate between different sessions and verify no console errors about failed unsubscribes

## Description for the changelog

Fixed real-time session status updates in the web UI when approvals arrive or are resolved, and fixed subscription cleanup to prevent resource leaks