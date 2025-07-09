## What problem(s) was I solving?

When Claude Code spawns sub-tasks (using the Task tool), there was no way to track the parent-child relationships between the main task and its sub-tasks. This made it difficult to understand the task hierarchy and relationships in the HumanLayer UI and for debugging purposes.

## What user-facing changes did I ship?

No direct user-facing changes - this is an infrastructure improvement that will enable future UI enhancements. The parent-child relationships are now:
- Captured from Claude's streaming JSON events
- Stored in the database with proper indexing
- Exposed through the RPC API for future UI consumption

## How I implemented it

1. **Added ParentToolUseID field to StreamEvent** in `claudecode-go/types.go` to parse the parent_tool_use_id from Claude's streaming JSON
2. **Database migration** (migration 6) in `hld/store/sqlite.go`:
   - Added `parent_tool_use_id` column to conversation_events table
   - Created index for efficient parent-child queries
   - Included safety check to avoid duplicate column errors
3. **Updated data flow** throughout the system:
   - Modified ConversationEvent structs to include ParentToolUseID
   - Updated all SQL queries to handle the new field
   - Passed parent ID through event processing pipeline
   - Exposed parent_tool_use_id in RPC getConversation responses
4. **Event bus integration**: Include parent_tool_use_id in published events for future extensibility

## How to verify it

- [x] I have ensured `make check test` passes
- [ ] Manually verified that sub-tasks have correct parent_tool_use_id (user confirmed this was tested)
- [ ] Manually verified that regular tool calls have NULL parent_tool_use_id (user confirmed this was tested)

## Description for the changelog

Add support for tracking parent-child relationships between Claude tasks and sub-tasks, enabling future UI improvements for visualizing task hierarchies.