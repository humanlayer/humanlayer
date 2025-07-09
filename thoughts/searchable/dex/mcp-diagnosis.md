# MCP Configuration Inheritance Issue in Session Resume

## Problem Summary

When a session is resumed using `ContinueSession`, the MCP server configuration (specifically the `approvals/permissions-prompt-tool`) is not being copied from the parent session to the child session. This causes the resumed session to lose the approval functionality that was configured in the original session.

## Database Evidence

**Parent Session:** `0ac2b50d-6f34-44d1-a8dc-2a90853d61ba`

- Has MCP server configuration: `approvals` server with `npx humanlayer mcp claude_approvals`
- Created: 2025-06-23 16:55:28

**Child Session:** `5d84579e-9529-429d-8fd3-9573e71099ed`

- **Missing MCP server configuration entirely**
- Parent: `0ac2b50d-6f34-44d1-a8dc-2a90853d61ba`
- Created: 2025-06-23 16:55:59 (resumed from parent)

```sql
-- Parent has MCP config
SELECT session_id, name, command, args_json FROM mcp_servers WHERE session_id = '0ac2b50d-6f34-44d1-a8dc-2a90853d61ba';
-- Result: approvals|npx|["humanlayer","mcp","claude_approvals"]

-- Child has no MCP config
SELECT session_id, name, command, args_json FROM mcp_servers WHERE session_id = '5d84579e-9529-429d-8fd3-9573e71099ed';
-- Result: (empty)
```

## Root Cause Analysis

### Location: `hld/session/manager.go` - `ContinueSession` function (lines 717-735)

**Current Logic:**

```go
// Apply optional overrides
if req.SystemPrompt != "" {
    config.SystemPrompt = req.SystemPrompt
}
// ... other overrides
if req.MCPConfig != nil {
    config.MCPConfig = req.MCPConfig  // Only sets if explicitly provided
}
```

**Issue:** The logic only applies MCP config if explicitly provided in the request, but **does not inherit the parent session's MCP configuration** when no override is provided.

### Supporting Evidence

1. **Database Schema:** The `mcp_servers` table correctly stores parent session MCP configuration
2. **Storage Functions:** `GetMCPServers` and `StoreMCPServers` work correctly
3. **Missing Logic:** No inheritance from parent to child session in continuation workflow

## Required Fix

### 1. Add Parent MCP Config Inheritance

In `ContinueSession` function around line 717, add logic to retrieve and inherit parent session's MCP configuration:

```go
// MISSING: Retrieve parent session's MCP configuration
if req.MCPConfig == nil {
    // Get parent session's MCP servers
    parentMCPServers, err := m.store.GetMCPServers(ctx, req.ParentSessionID)
    if err != nil {
        slog.Warn("failed to get parent MCP servers", "parent_session_id", req.ParentSessionID, "error", err)
    } else if len(parentMCPServers) > 0 {
        // Convert stored MCP servers back to claudecode.MCPConfig format
        config.MCPConfig = convertMCPServersToConfig(parentMCPServers)
    }
}

// Apply optional overrides (existing logic)
if req.MCPConfig != nil {
    config.MCPConfig = req.MCPConfig
}
```

### 2. Add Helper Function

Create `convertMCPServersToConfig` function to convert stored MCP servers back to `claudecode.MCPConfig` format.

### 3. Inheritance Priority

1. **Default:** Inherit parent session's MCP configuration
2. **Override:** Apply explicitly provided MCP configuration if present
3. **Enhance:** Copy parent's `PermissionPromptTool` if not overridden

## Files That Need Modification

1. **`hld/session/manager.go`** - Add parent MCP config inheritance logic
2. **`hld/store/sqlite.go`** - Add helper function to convert stored MCP servers back to config format
3. **Test files** - Add test coverage for MCP config inheritance scenario

## Test Coverage Gap

The existing test `ContinueSession_HandlesOptionalMCPConfig` in `hld/daemon/daemon_continue_session_integration_test.go` only tests when MCP config is explicitly provided, not when it should be inherited from parent.

## Impact

This issue causes resumed sessions to lose critical functionality like approval prompts, making the resume feature incomplete for workflows that require human oversight.
