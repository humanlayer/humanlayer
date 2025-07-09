## What problem(s) was I solving?

The HumanLayer WUI (Web UI) had issues with hotkey scopes conflicting between different components. When multiple components (SessionTable, SessionDetail, and ToolResultModal) were active at the same time, their hotkeys would interfere with each other, causing the wrong actions to fire. For example, pressing 'j' or 'k' could navigate both the session list and the event list simultaneously, or the escape key might close the wrong component.

## What user-facing changes did I ship?

- Fixed hotkey conflicts when navigating between different UI components
- Ensured that only the active component's hotkeys respond to keyboard input
- Improved the escape key behavior to close components in the correct order (modal → expanded view → focused view → close panel)
- Added proper hotkey scope isolation for nested components
- Improved the tool result modal UI by adding a visual ESC key indicator at the bottom

## How I implemented it

I introduced a custom React hook called `useStealHotkeyScope` that temporarily disables all active hotkey scopes and enables only the target component's scope. This ensures that when a modal or overlay is open, only its hotkeys are active:

1. **Created `useStealHotkeyScope` hook**: This hook captures the currently active scopes on mount, disables them all, and enables only the target scope. On unmount, it restores the original scopes.

2. **Applied scope isolation to key components**:
   - `SessionDetail`: Uses `SessionDetailHotkeysScope` and steals focus when opened
   - `ToolResultModal`: Uses `ToolResultModalHotkeysScope` and steals focus when showing tool results

3. **Fixed escape key handling**: Added proper event handling to prevent escape key propagation and ensure components close in the correct order

4. **Updated HotkeysProvider initialization**: Set `initiallyActiveScopes={['none']}` to start with a clean state

5. **Prevented dialog-close button conflicts**: Added special handling to ignore escape events from dialog close buttons

6. **Enhanced modal UI**: Added a keyboard hint showing "ESC to close" at the bottom of the tool result modal for better discoverability

7. **Conditional rendering**: Made ToolResultModal only render when there's actual content to display

Additionally, the PR includes dependency updates for React (v19), react-router-dom, and Tailwind CSS packages.

## How to verify it

- [x] I have ensured `make check test` passes

To manually verify the hotkey fixes:
1. Open the HumanLayer WUI
2. Navigate to a session with multiple events
3. Test that j/k navigation works correctly in the session table
4. Open a session detail view and verify j/k navigates events (not sessions)
5. Open a tool result modal and verify j/k scrolls the modal content
6. Test escape key closes components in order: modal → expanded → focused → panel
7. Verify no hotkey conflicts when multiple components are visible

## Description for the changelog

Fixed hotkey conflicts in the Web UI by implementing proper scope isolation for nested components