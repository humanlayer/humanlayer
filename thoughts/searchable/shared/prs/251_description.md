## What problem(s) was I solving?

- Session queries were not visible in the conversation view for resumed sessions, only for new sessions
- The session list showed truncated queries which made it hard to identify sessions at a glance
- There was a duplicate display of the query in both the conversation view and as the first message

## What user-facing changes did I ship?

- Session lists now show a concise 50-character summary instead of truncated queries, making sessions easier to identify
- Queries now appear properly in conversation views for both new and resumed sessions
- Removed duplicate query display - queries now appear once as a conversation event instead of being shown separately

## How I implemented it

- Added a `summary` field to the database schema and all related data structures (Session, SessionInfo, SessionState, etc.)
- Implemented a `CalculateSummary` function that creates a 50-character summary with proper Unicode handling and whitespace normalization
- Created a query injection system using a `pendingQueries` map that stores queries until the Claude session ID is available
- The query is injected as the first conversation event (sequence=1) after Claude session ID capture
- Added deduplication logic to prevent duplicate user messages
- Updated all UI components (TUI and WebUI) to display the summary field with fallback to truncated query
- Removed the manual query rendering from conversation views since queries now appear as proper conversation events
- Added comprehensive tests for query injection, including race condition testing

## How to verify it

- [x] I have ensured `make check test` passes

## Description for the changelog

Improved session identification and conversation display: Added summary field for session lists and fixed query visibility in resumed sessions