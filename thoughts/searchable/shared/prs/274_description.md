## What problem(s) was I solving?

The WUI (Web UI) had poor error handling UX where RPC errors and other failures were either shown using browser `alert()` dialogs or silently logged to the console. Users had no visibility when actions failed, leading to confusion about whether their interactions succeeded or not. This was particularly problematic for approval actions (approve/deny) and session continuation where failures would occur silently.

## What user-facing changes did I ship?

- **Toast notifications for all errors**: Replaced browser alerts with modern toast notifications that appear in the bottom-right corner
- **Visibility for silent failures**: Added error notifications for previously silent failures in approve/deny/continue session operations
- **Enhanced visual feedback**: Added pulse animation for incomplete tool calls to better indicate pending operations
- **WebSearch tool display**: Added proper display formatting for WebSearch tool calls with a globe icon
- **Consistent error messages**: All errors now go through `formatError()` utility for user-friendly messages

## How I implemented it

1. **Extended NotificationService** with a new `notifyError()` method that:
   - Logs errors to console for debugging
   - Formats errors using the existing `formatError` utility to strip technical details
   - Shows red toast notifications with 8-second duration for better visibility
   - Added 'error' type to the notification system enum

2. **Replaced all `alert()` calls** throughout the codebase:
   - `ApprovalsPanel.tsx`: Updated approve/deny/respond error handlers
   - `Layout.tsx`: Updated legacy approval handler
   - `SessionDetail.tsx`: Updated approve/deny/continue session error handlers

3. **Added visual enhancements**:
   - Pulse animation CSS for incomplete tool calls (warning state)
   - WebSearch tool display with globe icon and formatted query
   - Fixed subject fallback handling to prevent undefined subjects

The implementation leverages the existing Sonner toast infrastructure (added in PR #250) to maintain consistency across the application.

## How to verify it

- [x] I have ensured `make check test` passes

**Manual testing required:**
- [ ] Disconnect the daemon (`hld`) and try to approve/deny an approval - should show red toast with "Cannot connect to daemon" message
- [ ] Try to continue a session with the daemon disconnected - should show error toast and preserve user input
- [ ] Verify error toasts appear in bottom-right with 8-second duration
- [ ] Check that console still logs errors for debugging
- [ ] Verify WebSearch tool calls display with globe icon and query text
- [ ] Confirm incomplete tool calls show pulse animation

## Description for the changelog

Improve error handling UX in WUI by replacing browser alerts with toast notifications and adding visibility for previously silent failures in approval and session operations.