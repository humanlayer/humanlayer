## What problem(s) was I solving?

- The frontend needed access to file content captured during Claude Code sessions to display better diffs and file state views
- File snapshots were being stored in the database when Claude reads files, but there was no API endpoint to retrieve them
- This blocked the implementation of enhanced diff views in the UI that could show what files Claude has seen

## What user-facing changes did I ship?

- No direct user-facing changes in this PR - this is a backend API addition
- Enables future UI improvements for showing file content diffs and session file state
- Frontend developers can now retrieve all file snapshots for a session via the new `getSessionSnapshots` RPC method

## How I implemented it

- Added a new JSON-RPC handler `HandleGetSessionSnapshots` in `hld/rpc/handlers.go`
- Created request/response types: `GetSessionSnapshotsRequest` and `GetSessionSnapshotsResponse`
- The handler validates the session exists before retrieving snapshots from the store
- Returns file snapshots with tool ID, file path, content, and ISO 8601 formatted timestamps
- Added comprehensive test coverage for all scenarios including:
  - Successful retrieval with multiple snapshots
  - Non-existent session handling
  - Missing session_id validation
  - Empty snapshots case
  - Invalid JSON handling
  - Database error propagation

## How to verify it

- [x] I have ensured `make check test` passes (Note: unrelated test failure in claudecode-go package, but all hld tests including the new endpoint tests pass)
- The new RPC endpoint can be tested by calling `getSessionSnapshots` with a valid session ID
- All test scenarios are covered in `hld/rpc/handlers_test.go`

## Description for the changelog

Add JSON-RPC endpoint to retrieve file snapshots for Claude Code sessions, enabling frontend access to file content captured during Read operations