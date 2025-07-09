---
date: 2025-07-09T14:57:21-07:00
researcher: allison
git_commit: 65080b2e1dae9040e9476bce49a3022b04337d6c
branch: main
repository: humanlayer
topic: "Auto-Accept Edits Mode Implementation [ENG-1556]"
tags: [research, codebase, auto-accept, approvals, daemon, wui, edit-tools]
status: complete
last_updated: 2025-07-09
last_updated_by: allison
---

# Research: Auto-Accept Edits Mode Implementation [ENG-1556]

**Date**: 2025-07-09 14:57:21 PDT
**Researcher**: allison
**Git Commit**: 65080b2e1dae9040e9476bce49a3022b04337d6c
**Branch**: main
**Repository**: humanlayer

## Research Question

Validate the implementation approach for auto-accept edits mode (shift+tab feature) that automatically approves Edit, Write, and MultiEdit tool calls. Specifically, confirm that the logic should sit in the daemon (hld) and understand how the WUI visualizes these tool calls.

## Summary

The research confirms that:
1. **Yes, the daemon (hld) is the correct place** for auto-accept logic - specifically in the approval manager
2. **The three tool types (Edit, Write, MultiEdit) are visualized distinctly** in the WUI with appropriate UI components
3. **The feature is already well-designed** in the thoughts directory with clear implementation patterns
4. **Implementation requires minimal changes** - primarily adding session-level settings and modifying the approval creation flow

## Detailed Findings

### WUI Tool Visualizations

The WUI has sophisticated visualizations for each tool type:

#### Edit Tool
- **Location**: `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:134-142`
- **Display**: Shows "Edit to {filename}" 
- **Approval UI**: CustomDiffViewer with old_string → new_string diff
- **Features**: Unified/split view toggle, word-level diff highlighting, color coding (red for removals, green for additions)

#### Write Tool  
- **Location**: `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:167-179`
- **Display**: Shows filename and full file content
- **Approval UI**: Bordered box with complete file content in monospace font
- **Features**: Border styling indicates status (dashed=pending, solid green=approved, solid red=denied)

#### MultiEdit Tool
- **Location**: `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:144-155`
- **Display**: Shows "MultiEdit X edits to {filename}"
- **Approval UI**: Sequential diffs in single viewer showing cumulative effect
- **Features**: Processes edits in order, supports unified/split view

### Daemon Architecture & JSON-RPC

The daemon has a clean architecture for handling approvals:

#### Key Components
- **Approval Manager**: `hld/approval/manager.go` - Central authority for approval lifecycle
- **RPC Handlers**: `hld/rpc/approval_handlers.go` - JSON-RPC endpoints
- **Store**: `hld/store/store.go` - SQLite persistence

#### Existing JSON-RPC Endpoints
- `createApproval` - Create new approval request
- `fetchApprovals` - Get pending approvals
- `sendDecision` - Send approve/deny decision
- `getApproval` - Get specific approval

#### Why Daemon is the Right Place
1. **Central Authority**: Approval manager already owns the approval lifecycle
2. **Event Access**: Direct access to event bus for real-time notifications  
3. **State Management**: Already manages approval and session state transitions
4. **Minimal Changes**: Can intercept at CreateApproval method

### Current Approval Flow

The approval flow is generic and tool-agnostic:

1. **Request Path**: Claude Code → MCP (hlyr) → Daemon (hld)
   - MCP server creates approval via `daemonClient.createApproval()`
   - Daemon creates pending approval and publishes events

2. **Data Structure** (`hld/store/store.go:175-185`):
   ```go
   type Approval struct {
       ID          string
       ToolName    string    // "Edit", "Write", "MultiEdit"
       ToolInput   json.RawMessage
       Status      ApprovalStatus  // pending/approved/denied
       SessionID   string
       // ... other fields
   }
   ```

3. **No Special Tool Handling**: All tools treated identically in approval flow

### Existing Design from Thoughts

The feature is already well-designed in `thoughts/allison/daemon_api/docs/approval-flow-diagrams.md`:

#### Shift+Tab Implementation Plan
1. **Trigger**: User presses Shift+Tab in UI (WUI/TUI)
2. **API Call**: `POST /api/v1/sessions/{id}/settings` with `{auto_accept_edits: true}`
3. **Daemon Behavior**: 
   - Updates session settings
   - Shows "Auto-accepting edits" indicator
   - When Edit/Write/MultiEdit called, checks session settings
   - If `auto_accept_edits = true`, skips approval creation and immediately approves
4. **Toggle Off**: Press Shift+Tab again to disable

#### Auto-Approval Hierarchy
1. **Session Settings** (highest priority) - temporary, session-specific
2. **Local Project Rules** - `.claude/settings.local.json`  
3. **User Settings** - `~/.claude/settings.json`
4. **CLI Flags** - `--allowedTools`, `--disallowedTools`

## Code References

### Implementation Points
- [`hld/approval/manager.go:30-81`](https://github.com/humanlayer/humanlayer/blob/65080b2e1dae9040e9476bce49a3022b04337d6c/hld/approval/manager.go#L30-L81) - CreateApproval method to modify
- [`hld/rpc/handlers.go:32-45`](https://github.com/humanlayer/humanlayer/blob/65080b2e1dae9040e9476bce49a3022b04337d6c/hld/rpc/handlers.go#L32-L45) - Session settings structure
- [`hld/store/store.go:175-185`](https://github.com/humanlayer/humanlayer/blob/65080b2e1dae9040e9476bce49a3022b04337d6c/hld/store/store.go#L175-L185) - Approval data structure
- [`humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:219-314`](https://github.com/humanlayer/humanlayer/blob/65080b2e1dae9040e9476bce49a3022b04337d6c/humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx#L219-L314) - Approval UI rendering

### Key Files for Implementation
- [`hld/approval/manager.go`](https://github.com/humanlayer/humanlayer/blob/65080b2e1dae9040e9476bce49a3022b04337d6c/hld/approval/manager.go) - Add auto-accept check in CreateApproval
- [`hld/rpc/approval_handlers.go`](https://github.com/humanlayer/humanlayer/blob/65080b2e1dae9040e9476bce49a3022b04337d6c/hld/rpc/approval_handlers.go) - Add settings endpoint if needed
- [`hld/store/store.go`](https://github.com/humanlayer/humanlayer/blob/65080b2e1dae9040e9476bce49a3022b04337d6c/hld/store/store.go) - Add auto_accept_edits to Session struct
- [`humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx`](https://github.com/humanlayer/humanlayer/blob/65080b2e1dae9040e9476bce49a3022b04337d6c/humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx) - Add Shift+Tab handler

## Architecture Insights

1. **Session-Level Toggle**: The auto-accept setting should be stored at the session level, not globally
2. **Immediate Approval**: When enabled, approvals should be created with "approved" status immediately
3. **Event Flow**: Still publish approval events for UI consistency, but skip the "waiting_input" state
4. **Tool Agnostic**: The implementation can treat all three tools (Edit, Write, MultiEdit) the same way

## Historical Context (from thoughts/)

- The shift+tab UX is designed to mimic Claude Code's behavior for familiarity
- Local approvals architecture eliminates network latency 
- Tool call batching issue was already solved by using correct ORDER BY
- Progressive automation is a key design principle (temporary → saved rules)

## Related Research

- `thoughts/allison/daemon_api/docs/architecture.md` - Complete auto-approval system design
- `thoughts/allison/plans/local_approvals_v2.md` - Local approvals implementation details

## Open Questions

1. Should the auto-accept indicator be shown in both WUI and TUI?
2. Should there be a visual/audio confirmation when auto-accept is toggled?
3. Should auto-accept state persist across session restarts or always start disabled?
4. Should there be a timeout for auto-accept mode (e.g., disable after 10 minutes)?