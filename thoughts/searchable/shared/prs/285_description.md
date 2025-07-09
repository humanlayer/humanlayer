## What problem(s) was I solving?

- Fixed a scrolling issue in the SessionTable page where the table content would overflow and become inaccessible
- Addressed inconsistent padding in conversation events that made the UI feel cramped and harder to scan
- Improved the visual hierarchy of timestamps in the conversation view

## What user-facing changes did I ship?

- **Fixed scroll behavior**: The main content area now properly scrolls, allowing users to access all sessions in the SessionTable
- **Improved spacing**: Conversation events now have consistent 16px padding (p-4) instead of inconsistent top/bottom padding
- **Better timestamp positioning**: Timestamps are now absolutely positioned in the top-right corner of each event, reducing visual clutter
- **Cleaner layout**: Removed unused `isWideView` state variable and simplified the event layout structure

## How I implemented it

### Layout.tsx
- Changed the main content container from `overflow-hidden` to `overflow-y-auto` to enable vertical scrolling
- This fixes the issue where content would be cut off without a way to scroll

### ConversationContent.tsx  
- Replaced inconsistent padding (`pt-1 pb-3 px-2`) with uniform padding (`p-4`) for all conversation events
- Made timestamps absolutely positioned (`absolute top-2 right-4`) to maintain consistent spacing
- Added CSS class names (`NoSubTasksConversationContent`) for easier debugging/styling
- Removed the unused `isWideView` state variable and its associated logic

### TaskGroup.tsx
- Applied the same padding standardization (`p-4`) to task groups for consistency
- Made timestamps absolutely positioned to match the ConversationContent styling
- Added CSS class names (`TaskGroup`, `TaskGroupExpanded`) for component identification

## How to verify it

- [x] I have ensured `make check test` passes

### Manual testing steps:
1. Open the HumanLayer WUI
2. Navigate to the Sessions page
3. Verify that you can scroll through all sessions if there are more than fit on screen
4. Click into a session to view the conversation
5. Verify that conversation events have consistent spacing and timestamps are properly positioned
6. Expand/collapse task groups and verify the layout remains consistent

## Description for the changelog

Fixed scroll behavior in SessionTable and improved conversation event spacing with consistent padding and better timestamp positioning