# HumanLayer TUI - TODO

## Features (Planned)

### Token/Cost Display in Detailed Session View

**Goal**: Show cost and token usage for power users to understand resource consumption
**Available data**: `Result.TotalCost`, `Result.NumTurns` already in `session.Info`
**Decision**: Include in detailed/expanded view only, not main table (avoid visual clutter)
**Implementation**: Add to session detail view that doesn't exist yet
**Files**: `sessions.go` (new detailed view component)

### Terminal Width Responsiveness

**Goal**: Adapt table layout for smaller terminal widths
**Current table**: 6 columns (Status, Modified, Created, Working Dir, Model, Query) with fixed widths: 8+11+11+20+9=59 chars minimum
**Challenges**: Fixed-width columns may not fit narrow terminals
**Potential solutions**:

1. Responsive column hiding (hide working dir first, then model, then created)
2. Multi-line session display for narrow terminals
3. Horizontal scrolling
4. Abbreviated display mode with shorter column names
   **Files**: `sessions.go` - extend `centerText`/`leftPadText` functions with responsive logic
   **Implementation reference**: See current table formatting in `renderListView` method around line 469
   **Context**: Modal text editor system (lines 328-452) provides architecture for complex input handling that could inform responsive design

## Bugs

### Denied Tool Calls Don't Show User Rejection Message

**Issue**: When tool calls are denied, no user message appears in conversation view explaining the denial
**Current behavior**: Only shows "❌ Tool: Write (denied)" with no follow-up explanation
**Root cause**: Denial updates tool call status but doesn't create separate conversational message
**Expected behavior**: Should show denial reason or "User denied this action" message in conversation
**Technical details**:

- Approval system properly handles denials (updates status, publishes events, continues session)
- Conversation view only shows tool call with denied status, no explanatory message
- No visible indication of why denial occurred or what user did
  **Files**: `conversation.go` (message rendering), potentially `../hld/approval/manager.go` (denial handling)
  **Priority**: Medium - functional but poor UX for conversation review

### Resume/Continue Session UX Issues

**Status**: ❌ **STILL BROKEN** - User testing confirms issues persist
**Current behavior**: Press 'r' shows small text input that captures all keys, can't type "?" or use help
**Problems**:

- Conflicts with global keybinds (can't type "?" which is help)
- Hard to escape (limited escape options)
- Poor visual indication of modal state
- User gets stuck in input mode
  **Expected behavior**: Proper modal dialog similar to session creation, with clear escape options and better error handling
  **Technical debt**: Using simple textinput.Model instead of modal approach used elsewhere
  **Files**: `conversation.go` (resume input handling), needs modal dialog similar to session creation
  **Priority**: High - resume is a key workflow and current implementation is very frustrating

## Phase 5 TUI Enhancement Features

### Advanced Launch Parameters

**Goal**: Support all available launch parameters in TUI beyond current query/model/workingdir
**Missing parameters**: System prompt (override/append), tool control (allowed/disallowed lists), max turns limit, custom instructions, verbose mode
**Implementation**: Add "Advanced" toggle/section to launch form with additional fields
**Priority**: Medium - would enable power users to fully configure sessions
**Files**: `sessions.go` (launch form), `../hld/rpc/handlers.go` (already supports these)
**Note**: Currently only 3/12 available launch parameters are supported in TUI

### MCP Server Configuration UI

**Goal**: JSON editor or structured UI for MCP server configuration during launch/resume
**Current state**: RPC supports MCPConfig parameter but TUI has no interface
**Implementation complexity**: High - requires JSON editing or complex structured forms
**Priority**: Low - complex to implement cleanly, users can configure via CLI for now
**Files**: `sessions.go`, potentially new MCP configuration component

### External Editor Integration

**Goal**: Similar to OpenCode's Ctrl+E functionality for prompt editing in external editor (nvim)
**Inspiration**: `../editor_support.md` documents OpenCode's implementation patterns
**Use case**: Power users want to edit prompts in their preferred editor (especially nvim)
**Implementation**: Spawn external editor, read result back into TUI form field
**Priority**: Medium - significant UX improvement for technical users
**Files**: `sessions.go` (modal editors), potentially new editor integration module

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
**Files**: `sessions.go`, `conversation.go`
**Database support**: Parent session ID already stored and retrievable

### Advanced Session Filtering and Search

**Goal**: Filter session list by status, model, date range, search conversation content
**Current state**: Basic list view with status-based sorting only
**Features**: Text search, date pickers, model filters, status toggles
**Implementation complexity**: Medium - requires new UI components and backend search
**Priority**: Low - most users won't accumulate enough sessions to need this initially
**Performance consideration**: Conversation content search would require full-text indexing

## Potential Future Features

### Query Summarization and Classification

**Goal**: Replace current 45-character truncation with intelligent summaries to help differentiate sessions
**Current implementation**: Simple truncation in `sessions.go` line 358: `truncate(sess.Query, 45)`
**Approaches considered**:

1. **Extract key concepts**: Remove filler words ("please", "can you"), keep important terms
2. **Query type classification**: Identify patterns like "debug X", "implement Y", "explain Z"
3. **LLM-generated summaries**: Use Claude to create summaries (expensive, introduces dependency)
4. **Pattern matching**: Regex-based detection of common development tasks
   **Trade-offs**: Implementation complexity vs. accuracy vs. performance vs. cost
   **Unknown**: Which approach provides best UX improvement per implementation effort
   **Files**: `sessions.go` - replace `truncate` call with smarter summarization
   **Considerations**: Should summaries be generated server-side and cached, or client-side on display?

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

### Tool Result Approval Correlation Quick Fix

**Issue**: Tool_result events lack approval_status in database, requiring frontend correlation with tool_call events
**Current implementation**: `conversation.go` `renderToolResult()` searches events array to find corresponding tool_call approval_status
**Proper fix**: Move correlation to database storage layer in `/hld/session/manager.go` tool_result creation
**Why quick fix**: Avoids touching critical database write path while unblocking denial reason display
**Priority**: Medium - works but inefficient, should be moved to backend for all consumers
