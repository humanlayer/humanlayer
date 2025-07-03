## What problem(s) was I solving?

When continuing a session using the `hlyr continue` command or via the TUI, the child session was not inheriting all configuration fields from the parent session. This meant users had to manually re-specify configuration options like system prompts, tool permissions, and MCP server configurations when resuming sessions, leading to a poor user experience and potential inconsistencies.

Additionally, the codebase had several issues with test reliability, race conditions in approval handling, and database connection management that were causing CI failures.

## What user-facing changes did I ship?

- **Full configuration inheritance**: When continuing a session, all configuration fields are now automatically inherited from the parent session, including:
  - System prompts and append system prompts
  - Custom instructions
  - Permission prompt tool settings
  - Allowed and disallowed tools lists
  - MCP server configurations
- **Override capability**: Users can still override any inherited configuration by explicitly specifying new values when continuing a session
- **Improved reliability**: Fixed race conditions in approval status updates that could cause approvals to be incorrectly overwritten
- **Better error handling**: Sessions that don't exist now properly return errors instead of empty results
- **Removed manual workarounds**: Cleaned up temporary workarounds in the TUI that were manually tracking parent session configuration

## How I implemented it

1. **Database schema update**: Added missing configuration fields to the sessions table:
   - `permission_prompt_tool`
   - `append_system_prompt`
   - `allowed_tools` (JSON array)
   - `disallowed_tools` (JSON array)
   - Created migration script to update existing databases
   - Fixed migration ordering to ensure proper execution for both new and existing databases

2. **Enhanced session continuation logic** in `hld/session/manager.go`:
   - Modified `ContinueSession` to inherit ALL configuration fields from parent session
   - Added logic to deserialize JSON arrays for allowed/disallowed tools
   - Implemented MCP server inheritance from parent session with deterministic ordering
   - Preserved override capability for explicit user specifications
   - Maintained the existing behavior of NOT inheriting MaxTurns (as per design)

3. **Fixed reliability issues**:
   - Fixed race condition in approval status updates: now only updates from pending to resolved, never overwrites approved/denied status
   - Improved error handling to return proper errors for non-existent sessions
   - Fixed listener double-close issue by tracking close state
   - Proper context cancellation handling in monitorSession to prevent 'database is closed' errors during shutdown
   - Fixed CI test failures by using temporary database files instead of in-memory databases for proper connection sharing

4. **Improved test infrastructure**:
   - Added `continue_inheritance_test.go` with comprehensive tests for all inheritance scenarios
   - Enhanced integration tests to run by default with quiet mode support
   - Fixed MCP server ordering to ensure deterministic test results
   - Added config overrides to prevent loading user configuration in tests
   - Filtered approval poller events in subscription tests to reduce noise

5. **Cleanup**: Removed manual inheritance workaround from TUI that was tracking `parentModel` and `parentWorkingDir` fields, as this is now handled properly by the backend

## How to verify it

- [x] I have ensured `make check test` passes

## Description for the changelog

Fixed session continuation to properly inherit all configuration fields from parent sessions, including system prompts, tool permissions, and MCP server configurations. Also improved reliability by fixing race conditions and database connection issues.