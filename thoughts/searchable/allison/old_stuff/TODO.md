# TODO.md

## Features (Planned)

### Token/Cost Display in Detailed Session View

**Goal**: Show cost and token usage for power users to understand resource consumption
**Available data**: `Result.TotalCost`, `Result.NumTurns` already in `session.Info`
**Decision**: Include in detailed/expanded view only, not main table (avoid visual clutter)
**Implementation**: Add to session detail view that doesn't exist yet
**Files**: `humanlayer-tui/sessions.go` (new detailed view component)

### Conversation History View in TUI

**Goal**: Display full conversation history for selected sessions, similar to what `GetConversation` RPC provides
**Scope**: Show messages, tool calls, tool results with proper formatting and syntax highlighting
**Dependencies**: Uses existing `GetConversation` RPC (lines 47-49 in `hld/rpc/types.go`)
**UI considerations**: Scrollable view, proper message threading, tool call/result correlation
**Files**: New TUI components, possibly new view state in `humanlayer-tui/sessions.go`

### Session Resume from TUI

**Goal**: Allow users to continue sessions directly from TUI interface
**Dependencies**: Uses existing `ContinueSession` RPC
**UI flow**: Select session → enter new query → launch continuation
**Integration**: Could combine with conversation history view for context
**Files**: New TUI functionality in `humanlayer-tui/sessions.go`, `humanlayer-tui/api.go`
**Architecture note**: Could reuse modal editor pattern (lines 328-452) for multi-line query input during session continuation

### Terminal Width Responsiveness

**Goal**: Adapt table layout for smaller terminal widths
**Current table**: 6 columns (Status, Modified, Created, Working Dir, Model, Query) with fixed widths: 8+11+11+20+9=59 chars minimum
**Challenges**: Fixed-width columns may not fit narrow terminals
**Potential solutions**:

1. Responsive column hiding (hide working dir first, then model, then created)
2. Multi-line session display for narrow terminals
3. Horizontal scrolling
4. Abbreviated display mode with shorter column names
   **Files**: `humanlayer-tui/sessions.go` - extend `centerText`/`leftPadText` functions with responsive logic
   **Implementation reference**: See current table formatting in `renderListView` method around line 469
   **Context**: Modal text editor system (lines 328-452) provides architecture for complex input handling that could inform responsive design

## Bugs

### Tool Call Approval Matching with Claude Code Batching

**Issue**: Recent Claude Code change allows multiple tool calls to be queued, but our approval correlation matches wrong tool calls
**Root cause**: `GetPendingToolCall` uses `ORDER BY created_at DESC` which gets most recent tool call instead of oldest (currently executing)
**Impact**: Approvals get correlated with wrong tool calls in conversation history, breaking approval context display
**Current behavior**: When Claude queues 10 tool calls and pauses on 2nd one for approval, our system matches the approval to a later tool call instead
**Expected behavior**: Match approvals to the oldest pending tool call (Claude executes sequentially)
**Technical details**:

- Claude executes tool calls sequentially despite queuing multiple
- HumanLayer API has no access to Claude's internal tool call IDs
- Current SQL: `ORDER BY created_at DESC LIMIT 1` gets wrong tool call
- Needed SQL: `ORDER BY sequence ASC LIMIT 1` + filter for uncorrelated calls
  **Fix approach**: Change `hld/store/sqlite.go:670` ordering and add `approval_status IS NULL` filter
  **Files**: `hld/store/sqlite.go` (GetPendingToolCall method), `hld/approval/poller.go` (correlation logic)
  **Impact**: Critical for Phase 5 conversation view accuracy - approvals must show correct context
  **Reference**: `tool_call_approvals.md` for complete technical analysis

### Session Status Not Updated During Tool Approvals

**Issue**: Session status remains "running" even when waiting for approval, making it unclear which sessions need attention
**Current behavior**: Session shows as "running" in TUI but is actually blocked waiting for approval decision
**Expected behavior**: Status should be "waiting_input" or similar when blocked on approvals
**Root cause**: Status updates may not be propagating correctly from approval system to session manager
**Investigation needed**: Check if approval system properly updates session status to waiting_input
**Files**: `hld/approval/manager.go`, `hld/session/manager.go`, status flow between components

### Resume/Continue Session UX Issues

**Issue**: Current resume functionality (press 'r' in conversation view) has poor UX with keybind conflicts
**Current behavior**: Shows simple text input at bottom that captures all keys, user gets stuck and can't type "?" or escape easily
**Problems**:

- Conflicts with global keybinds (can't type "?" which is help)
- Hard to escape (only Esc works, not Ctrl+C or 'q')
- No visual indication it's a modal input
- RPC errors like "session_id is required" provide no debugging context
  **Expected behavior**: Proper modal dialog similar to session creation, with clear escape options and better error handling
  **Technical debt**: Using simple textinput.Model instead of modal approach used elsewhere
  **Files**: `humanlayer-tui/conversation.go` (resume input handling), needs modal dialog similar to session creation
  **Priority**: Medium - resume is a key workflow but current implementation is frustrating

## Potential Future Features

### Query Summarization and Classification

**Goal**: Replace current 45-character truncation with intelligent summaries to help differentiate sessions
**Current implementation**: Simple truncation in `humanlayer-tui/sessions.go` line 358: `truncate(sess.Query, 45)`
**Approaches considered**:

1. **Extract key concepts**: Remove filler words ("please", "can you"), keep important terms
2. **Query type classification**: Identify patterns like "debug X", "implement Y", "explain Z"
3. **LLM-generated summaries**: Use Claude to create summaries (expensive, introduces dependency)
4. **Pattern matching**: Regex-based detection of common development tasks
   **Trade-offs**: Implementation complexity vs. accuracy vs. performance vs. cost
   **Unknown**: Which approach provides best UX improvement per implementation effort
   **Files**: `humanlayer-tui/sessions.go` - replace `truncate` call with smarter summarization
   **Considerations**: Should summaries be generated server-side and cached, or client-side on display?

### Advanced Session Filtering and Search

**Goal**: Help users find specific sessions in large lists
**Features could include**:

- Filter by status, model, date range, working directory
- Search query text and conversation content
- Saved filter presets
- Tag-based organization
  **Implementation complexity**: Requires UI for filter controls, potentially server-side search indexing
  **Unknown**: Do users actually accumulate enough sessions to need this?
  **Dependencies**: May want conversation indexing for content search

### Session Templates and Quick Launch

**Goal**: Save common session configurations for quick reuse
**Features**:

- Save query patterns, model preferences, working directories as templates
- Quick launch from template library
- Share templates between team members
  **Storage**: Could extend session database or separate template storage
  **UI**: Template management interface, quick-launch shortcuts
  **Unknown**: How much session configuration actually repeats in practice?

### Real-time Session Monitoring

**Goal**: Live updates of session progress, token usage, conversation flow
**Implementation**: Extend existing event subscription system to include session progress events
**UI considerations**: Progress indicators, live conversation streaming, resource usage meters
**Performance**: Would require more frequent RPC calls or WebSocket-like connection
**Unknown**: Is real-time monitoring valuable enough to justify complexity?

### Bulk Session Operations

**Goal**: Allow operations on multiple sessions (bulk delete, bulk archive, bulk export)
**UI**: Multi-select interface, batch operation confirmations
**Use cases**: Cleanup old failed sessions, export session data, archive completed work
**Dependencies**: May require new RPC endpoints for bulk operations
**Unknown**: What bulk operations are actually needed in practice?

### Session Data Export and Import

**Goal**: Allow users to export session data for backup, sharing, or analysis
**Formats**: JSON, CSV, markdown conversation logs
**Scope**: Session metadata only vs. full conversation history vs. results
**Use cases**: Documentation, debugging, team sharing, compliance/audit
**Implementation**: Could leverage existing conversation data, add export endpoints
**Unknown**: What formats and detail levels are most valuable?

## Phase 5 TUI Enhancement Features

### Advanced Launch Parameters

**Goal**: Support all available launch parameters in TUI beyond current query/model/workingdir
**Missing parameters**: System prompt (override/append), tool control (allowed/disallowed lists), max turns limit, custom instructions, verbose mode
**Implementation**: Add "Advanced" toggle/section to launch form with additional fields
**Priority**: Medium - would enable power users to fully configure sessions
**Files**: `humanlayer-tui/sessions.go` (launch form), `hld/rpc/handlers.go` (already supports these)
**Note**: Currently only 3/12 available launch parameters are supported in TUI

### MCP Server Configuration UI

**Goal**: JSON editor or structured UI for MCP server configuration during launch/resume
**Current state**: RPC supports MCPConfig parameter but TUI has no interface
**Implementation complexity**: High - requires JSON editing or complex structured forms
**Priority**: Low - complex to implement cleanly, users can configure via CLI for now
**Files**: `humanlayer-tui/sessions.go`, potentially new MCP configuration component

### External Editor Integration

**Goal**: Similar to OpenCode's Ctrl+E functionality for prompt editing in external editor (nvim)
**Inspiration**: `editor_support.md` documents OpenCode's implementation patterns
**Use case**: Power users want to edit prompts in their preferred editor (especially nvim)
**Implementation**: Spawn external editor, read result back into TUI form field
**Priority**: Medium - significant UX improvement for technical users
**Files**: `humanlayer-tui/sessions.go` (modal editors), potentially new editor integration module

### Active Session Tabs

**Goal**: Tab management for multiple active sessions with real-time switching
**Current limitation**: Can only view one session at a time, no multi-session workflow
**Implementation**: Extend tab system to include dynamic tabs for active sessions
**UI considerations**: How to handle tab overflow, session completion, tab ordering
**Priority**: Low - complex UI changes, users can use terminal multiplexing for now
**Dependencies**: Requires polling strategy for multiple sessions simultaneously

### Parent Session Navigation

**Goal**: Jump to parent/child sessions in fork hierarchies
**Current state**: Parent-child relationships exist in database but no TUI navigation
**Use case**: Understanding session history and conversation flow across forks
**Implementation**: "Jump to parent" button in conversation view, parent indicators in session list
**Priority**: Medium - helps users understand session relationships
**Files**: `humanlayer-tui/sessions.go`, `humanlayer-tui/conversation.go` (new)
**Database support**: Parent session ID already stored and retrievable

### Advanced Session Filtering and Search

**Goal**: Filter session list by status, model, date range, search conversation content
**Current state**: Basic list view with status-based sorting only
**Features**: Text search, date pickers, model filters, status toggles
**Implementation complexity**: Medium - requires new UI components and backend search
**Priority**: Low - most users won't accumulate enough sessions to need this initially
**Performance consideration**: Conversation content search would require full-text indexing
