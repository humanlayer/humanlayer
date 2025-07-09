# HumanLayer TUI and Daemon Enhancement Plan

## Overview

This plan enhances the HumanLayer Daemon (`hld`) and TUI (`humanlayer-tui`) to replace Claude Code with full session data capture, persistent storage, context-aware approvals, and multi-turn conversations. It follows four phases from `initial.md`, building incrementally with working functionality at each step.

## Constraints

- Real-time updates for approvals only (no session event streaming).
- Claude SDK handles resumption via `--resume` with session ID.
- Approvals stay in HumanLayer API; we store correlations.
- Sessions die on daemon restart (no mid-execution resume).

## Phases

### Phase 1: Capture and Store Session Data in SQLite

**Objective:** Capture all streaming events from Claude Code sessions and store them in SQLite.

**Tasks:**

1. **Initialize SQLite Database:**
   - Modify `hld/daemon/daemon.go:38-97` to initialize SQLite at `~/.humanlayer/daemon.db` using `hld/config/config.go`.
   - Create tables per `schema_thoughts.md` (e.g., `conversation_events`, `sessions`).
2. **Capture All Events:**
   - Update `hld/session/manager.go:119-134` in `monitorSession()` to process all `StreamEvent` types from `claudecode-go/types.go:60-128`.
   - Parse into `conversation_events` rows (messages, tool calls, etc.).
3. **Implement Storage:**
   - Create `hld/store/store.go` with `ConversationStore` interface.
   - Implement `hld/store/sqlite.go` for SQLite operations.

**Deliverables:**

- SQLite database initialized on startup.
- All events stored in `conversation_events`.

**Success Criteria:**

- Daemon creates `~/.humanlayer/daemon.db` on start.
- Events are parsed and stored correctly.
- Query retrieves session history.

**Testing:**

- Unit tests for `hld/store/sqlite.go`.
- Integration tests with mock sessions.
- Manual test: Launch session, restart daemon, verify data.

**Failure Modes:**

- Daemon restart: Sessions marked "failed", data persists.

**Implementation Notes (Phase 1 ✅ COMPLETE)**:

- ✅ Added DatabasePath to `hld/config/config.go` with environment variable support
- ✅ Created `hld/store/` package with `store.go` interface and `sqlite.go` implementation
- ✅ SQLite database initialized at `~/.humanlayer/daemon.db` on daemon startup
- ✅ Schema uses single conversation_events table with is_completed tracking for tool calls
- ✅ Updated `hld/session/manager.go` to capture all StreamEvent types and store in database
- ✅ Simplified approval correlation: NULL = no approval, 'pending'/'approved'/'denied' = approval states
- ✅ Unit tests in `hld/store/sqlite_test.go` pass with `-race` flag
- ✅ Integration tests with mock sessions (`hld/store/sqlite_integration_test.go` and `hld/session/manager_store_integration_test.go`)
- ✅ Fixed `UpdateSession` to return error when no rows affected (prevents silent failures)
- ✅ All tests passing including daemon subscription tests
- ✅ Manual test of session launch and data persistence after daemon restart
- ✅ **MAJOR REFACTOR**: Migrated from hybrid in-memory/database to SQLite-only storage
  - Replaced `m.sessions` map with `m.activeProcesses` (only tracks running Claude processes)
  - Removed in-memory `GetSession()` and old `ListSessions()` methods
  - Renamed `ListSessionInfo()` to `ListSessions()` as primary database interface
  - Added `GetSessionInfo()` for single session database queries
  - Fixed missing database updates for session status transitions
  - All session data now exclusively in SQLite, eliminating sync issues

---

### Phase 2: Expose Conversation Data via RPC

**Objective:** Add RPC methods to fetch conversation data for TUI display.

**Tasks:**

1. **Define RPC Types:**
   - In `hld/rpc/types.go:5-11`, add `GetConversationRequest`/`Response`, `GetSessionStateRequest`/`Response`.
2. **Implement Handlers:**
   - In `hld/rpc/handlers.go:15-117`, add handlers querying `hld/store/sqlite.go`.
3. **Update Client:**
   - In `hld/client/client.go:141-242`, add `GetConversation` and `GetSessionState` methods.

**Deliverables:**

- RPC methods `GetConversation` and `GetSessionState`.
- Client fetches conversation data.

**Success Criteria:**

- `GetConversation` returns full history.
- `GetSessionState` shows current status.
- TUI retrieves data via client.

**Testing:**

- Unit tests for handlers.
- Integration tests for TUI requests.
- Manual test: Fetch conversation via RPC.

**Failure Modes:**

- Dead sessions: Return last state from database.

**Implementation Notes (Phase 2 ✅ COMPLETE)**:

- ✅ Added RPC types in `hld/rpc/types.go` for GetConversation and GetSessionState requests/responses
- ✅ Created `ConversationEvent` and `SessionState` structs with all fields from store layer
- ✅ Implemented `HandleGetConversation` in `hld/rpc/handlers.go` supporting both session ID and Claude session ID lookups
- ✅ Implemented `HandleGetSessionState` returning full session metadata including optional fields
- ✅ Updated `SessionHandlers` to accept store dependency via `NewSessionHandlers(manager, store)`
- ✅ Added client methods: `GetConversation()`, `GetConversationByClaudeSessionID()`, and `GetSessionState()`
- ✅ Registered new handlers in the `Register()` method
- ✅ Unit tests with mocked store verify handler logic and error cases
- ✅ Integration tests use real daemon/client/store stack with in-memory SQLite
- ✅ **DISCOVERED**: `CreateSession` only inserts basic fields; optional fields require `UpdateSession`
- ✅ Fixed integration tests to properly create then update sessions with completion data
- ✅ All tests passing including proper handling of optional fields (CostUSD, TotalTokens, etc.)
- ✅ Updated mock client via `make mocks` to include new methods

---

### Phase 3: Correlate Approvals with Tool Calls

**Objective:** Correlate approvals with tool calls and manage session states.

**Note:** Phase 1 already implemented the storage-side correlation logic (CorrelateApproval, UpdateApprovalStatus, GetPendingToolCall methods). This phase focuses on the real-time integration with HumanLayer API.

**Tasks:**

1. **Integrate with API Polling:**
   - In `hld/approval/manager.go:72-205`, when approvals arrive from HumanLayer API, call store's `CorrelateApproval()` method.
   - Match approvals to tool calls using the existing `GetPendingToolCall()` method by `run_id` and tool name.
   - Call `UpdateApprovalStatus()` when approvals are resolved (approved/denied).
2. **Enhance Existing Correlator:**
   - Update `hld/approval/correlator.go:26-207` to use the SQLite store instead of in-memory storage.
   - Remove duplicate correlation logic since it now lives in the store layer.
3. **Manage Session States:**
   - In `hld/session/manager.go`, detect when sessions are "awaiting approval" based on pending tool calls.
   - Update session status in database when blocked on approvals.

**Deliverables:**

- Approvals linked to tool calls.
- Session states updated in database.

**Success Criteria:**

- Approvals match correct tool calls.
- Sessions show "awaiting approval" when blocked.
- Dead sessions marked "failed" on restart.

**Testing:**

- Unit tests for correlation.
- Integration tests for state transitions.
- Manual test: Approve tool call, verify context.

**Failure Modes:**

- Orphaned approvals: Displayed without context.

**Implementation Notes (Phase 3 ✅ COMPLETE)**:

- ✅ Added `correlateApproval` method in `hld/approval/poller.go` to match HumanLayer approvals with database tool calls
- ✅ Implemented session lookup by run_id before correlating approvals with tool calls
- ✅ Updated session status to 'waiting_input' when approvals are correlated
- ✅ Modified `hld/approval/manager.go` to update session status back to 'running' when approvals are resolved
- ✅ Added `markOrphanedSessionsAsFailed` in `hld/daemon/daemon.go` to handle orphaned sessions on restart
- ✅ Created comprehensive test coverage:
  - Unit tests for approval correlation logic (`correlation_test.go`)
  - Unit tests for session status transitions (`manager_status_test.go`)
  - Integration test for orphaned session handling (`daemon_orphan_test.go`)
  - Integration test for full approval flow (`daemon_session_state_integration_test.go`)
- ✅ All tests passing - approvals correctly correlate with tool calls and session states update properly

---

### Phase 4: Add Multi-Turn Conversation Support

**Objective:** Enable multi-turn conversations using Claude’s `--resume`.

**Tasks:**

1. **Add Continuation Logic:**
   - In `hld/session/manager.go:47-118`, implement resume with `config.SessionID` per `claudecode-go/client.go:48-49`.
2. **Define RPC Method:**
   - In `hld/rpc/handlers.go:15-117`, add `ContinueSession` RPC.
3. **Update TUI:**
   - In `humanlayer-tui/tui.go:166-2310`, add input field and conversation display.

**Deliverables:**

- `ContinueSession` RPC resumes sessions.
- TUI supports multi-turn interactions.

**Success Criteria:**

- Users resume completed sessions.
- Conversation updates in TUI.
- Only "completed" sessions resumable.

**Testing:**

- Unit tests for resume logic.
- Integration tests for multi-turn flow.
- Manual test: Resume session, add message.

**Failure Modes:**

- Daemon restart: New sessions created, old ones unresumable mid-execution.

**Implementation Notes (Phase 4 ✅ BACKEND COMPLETE)**:

- ✅ Added `ContinueSession` RPC method in `hld/rpc/handlers.go` with comprehensive request validation
- ✅ Created `ContinueSessionRequest`/`ContinueSessionResponse` types in `hld/rpc/types.go` supporting all config overrides
- ✅ Implemented `ContinueSession` method in `hld/session/manager.go` with full parent session validation:
  - Validates parent session exists and status is "completed"
  - Validates parent has `claude_session_id` for resumption capability
  - Creates new session with `parent_session_id` reference in database
  - Launches Claude with `--resume` flag using parent's `claude_session_id`
  - Supports optional config overrides (system prompt, MCP config, tools, etc.)
- ✅ Updated `hld/client/client.go` to support `ContinueSession` RPC calls
- ✅ Enhanced database schema to support parent-child session relationships:
  - Added `parent_session_id` field to `SessionState` in RPC types
  - Modified `GetSessionConversation` in `hld/store/sqlite.go` to walk parent chain
  - Returns combined conversation history in chronological order across all parent sessions
- ✅ Added RPC handler tests in `hld/rpc/handlers_continue_session_test.go`:
  - Tests request validation and error handling
  - Tests MCP config parsing and tools configuration
  - Correctly expects empty `claude_session_id` initially (populated from events)
- ✅ Created integration tests in `hld/daemon/daemon_continue_session_integration_test.go`:
  - Tests full RPC flow with daemon and real store
  - Tests parent validation requirements
  - Tests conversation history includes full parent chain
  - All tests passing including parent chain walking
- ✅ **KEY DISCOVERY**: Each resume gets a NEW `claude_session_id` (not shared with parent)
- ✅ **BACKEND READY**: Multi-turn conversation support fully implemented and tested

---

### Phase 5: TUI Conversation Interface ✅ PLANNED

**Objective:** Transform the TUI into a conversation-centric interface that serves as a Claude Code replacement with integrated approval capabilities.

**Core Features:**

- **Conversation view component** - Full message history with proper formatting and inline approvals
- **Context-aware approval workflow** - Navigate from approvals to full conversation context
- **Multi-turn conversation support** - Resume completed sessions with parameter modification
- **Notification system** - Top-right popups for new approvals without disrupting workflow
- **Performance optimizations** - Conversation caching (100 limit) and selective polling

**Implementation Approach:**

1. **Fix critical approval correlation bug** - Change `ORDER BY created_at DESC` to `ORDER BY sequence ASC` in `GetPendingToolCall`
2. **Create conversation view component** - New `conversationModel` with proper bubble tea patterns
3. **Integrate with sessions/approvals tabs** - Enter key navigation to conversation context
4. **Add resume functionality** - Modal for parameter modification using `ContinueSession` RPC
5. **Implement notifications** - Browser-style popups in top-right corner
6. **Add caching and polling** - LRU cache for conversations, 3-second polling for active sessions

**Success Criteria:**

- **2-3 second approval workflow**: Approvals → Enter → see context → a/d → continue
- **Daily Claude Code replacement**: Multi-turn conversations with full context
- **Clean code architecture**: Well-structured components following Go patterns
- **Keyboard-first navigation**: Vim-style j/k, Enter/Esc throughout

**Reference:** Detailed implementation plan in `new_tui_plan.md`

---

## Development Guidelines

- **Concurrency:** Use mutexes (e.g., `hld/session/manager.go:63`) and channels for safety.
- **Error Handling:** Wrap errors with context, log appropriately.
- **Code Style:** Follow existing Go patterns in `hld/` packages.
