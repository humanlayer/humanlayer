## What problem(s) was I solving?

- When users have multiple Claude Code sessions with continuations (parent-child relationships), the UI displays all sessions including intermediate ones, creating visual clutter
- Users only care about the most recent/active sessions in each conversation chain, not the full history
- The existing `listSessions` endpoint returns all sessions without any filtering

## What user-facing changes did I ship?

- The WUI now only displays leaf sessions (sessions with no children), significantly reducing clutter when users have multiple session continuations
- Sessions are sorted by last activity with the newest first, making it easier to find recent work
- The session display remains functionally the same but with fewer, more relevant entries

## How I implemented it

- **Backend (hld daemon)**:
  - Added new `getSessionLeaves` JSON-RPC endpoint that filters sessions to return only leaf nodes
  - Built a parent-to-children map to identify which sessions have children
  - Added database migration 5 to create an index on `parent_session_id` for efficient tree queries
  - Included comprehensive unit tests covering various tree structures (linear chains, forks, deep trees)
  - Added integration test for the new endpoint

- **Client libraries**:
  - Extended Go client interface and implementation with `GetSessionLeaves` method
  - Added TypeScript types and method to DaemonClient
  - Added Rust types, trait method, and Tauri command for WUI integration

- **Frontend (WUI)**:
  - Updated `AppStore` and `useSessions` hook to call `getSessionLeaves` instead of `listSessions`
  - No UI component changes needed - the filtered data works seamlessly with existing components

- **Testing improvements**:
  - Created `DatabasePath` test utility for proper SQLite test isolation
  - Fixed integration tests that were using the user's actual database instead of test databases
  - Refactored existing SQLite tests to use the new utility

- **Documentation**:
  - Added CLAUDE.md to the TUI project marking it as archived (per ENG-1507)

## How to verify it

- [x] I have ensured `make check test` passes

## Description for the changelog

Add `getSessionLeaves` endpoint to show only active session branches in UI, reducing clutter from session continuations