# HumanLayer TUI & Daemon Enhancement Plan

## Vision

We are building a system that serves two intertwined purposes:

1. A best-in-class demonstration of HumanLayer's approval capabilities with full context awareness
2. A daily-driver Claude Code replacement that happens to have world-class approval integration

The key insight: Approvals shouldn't be isolated events - they should be understood within the conversation context that created them.

## Current State vs Desired State

### Where We Are Now

**Session Management** (`hld/session/manager.go:119-134`)

- The daemon captures streaming events from Claude Code sessions
- Currently only extracts and stores the session ID from these events
- All other event data (messages, tool calls, token usage) is discarded
- Sessions are tracked in-memory with basic metadata (status, start/end time)
- The `monitorSession()` function has a comment: "Could store events for later retrieval if needed"

**Data Storage**

- All data is stored in-memory only (no persistence across daemon restarts)
- Sessions stored in a map in `hld/session/manager.go`
- Approvals stored in memory in `hld/approval/correlator.go`
- No SQLite integration yet (Phase 6 of original `plan.md` not implemented)

**Approval System** (`hld/approval/manager.go`, `hld/approval/poller.go`, `hlyr/src/mcp.ts`)

- Approvals flow through HumanLayer API and are polled by the daemon
- MCP server wrapper (`hlyr/src/mcp.ts`) intercepts tool calls and creates approvals
- Approvals are correlated with sessions via `run_id` environment variable
- TUI shows approvals in a list view but with limited context

**TUI Capabilities** (`humanlayer-tui/tui.go`)

- Three main tabs: Approvals, Sessions, History
- Shows basic session info (query preview, status, duration)
- Shows approval details but no conversation context
- No ability to continue conversations or see message history
- Cannot navigate from approval to session context

**Event System** (`hld/bus/events.go`, `hld/bus/types.go`)

- Real-time event bus for notifications
- Supports subscriptions with filters
- Currently only publishes approval and session status events
- No streaming of conversation content

### Where We Want to Be

**Session Management**

- Capture and store ALL streaming events from Claude Code
- Parse events into structured conversation format
- Store full message history, tool calls, and responses
- Persist data across daemon restarts using SQLite

**Data Storage**

- SQLite database at `~/.humanlayer/daemon.db`
- Conversation-first schema optimized for the TUI's primary use case
- Single `conversation_events` table for easy conversation reconstruction
- Efficient indexes for session and approval queries
- Raw events preserved for debugging and future replay

**Approval System**

- Approvals viewable in both list and conversation context
- Automatic correlation between approvals and specific tool calls
- "Awaiting approval" state shown inline in conversations
- Navigation from approval list to full session context

**TUI Capabilities**

- Primary interface is conversation view (like Claude Code)
- Full message history with scrolling
- Inline approval/denial without leaving context
- Input box for continuing conversations
- Quick navigation between approvals and their session context

**Event System**

- Continue real-time updates for approvals only (not session events)
- Session events are stored to database and queried on-demand
- No need for live streaming of conversation content
- Computed states (like "awaiting approval") from database queries

## Core Capabilities We're Building

### 1. Full Session Data Capture

- We will capture and store ALL streaming events from Claude Code sessions (not just session IDs)
- We will parse these events into a structured conversation format suitable for display
- We will store messages, tool calls, and tool responses in SQLite for persistence
- We will maintain both structured data (for display) and raw events (for real-time updates)

### 2. Dual Approval Experience

- Approvals from any source (not just Claude Code) will appear in the main approvals view
- Approvals associated with Claude Code sessions will be viewable in two places:
  - The main approvals list (for bulk operations and overview)
  - Inline within the session's conversation context (for informed decision-making)
- Users can navigate from an approval in the main list to its session context (when available)

### 3. Session-Approval Correlation

- We will correlate HumanLayer approvals with specific tool calls in Claude sessions
- Correlation will work by matching: session ID (via run_id), tool name, parameters, and timing
- Claude Code blocks on approvals, so there's only ever ONE pending approval per session
- The "awaiting approval" state is shown inline in the conversation where execution paused
- Approvals remain in HumanLayer's API; we only store the correlation (approval_id) locally

### 4. Multi-Turn Conversation Support

- Users will be able to continue conversations after Claude completes a turn
- New turns are only allowed when a session is in "completed" state (not during approvals)
- This will be implemented directly in the daemon/TUI, not through HumanLayer's API
- Sessions will show clear status: running, awaiting_approval, completed, or failed
- Claude Code SDK handles context internally - we just pass `SessionID` to resume
- Implementation: Set `config.SessionID` in `claudecode-go/client.go:48-49` which adds `--resume` flag
- Resumed sessions share the same `claude_session_id` for continuity
- Reference: `thoughts/references/claude_code_sdk.md:105-109` shows CLI usage

### 5. Context Window Reconstruction

- We will store conversation data in a format that can be easily displayed as a chat
- The storage format will be normalized (not nested JSON) for query efficiency
- We will be able to reconstruct standard conversation exports if needed
- Tool calls and their responses will be properly linked in the display

## What We're NOT Building (Initially)

- Complex filtering or search capabilities
- Multi-user access controls or permissions
- Modified parameter approvals (approve with edits)
- Fancy diff visualizations or specialized tool UIs
- Session replay beyond basic conversation viewing
- Integration with non-Claude Code agents

## Key Design Decisions

### Storage Approach (See `schema_thoughts.md` for full details)

- SQLite database with conversation-first design
- Core tables: `conversation_events`, `sessions`, `mcp_servers`, `raw_events`
- Single query to reconstruct full conversations: `SELECT * FROM conversation_events WHERE claude_session_id = ? ORDER BY sequence`
- Approvals and human contacts remain in HumanLayer API (not duplicated locally)
- Only complete messages stored (no streaming complexity)

### Session Failure Handling

- If daemon restarts, all active Claude Code sessions terminate (cannot be resumed)
- Sessions stuck mid-approval when terminated are marked as "failed"
- Dead sessions show last event in conversation history for debugging
- Pending approvals for dead sessions become orphaned (future: auto-cleanup)
- Only sessions that reach "result" event can be resumed later

### Approval Correlation

- We will track pending tool calls that haven't received responses
- We will match incoming approvals to pending tool calls based on available data
- We will handle cases where approvals arrive for non-session-based requests
- Approval state (pending/approved/denied) will be derived, not stored redundantly

### User Interaction Model

- The primary interface will be the conversation view (not the approvals list)
- Approvals can be handled inline without leaving conversation context
- The system will support both synchronous (approval) and asynchronous (chat) interactions
- Quick keyboard shortcuts will enable the "2-3 second approval" goal

## Implementation Phases

### Phase 1: Capture and Store Session Data

**Key Files to Modify:**

- `hld/session/manager.go:119-134` - Extend `monitorSession()` to capture all events
- `hld/session/types.go` - Add conversation event types
- `hld/daemon/daemon.go` - Initialize SQLite database on startup
- `hld/store/store.go` (new) - Storage interface definition
- `hld/store/sqlite.go` (new) - SQLite implementation of storage interface
- `hld/config/config.go` - Add database path configuration

**Key References:**

- `claudecode-go/types.go:60-128` - StreamEvent, Message, Content structures
- `claudecode-go/client.go:232-293` - How events are parsed from streaming JSON
- `schema_thoughts.md` - Full SQLite schema (conversation-first design)
- `response_schema.md` - Exact format of assistant messages and tool calls

**Implementation Details:**

- Parse streaming events based on structure in `response_schema.md`
- Store complete messages only (no streaming complexity)
- Sequence numbers ensure correct ordering even with concurrent writes
- Transform Content blocks into conversation_events rows

### Phase 2: Expose Conversation Data via RPC

**Key Files to Modify:**

- `hld/rpc/handlers.go` - Add new conversation-related RPC methods
- `hld/rpc/types.go` - Define request/response types for conversation data
- `hld/rpc/server.go` - Register new RPC methods
- `hld/session/types.go` - Extend with conversation data structures
- `hld/client/client.go` - Add client methods for new RPCs

**New RPC Methods:**

- `GetConversation(sessionID string)` - Returns full conversation history
- `GetSessionState(sessionID string)` - Returns current session status
- `GetApprovalContext(approvalID string)` - Returns conversation for an approval

**Changes Needed:**

- Implement efficient queries using indexes from schema
- Return paginated results for long conversations
- Include session metadata with conversation data
- Real-time updates continue for approvals only (not session events)

### Phase 3: Correlation and State Management

**Key Files to Modify:**

- `hld/approval/correlator.go` - Enhance correlation logic
- `hld/approval/manager.go` - Track pending tool calls
- `hld/approval/poller.go` - Update to correlate with stored tool calls
- `hld/session/manager.go` - Add dead session detection
- `hld/bus/types.go` - Keep existing event types (no new ones for sessions)

**Key Integration Points:**

- `hlyr/src/mcp.ts` - How approvals are created with tool info
- `hld/approval/types.go` - FunctionCall structure with RunID

**Changes Needed:**

- Query database for pending tool calls when approval arrives
- Match by tool name, parameters, and timing window (10 seconds)
- Update conversation_events with approval_id when matched
- Compute "awaiting approval" states from database
- Detect and mark dead sessions (not in result state, not active)

### Phase 4: Multi-Turn Conversation Support

**Key Files to Modify:**

- `hld/rpc/handlers.go` - Add `ContinueSession` RPC method
- `hld/session/manager.go` - Implement session continuation logic
- `hld/session/types.go` - Add fields for parent_session_id tracking
- `hld/client/client.go` - Add client methods for session continuation
- `claudecode-go/client.go:48-49` - Use existing resume functionality

**Implementation Approach:**

- Check session status is "completed" before allowing continuation
- Create new session record with parent_session_id set
- Set config.SessionID to claude_session_id for resume
- Launch new Claude process with resumed session
- Continue using same claude_session_id for conversation continuity

**Changes Needed:**

- Add RPC method to send new messages to existing sessions
- Validate session is in resumable state (has result, not active)
- Handle session lifecycle for long-running conversations
- Track parent-child session relationships

## Success Criteria

- Developers can use this as their primary Claude Code interface
- Approvals can be reviewed and decided within 2-3 seconds
- Full conversation context is always available when making approval decisions
- The system demonstrates the value of integrated approval workflows
- Multi-turn conversations work smoothly without jumping to external tools

## Key Technical Context

### Streaming Event Structure (`claudecode-go/types.go`)

- Claude Code SDK provides `StreamEvent` with types: "system", "assistant", "result"
- Assistant messages contain content, model info, and usage data
- Tool use appears as content items within assistant messages
- Events flow through a channel on the `Session` object

### Current Data Flow

1. `hlyr launch` command creates a session with run_id (`hlyr/src/commands/launch.ts`)
2. Daemon launches Claude with MCP server env var (`hld/session/manager.go:47-60`)
3. MCP approval server intercepts tool calls (`hlyr/src/mcp.ts`)
4. Approvals are created via HumanLayer API with run_id
5. Daemon polls for approvals (`hld/approval/poller.go`)
6. TUI displays approvals (`humanlayer-tui/tui.go`)

### Storage Considerations

- Current in-memory maps in `Manager` structs use mutexes for thread safety
- Event bus already handles concurrent subscribers (`hld/bus/events.go`)
- No existing database code - will need to add SQLite dependency
- Config already supports file paths (`hld/config/config.go`)
- Database location: `~/.humanlayer/daemon.db` (similar to socket path)

### Key Technical Decisions

**Event Processing**

- Parse streaming events based on Claude Code SDK structure (`response_schema.md`)
- Store only complete messages (no streaming complexity)
- Transform events into conversation_events table rows immediately
- SQLite easily handles 20+ concurrent agents without batching

**Schema Design** (Full details in `schema_thoughts.md`)

- Conversation-first approach with single `conversation_events` table
- Tool calls tracked inline with approval status
- Sessions can be resumed using shared `claude_session_id`
- Raw events preserved for debugging

**Approval Handling**

- Only one pending approval per session (Claude blocks on approvals)
- Approvals remain in HumanLayer API (not duplicated locally)
- Simple correlation by matching tool name, parameters, and timing window

**Real-time Updates**

- Event bus used ONLY for approval notifications
- Session conversation data is queried on-demand from SQLite
- No need for streaming session events to TUI
- TUI refreshes conversation context when user navigates to it

## Next Steps

With the schema design complete (`schema_thoughts.md`), we need to:

1. ✅ SQLite schema designed with conversation-first approach
2. Implement the storage interface and SQLite backend
3. Modify `monitorSession()` to capture and parse all streaming events
4. Define RPC methods for the TUI's conversation view needs
5. Update TUI to display full conversation context for approvals

(always) tool call received (claude code sdk)

(if no approval needed) tool response received (claude code sdk)

(if approval needed and approved) Incoming humanlayer api via poll (match on run_id to session id),
