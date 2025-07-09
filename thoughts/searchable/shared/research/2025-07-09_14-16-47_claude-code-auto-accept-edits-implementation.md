---
date: 2025-07-09 14:13:42 PDT
researcher: dex
git_commit: 93bd5f7bad77cd7f6c7e09e996c89d469e4e310d
branch: dexter/eng-1556-auto-accept-edits-mode
repository: eng-1556-auto-accept
topic: "Claude Code Auto-Accept Edits Mode Implementation for WUI"
tags: [research, codebase, claude-code, wui, auto-accept, session-management, mcp, permissions]
status: complete
last_updated: 2025-07-09
last_updated_by: dex
---

# Research: Claude Code Auto-Accept Edits Mode Implementation for WUI

**Date**: 2025-07-09 14:13:42 PDT  
**Researcher**: dex  
**Git Commit**: 93bd5f7bad77cd7f6c7e09e996c89d469e4e310d  
**Branch**: dexter/eng-1556-auto-accept-edits-mode  
**Repository**: eng-1556-auto-accept  

## Research Question
How can we implement Claude Code's shift+tab auto-accept edits feature in the WUI, exploring different approaches including session interruption/resumption vs settings modification, with careful consideration of user experience and responsiveness?

## Summary
After comprehensive research, I've identified three viable implementation approaches for bringing Claude Code's auto-accept edits feature to the WUI:

1. **Session Interruption/Resumption** - Interrupt running session and resume with modified `allowedTools` configuration
2. **MCP Server Modification** - Modify the approval handler to auto-approve specific tools without session restart
3. **Settings File Modification** - Modify `.claude/settings.local.json` and restart Claude Code session

The **MCP Server Modification** approach emerges as the most promising for optimal user experience, while **Session Interruption/Resumption** provides the most straightforward implementation path.

## Detailed Findings

### Claude Code CLI Auto-Accept Feature

**How it works** (`shift+tab` in CLI):
- Cycles through three modes: Normal → Auto-Accept Edit On → Plan Mode On
- Auto-accept mode bypasses confirmation prompts for file edits and tool operations
- Controlled by `allowedTools` configuration passed to Claude CLI
- Changes take effect immediately without session restart

**Technical Implementation**:
- Uses `--allowedTools` and `--disallowedTools` CLI flags
- Permissions are static at session launch time
- Configuration hierarchy: settings files → CLI flags → MCP permission prompts
- No hot-reload capability in Claude Code's settings system

### Current Architecture Analysis

**Session Management** (`humanlayer-wui/src/components/internal/SessionDetail/`):
- Well-established keyboard shortcut patterns using `react-hotkeys-hook`
- Existing shortcuts: `a` (approve), `d` (deny), `escape` (cancel), `ctrl+x` (interrupt)
- Scoped hotkeys prevent conflicts (`SessionDetailHotkeysScope`)
- Session actions handled through `useSessionActions.ts`

**Tool Permission System** (`hld/session/manager.go:784-794`):
- `allowedTools` and `disallowedTools` arrays supported in launch/continue configs
- Tool permissions inherited from parent sessions during continuation
- No existing auto-accept mechanisms found in approval handlers

**MCP Protocol Implementation** (`hlyr/src/mcp.ts:54-139`):
- `request_permission` tool handles all approval flows
- Static tool configuration at session launch
- No dynamic tool permission update mechanisms

### Implementation Approaches Analyzed

#### 1. Session Interruption/Resumption Approach

**Pros:**
- Uses existing, well-tested infrastructure
- Clear permission model through `allowedTools` configuration
- Maintains session history and context
- No architectural changes required

**Cons:**
- Slow/unresponsive user experience (identified issue)
- Creates new session record for each toggle
- May lose some session state during transition
- Requires interrupting active Claude operations

**Implementation** (`hld/session/manager.go:710-920`):
```go
// Interrupt current session
interruptSession(sessionId)

// Continue with modified permissions
continueSession(sessionId, {
    allowedTools: autoAcceptEnabled ? 
        ["Edit", "MultiEdit", "Write"] : 
        []
})
```

#### 2. MCP Server Modification Approach (RECOMMENDED)

**Pros:**
- Immediate response to user input
- No session interruption required
- Maintains session continuity
- Can be implemented as feature flag in approval handler

**Cons:**
- Requires modifying approval logic in `hlyr/src/mcp.ts`
- Need to implement auto-approve state management
- May bypass some safety checks
- Requires coordination between UI and MCP server

**Implementation** (`hlyr/src/mcp.ts:request_permission`):
```typescript
// Add auto-accept state to MCP server
let autoAcceptEdits = false;

// Modify request_permission handler
if (autoAcceptEdits && isEditTool(toolName)) {
    return { approved: true, reason: "Auto-accept enabled" };
}
```

#### 3. Settings File Modification Approach

**Pros:**
- Uses Claude Code's native configuration system
- Persistent across sessions
- No architectural changes to approval flow

**Cons:**
- Requires Claude Code restart to take effect (confirmed limitation)
- Settings only read at startup, not during runtime
- Poor user experience due to restart requirement
- May interfere with other Claude Code processes

**Research Finding**: Claude Code reads `.claude/settings.local.json` only at startup - no hot-reload capability exists.

### User Experience Considerations

**Current Pain Points**:
- Session interruption is "slow/unresponsive" (user feedback)
- Users expect immediate toggle like CLI's shift+tab
- Need visual feedback for auto-accept state

**Keyboard Shortcut Implementation**:
- `shift+tab` available in SessionDetail scope (no conflicts found)
- Existing hotkey patterns support immediate state changes
- Visual indicators needed for current mode

**Responsiveness Requirements**:
- Toggle should feel instantaneous
- No disruption to ongoing Claude operations
- Clear visual feedback for mode state

## Code References

### Session Management
- `humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx:94-113` - Escape key handling
- `humanlayer-wui/src/components/internal/SessionDetail/hooks/useSessionActions.ts:24-51` - Session continuation
- `hld/session/manager.go:965-1013` - Session interruption logic
- `hld/session/manager.go:710-920` - Session continuation with config inheritance

### Tool Permissions
- `claudecode-go/client.go:134-139` - AllowedTools CLI argument passing
- `hld/rpc/types.go:90-91` - ContinueSessionRequest with tool permissions
- `hlyr/src/mcp.ts:125-137` - request_permission tool definition

### Keyboard Shortcuts
- `humanlayer-wui/src/components/internal/SessionDetail/hooks/useSessionApprovals.ts:72-145` - Approval shortcuts
- `humanlayer-wui/src/hooks/useStealHotkeyScope.ts:1-23` - Hotkey scope management

## Architecture Insights

1. **Static Permission Model**: Tool permissions are set at session launch and cannot be modified during runtime
2. **MCP Approval Bottleneck**: All tool approvals flow through the `request_permission` MCP tool
3. **Session Inheritance**: Child sessions inherit parent configuration but can override specific settings
4. **No Hot Configuration**: Claude Code has no mechanism for runtime configuration updates

## Implementation Recommendations

### Phase 1: MCP Server Auto-Accept (Recommended)
1. Add auto-accept state management to MCP server (`hlyr/src/mcp.ts`)
2. Modify `request_permission` handler to check auto-accept state for Edit/MultiEdit/Write tools
3. Implement RPC endpoint to toggle auto-accept state from WUI
4. Add shift+tab hotkey handler in SessionDetail component
5. Add visual indicator for auto-accept mode status

### Phase 2: Enhanced Session Management (Future)
1. Implement session configuration hot-reload capability
2. Add persistent user preferences for auto-accept mode
3. Optimize session interruption/resumption performance
4. Add session template system for common permission patterns

### Phase 3: Advanced Features (Future)
1. Tool-specific auto-accept granularity
2. Auto-accept with approval thresholds
3. Audit log for auto-approved actions
4. Integration with Claude Code's safety systems

## Open Questions
1. Should auto-accept state persist across sessions or reset each time?
2. How to handle edge cases where Claude Code session fails during auto-accept?
3. Should there be different auto-accept modes (edits-only vs all-tools)?
4. How to maintain safety while providing rapid approval flow?

## Related Research
- Previous work on session management optimization
- Tool permission system architecture
- MCP protocol extensions for dynamic configuration
- User experience patterns for approval workflows