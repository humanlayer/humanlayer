## What problem(s) was I solving?

When Claude Code sessions enter a waiting state (requiring human approval), users had no way to be notified unless they were actively watching the HumanLayer WUI. This led to missed approval requests and delayed workflows, especially when users were working in other applications.

## What user-facing changes did I ship?

- **Desktop notifications**: Users now receive OS-level notifications when sessions require approval, complete, or fail
- **In-app toast notifications**: When the app is focused, users see non-intrusive toast notifications at the bottom-right
- **Smart notification filtering**: Notifications are suppressed if the user is already viewing the relevant session
- **Persistent approval notifications**: Approval notifications remain visible until dismissed to ensure they're not missed
- **Action buttons**: Notifications include a "Jump to Session" button for quick navigation
- **Dark mode support**: Toast notifications respect the system theme preference

## How I implemented it

1. **Added notification dependencies**:
   - Integrated Tauri's notification plugin (`@tauri-apps/plugin-notification`) for OS-level notifications
   - Added Sonner library for in-app toast notifications
   - Added next-themes for dark mode support in toasts

2. **Created NotificationService**:
   - Singleton service that manages all notification logic
   - Tracks app focus state using both Tauri window events and browser events
   - Generates unique notification IDs to prevent duplicates
   - Provides context-aware notification delivery (OS vs in-app)

3. **Extended event handling**:
   - Created `useSessionEventsWithNotifications` hook that wraps existing subscriptions
   - Added state transition detection to trigger notifications at the right moments
   - Implemented deduplication logic using a notification tracking system in the store

4. **UI Integration**:
   - Added Toaster component to the main layout
   - Integrated notification state management into the app store
   - Added close button functionality to toast notifications

## How to verify it

- [ ] I have ensured `make check test` passes (Note: claudecode-go tests are failing, but unrelated to this PR)

To manually test notifications:
1. Open HumanLayer WUI
2. Launch a Claude Code session that will require approval
3. Switch to another application window
4. Verify you receive an OS notification when approval is needed
5. Click the notification to jump back to the session
6. Verify in-app toasts appear when the app is focused
7. Verify notifications don't appear when already viewing the relevant session

## Description for the changelog

Added desktop and in-app notifications for HumanLayer WUI to alert users when Claude Code sessions require approval, complete, or fail. Notifications are context-aware and include quick actions for improved workflow efficiency.