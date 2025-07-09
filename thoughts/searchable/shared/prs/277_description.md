## What problem(s) was I solving?

The Web UI displays Claude sub-task events in a flat, chronological list without any visual grouping or hierarchy. This makes it difficult for users to understand the relationship between parent Task events and their sub-task activities, especially in complex conversations with multiple nested Task calls. Users need a clearer way to see which tool calls belong to which Task groups and track the progress of individual tasks.

## What user-facing changes did I ship?

- **Hierarchical Task Display**: Claude Task events and their sub-events are now displayed in a collapsible tree structure
- **Task Group Headers**: Parent tasks show as collapsible headers with chevron icons, task descriptions, and status indicators
- **Smart Previews**: Collapsed task groups show a preview of the latest sub-event with tool call counts
- **Auto-expansion for Approvals**: Task groups with pending approvals automatically expand to ensure users don't miss approval requests
- **Enhanced Keyboard Navigation**: Added support for j/k navigation across task groups and Enter key to expand/collapse groups
- **Visual Hierarchy**: Sub-task events are indented with a left border to clearly show they belong to a parent task
- **Approval Badge Integration**: Tool calls with approvals show inline approval status badges instead of separate approval entries

## How I implemented it

1. **Data Model Updates**: Added `parent_tool_use_id` field to both TypeScript and Rust types to track parent-child relationships
2. **Efficient Grouping**: Created `buildTaskGroups` function that:
   - Early exits if no sub-tasks exist (performance optimization)
   - Single-pass categorization of events
   - Pre-computes preview data for collapsed state
3. **TaskGroup Component**: New React component for rendering collapsible task groups with:
   - Hover and focus states
   - Animated chevron indicators
   - Smart preview generation based on event types
4. **Navigation Enhancement**: Extended keyboard navigation to:
   - Track navigable items across task groups and sub-events
   - Support Enter key for expand/collapse
   - Maintain focus states properly
5. **Approval Flow**: Implemented auto-expansion logic that:
   - Tracks tasks with pending approvals
   - Saves/restores expansion state after approval actions
   - Preserves tool call context in approval displays

## How to verify it

- [x] I have ensured `make check test` passes

To manually verify:
1. Launch the WUI and create a Claude Code session that uses nested Task calls
2. Verify that Task events appear as collapsible groups with their sub-events indented
3. Test keyboard navigation with j/k keys across task groups
4. Press Enter on a focused task group to expand/collapse it
5. Create a session with tool calls requiring approval inside a Task - verify the task auto-expands
6. Check that tool calls with approvals show inline badges instead of duplicate approval entries
7. Verify performance with conversations that have no sub-tasks (should behave exactly as before)

## Description for the changelog

feat(wui): implement hierarchical display for Claude sub-task events with collapsible groups, smart previews, and enhanced keyboard navigation