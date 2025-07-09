# Phase 5 TUI Conversation Interface - Planning Document

## Relevant File Paths for Implementation

### Core TUI Files

- `humanlayer-tui/tui.go` - Main TUI application structure, models, view states, tab management
- `humanlayer-tui/sessions.go` - Sessions tab implementation, session detail view, modal editors
- `humanlayer-tui/approvals.go` - Approvals tab implementation with three-level view patterns
- `humanlayer-tui/api.go` - API command patterns and message types for async operations
- `humanlayer-tui/config.go` - Configuration loading patterns
- `humanlayer-tui/conversation.go` - **[NEW FILE]** Main conversation view component for Phase 5

### Backend RPC & Data

- `hld/rpc/handlers.go` - RPC handlers including LaunchSession, GetConversation, ContinueSession
- `hld/rpc/types.go` - RPC types including ConversationEvent, GetConversationRequest/Response
- `hld/session/types.go` - Session types and status definitions
- `hld/store/sqlite.go` - SQLite storage implementation for conversation data
- `hld/client/client.go` - RPC client for TUI to communicate with daemon

### Supporting Infrastructure

- `hld/bus/events.go` - Event bus for real-time notifications
- `schema_thoughts.md` - Complete database schema documentation
- `claudecode-go/types.go` - Claude SDK types for understanding event structure

### Planning & Reference Documents

- `TODO.md` - Specific features and bugs that overlap with Phase 5
- `new_plan.md` - Complete implementation plan with Phase 5 outline
- `initial.md` - Original vision and design decisions
- `plan.md` - Previous planning iterations

## Phase 5 TUI Design Plan

Based on our conversation, here's the comprehensive plan for Phase 5:

### Core Design Decisions ✅ CONFIRMED

**Primary Interface & Navigation:**

- **Approvals tab remains primary** - HumanLayer is an approval company, this should be the main focus
- **Sessions tab is secondary** - Full-screen list view with session details
- **Conversation view accessed via expansion** - Press Enter on session (from Sessions tab) or approval (from Approvals tab)
- **Remove/ignore History tab** - Not being used and confusing

**Session Selection & Context:**

- **Full-screen views** - No splits initially (users can use tmux/terminal splits if needed)
- **Proactive context loading** - When approval event tied to session arrives, pre-load context
- **Active session polling** - Poll every 3 seconds when viewing active session for updates
- **Current sorting verified** ✅ - Active (running/starting) → Completed → Failed, with recent activity first

**Visual Reference:**

- Target design matches `example_claude_code.png` - full conversation context with inline approval at bottom
- User can scroll up through conversation history while approval is at bottom

### Critical Fix Required Before Phase 5

**Tool Call Approval Correlation Bug** - Must be fixed first for accurate conversation display:

- Recent Claude Code batching breaks our approval matching logic
- Currently matches wrong tool calls, breaking conversation context
- Fix: Change `ORDER BY created_at DESC` to `ORDER BY sequence ASC` + filter uncorrelated calls
- **Files**: `hld/store/sqlite.go:670` (GetPendingToolCall method)
- **Impact**: Without this fix, Phase 5 conversation view will show incorrect approval context

### Implementation Plan

#### 1. Conversation View Component (New)

**File:** `humanlayer-tui/conversation.go` (new file)

**Key Features:**

- Render full conversation history using `GetConversation` RPC
- Format messages, tool calls, tool results with proper styling
- Handle scrolling through long conversations
- Show inline approvals at bottom (similar to Claude Code example)
- Display session metadata in header (status, model, cost)
- Support approve/deny actions inline

**Data Requirements:**

- Use existing `GetConversation` RPC
- Use existing `ConversationEvent` types from `hld/rpc/types.go`
- Session metadata from `session.Info`

#### 2. Enhanced Session Detail Flow

**Modify:** `humanlayer-tui/sessions.go`

**New Navigation:**

- Press Enter on session → open conversation view (new `conversationView` state)
- Show visual indicators for sessions with pending approvals
- Poll for updates when viewing active sessions (3-second interval)

**Session Status Indicators:**

- ✓ Completed (can resume/fork) - shows reply/fork box at bottom in conversation view
- ⏳ Running/Starting (active)
- ❌ Failed (cannot resume)
- ⏸️ Waiting for approval (shows inline approval at bottom like Claude Code example)

#### 3. Enhanced Approval Flow

**Modify:** `humanlayer-tui/approvals.go` (if exists) or main TUI

**Navigation:**

- Press Enter on approval → if tied to session, show conversation view with approval context
- If not tied to session → existing approval detail view
- Proactively load conversation context when approval events arrive

#### 4. Multi-Turn Conversation Support

**New Feature:** Resume/Fork Sessions

**UI Flow:**

- Only works when session status is "completed"
- Press `r` in conversation view → opens modal pre-populated with parent session parameters
- Modal shows help text: "These can optionally be changed or left as default"
- Note: Resume supports fewer parameters than launch (not all launch params available)
- "Jump to parent" is separate hotkey in conversation view (not in resume modal)

**Implementation:**

- Use existing `ContinueSession` RPC method
- Create new session for each continuation (fork model)
- Show parent-child relationships in session list

#### 5. Notification System

**Top-Right Popup Notifications:**

- Browser-style download/permission notification popup in top-right corner
- Alert user of new approvals: "New approval required"
- User finishes current task, then manually navigates (e.g., press `1` for approvals tab)
- Multiple pending approvals won't happen (Claude stalls one at a time)

#### 6. Active Sessions Quick Access (Future Enhancement)

**Hotkey-Triggered Overlay:**

- Hotkey opens popup showing just active sessions
- Same metadata/indicators as full session list but filtered
- Quick navigation: hotkey → `1` jumps to first active session with pending approval
- Faster than: Sessions tab → scroll → find → Enter

### Missing TUI Functionality Analysis

#### Currently Supported Launch Parameters (3/12):

- ✅ Query (with modal editor)
- ✅ Model selection (Default/Opus/Sonnet)
- ✅ Working directory

#### Missing Launch Parameters (9/12):

- ❌ System prompt (override/append)
- ❌ Tool control (allowed/disallowed lists)
- ❌ Max turns limit
- ❌ Custom instructions
- ❌ Verbose mode
- ❌ MCP configuration
- ❌ Permission prompt tool

#### Missing Resume/Continue Functionality:

- ❌ No UI for continuing sessions (RPC method exists)
- ❌ No parameter modification during resume
- ❌ No parent session navigation

### Future TODO Items

**Add to TODO.md:**

1. **Advanced Launch Parameters** - Add UI for system prompts, tool control, turn limits, custom instructions
2. **MCP Server Configuration** - JSON editor or structured UI for MCP config (complex, lower priority)
3. **External Editor Integration** - Similar to OpenCode's Ctrl+E functionality for prompt editing
4. **Active Session Tabs** - Tab management for multiple active sessions
5. **Parent Session Navigation** - Jump to parent in session hierarchies
6. **Advanced Session Filtering** - Filter by status, model, date range
7. **Session Templates** - Save common configurations for reuse

### Key Shortcuts & Speed Targets

**Core Navigation:**

- `j/k` - Scroll through conversations/lists (vim-style)
- `Enter` - Expand session/approval to conversation view
- `r` - Resume completed session
- `l` - Launch new session
- `a/d` - Approve/deny inline approvals
- `q/Esc` - Back to previous view

**Speed Goals:**

- **2-3 second approval workflow:** Approvals tab → Enter → see context → a/d → continue
- **Fast session switching:** Sessions tab → Enter → view conversation → Esc → next session
- **Quick resume:** Conversation view → r → modify if needed → launch

### Technical Implementation Notes

**Polling Strategy:**

- Only poll when actively viewing conversation view of active sessions
- 3-second intervals for real-time updates
- Updates append at bottom if user scrolled to bottom, otherwise don't disrupt scroll position
- Stop polling when leaving conversation view
- No polling from other views (sessions list, approvals list)

**Context Pre-loading:**

- When approval event arrives with session ID, immediately call `GetConversation`
- Cache up to 100 conversations, drop oldest when full (simple memory management)
- Cache everything viewed during TUI session lifetime
- Show "fetching conversation" indicator when loading

**Error Handling:**

- Graceful degradation if conversation loading fails
- Show error messages for failed resume attempts
- Handle session state transitions cleanly

**Performance:**

- Lazy load conversation history (only when accessed)
- Implement conversation scrolling efficiently
- Consider pagination for very long conversations
