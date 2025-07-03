---
date: 2025-07-01T14:01:51-07:00
researcher: allison
git_commit: f77f5ebdff616271349254c3bdea2cb0463d3513
branch: allison/eng-1445-local-approvals-allowing-approvedeny-without-humanlayer
repository: eng-1445-local-approvals-allowing-approvedeny-without-humanlayer
topic: "MCP Visibility Problem - Debugging claude_approvals Tool"
tags: [research, codebase, mcp, hlyr, claude-approvals, debugging, logging, visibility]
status: complete
last_updated: 2025-07-01
last_updated_by: allison
---

# Research: MCP Visibility Problem - Debugging claude_approvals Tool

**Date**: 2025-07-01 14:01:51 PDT
**Researcher**: allison
**Git Commit**: f77f5ebdff616271349254c3bdea2cb0463d3513
**Branch**: allison/eng-1445-local-approvals-allowing-approvedeny-without-humanlayer
**Repository**: eng-1445-local-approvals-allowing-approvedeny-without-humanlayer

## Research Question
The MCP Visibility Problem: MCP servers communicate with Claude via stdio, making their internal operations opaque. When the `hlyr` `claude_approvals` tool fails, Claude only shows "Error calling tool" with no diagnostic information. What type of ways can we better handle visibility into this process?

## Summary
The `claude_approvals` MCP server in hlyr lacks comprehensive logging and debugging capabilities. All communication happens through stdio which is captured by Claude, preventing visibility into errors, requests/responses, and server state. The research identified several potential solutions including file-based logging, daemon event streaming, structured error responses, and diagnostic tools.

## Detailed Findings

### MCP Server Implementation (hlyr)

**Core Implementation**: `hlyr/src/mcp.ts:102-238`
- `startClaudeApprovalsMCPServer()` function implements the approval flow
- Registers `request_permission` tool with parameters `tool_name` and `input`
- Communicates with daemon via JSON-RPC over Unix socket
- Returns JSON responses with `behavior: "allow"/"deny"` and optional `updatedInput`

**Error Handling**: `hlyr/src/mcp.ts`
- Wraps errors in `McpError` with error codes (lines 89, 144, 152, 176, 223-228, 233)
- Error messages include context but aren't logged anywhere
- No global error handlers for uncaught exceptions
- Synchronous JSON parsing could throw unhandled exceptions

**Stdio Communication**: 
- Handled by `@modelcontextprotocol/sdk` StdioServerTransport
- Reads from `process.stdin`, writes to `process.stdout`
- Uses JSON + newline delimiter for message framing
- No request/response logging or debugging output

### Current Logging Infrastructure

**Go Components (hld)**:
- Uses structured logging with `slog` package (`hld/cmd/hld/main.go:19-27`)
- Debug mode via `-debug` flag or `HUMANLAYER_DEBUG=true`
- Extensive event bus logging for debugging (`hld/bus/events.go`)
- Logs to stderr only, no file-based logging

**TypeScript Components**:
- hlyr: Basic `console.error()` for errors, no structured logging
- humanlayer-ts: Simple logger wrapper (`humanlayer-ts/src/logger.ts:1-13`)
- No logging framework, no debug modes, no file output

**Key Gap**: No component logs to files or provides persistent debugging output

### Error Visibility Patterns

**Daemon (hld)**:
- Structured error types with context
- JSON-RPC error responses with codes and messages
- Debug logging with contextual fields

**UI Components**:
- WUI: `formatError()` utility for user-friendly messages (`humanlayer-wui/src/utils/errors.ts`)
- TUI: Error detail popup with full error text (`humanlayer-tui/tui.go`)
- Both balance technical detail with user experience

**Missing for MCP**:
- No error detail capture from MCP server
- No request/response logging
- No diagnostic commands beyond `mcp inspector`

### Architecture Insights

**Communication Flow**:
```
Claude → MCP Protocol → hlyr (stdio) → JSON-RPC → hld (daemon) → SQLite
                            ↓                           ↑
                     [BLACK BOX]                    TUI/WUI
```

**The Black Box Problem**:
1. Claude captures all stdio, making console.log/error invisible
2. No alternative output channel for debugging
3. Errors are formatted for Claude, not developers
4. No persistent record of what happened

**Existing Debug Tools**:
- `humanlayer mcp inspector claude_approvals` - Limited functionality
- `HUMANLAYER_DEBUG=true` - Only affects daemon, not MCP server
- No MCP-specific debugging features

## Code References
- `hlyr/src/mcp.ts:102-238` - Main claude_approvals implementation
- `hlyr/src/mcp.ts:223-228` - Error wrapping without logging
- `hlyr/src/daemonClient.ts:93-96` - Daemon connection error handling
- `hld/cmd/hld/main.go:19-27` - Structured logging setup
- `humanlayer-wui/src/utils/errors.ts` - Error formatting patterns
- `@modelcontextprotocol/sdk/dist/esm/server/stdio.js` - Stdio transport

## Historical Context (from thoughts/)

**Known Issues**:
- MCP configuration not inherited when resuming sessions (`thoughts/dex/mcp-diagnosis.md`)
- 20+ instances of direct `process.exit()` in hlyr (`thoughts/shared/research/2025-01-24_06-54-16_code_quality_areas_for_improvement.md`)
- Daemon discards 95% of streaming data from Claude Code
- Limited test coverage for MCP components

**Recent Work**:
- Local approvals implementation removes API dependencies (`thoughts/allison/plans/local_approvals_v2.md`)
- Simplifies debugging by keeping everything local in SQLite

## Potential Solutions

### 1. File-Based Logging
**Implementation**: Write debug logs to a well-known location
- Add Winston or Pino logging framework to hlyr
- Log to `~/.humanlayer/logs/mcp-claude-approvals.log`
- Include request/response payloads, errors, timing
- Rotate logs to prevent disk fill

**Pros**: 
- Simple to implement
- Works even if daemon is down
- Can tail logs in real-time
- Persistent for post-mortem debugging

**Cons**:
- Requires filesystem access
- Need log rotation/cleanup
- User must know where to look

### 2. Daemon Event Streaming
**Implementation**: Send all MCP events to daemon
- Create new RPC method `reportMCPEvent`
- Stream requests, responses, errors to daemon
- Daemon stores in SQLite with session context
- Query via TUI/WUI or CLI commands

**Pros**:
- Centralized debugging
- Can correlate with approval requests
- Accessible through existing UIs

**Cons**:
- Fails if daemon is down
- Adds complexity to daemon
- Could impact performance

### 3. Structured Error Responses
**Implementation**: Enhance error format for better visibility
- Include request ID in errors
- Add debug payload with full context
- Return errors in a way Claude will display
- Use error `data` field for diagnostics

**Pros**:
- Works within existing flow
- No new infrastructure needed
- Visible in Claude's output

**Cons**:
- Limited by what Claude displays
- Can't help with startup failures
- No historical record

### 4. Diagnostic Sidecar
**Implementation**: Separate process for MCP diagnostics
- Launch alongside MCP server
- Intercept stdio streams
- Log to file and/or daemon
- Provide real-time monitoring

**Pros**:
- Complete visibility
- Works for any MCP server
- Can add features over time

**Cons**:
- Complex to implement
- Another process to manage
- Potential stdio conflicts

### 5. Hybrid Approach (Recommended)
Combine multiple solutions for comprehensive debugging:

1. **Immediate**: Add file-based logging with debug flag
   - `HUMANLAYER_MCP_DEBUG=true` environment variable
   - Log to `~/.humanlayer/logs/mcp-claude-approvals-{date}.log`
   - Include timestamp, request/response, errors

2. **Short-term**: Enhanced error responses
   - Include session ID and timestamp in errors
   - Add "Check logs at ~/.humanlayer/logs" hint
   - Structure errors for better Claude display

3. **Medium-term**: Daemon integration
   - Optional event streaming when daemon available
   - Store last N events in circular buffer
   - Query via `humanlayer mcp debug` command

4. **Long-term**: Diagnostic toolkit
   - MCP proxy for request inspection
   - Session replay from logs
   - Performance profiling

## Open Questions
1. Should logs be JSON structured or human-readable?
2. How to handle log rotation and cleanup?
3. Should we log all requests or only errors?
4. How to secure sensitive data in logs?
5. Can we make Claude display more error detail?
6. Should diagnostic data be exposed in TUI/WUI?