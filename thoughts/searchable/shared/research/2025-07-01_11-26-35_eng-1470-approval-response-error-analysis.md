---
date: 2025-07-01T11:24:14-07:00
researcher: allison
git_commit: c254d36798b5aaf29383d939aac50b532ee7f1fb
branch: main
repository: humanlayer
topic: "ENG-1470: Failed to deny - call already has a response error analysis"
tags: [research, codebase, approvals, daemon, eng-1470, eng-1445, local-approvals]
status: complete
last_updated: 2025-07-01
last_updated_by: allison
---

# Research: ENG-1470 - "Failed to deny: call already has a response" Error Analysis

**Date**: 2025-07-01 11:24:14 PDT
**Researcher**: allison
**Git Commit**: c254d36798b5aaf29383d939aac50b532ee7f1fb
**Branch**: main
**Repository**: humanlayer

## Research Question
Investigate the "Failed to deny: - Approval error: Failed to deny function call: API Error: call already has a response" error reported in ENG-1470, determine its root cause, and assess whether the local approvals implementation (ENG-1445) resolves this issue.

## Summary
The "call already has a response" error is a 409 Conflict response from the HumanLayer API that occurs when attempting to respond to an approval that has already been approved or denied. This is not a WUI-specific issue but rather a fundamental architectural problem with the current system where multiple components (MCP server and daemon) independently interact with the HumanLayer API, creating race conditions and duplicate approval attempts. The local approvals implementation (ENG-1445) completely resolves this issue by removing the HumanLayer API dependency and centralizing all approval management through the daemon's local SQLite database.

## Detailed Findings

### Current System Architecture Issues

#### Dual Polling Problem
- MCP server creates approvals directly via HumanLayer TypeScript SDK ([hlyr/src/mcp.ts:144-203](https://github.com/humanlayer/humanlayer/blob/c254d36798b5aaf29383d939aac50b532ee7f1fb/hlyr/src/mcp.ts#L144-L203))
- MCP polls HumanLayer API every 3 seconds ([humanlayer-ts/src/approval.ts:189,253,303](https://github.com/humanlayer/humanlayer/blob/c254d36798b5aaf29383d939aac50b532ee7f1fb/humanlayer-ts/src/approval.ts#L189))
- Daemon independently polls the same API every 5 seconds ([hld/approval/manager.go:37](https://github.com/humanlayer/humanlayer/blob/c254d36798b5aaf29383d939aac50b532ee7f1fb/hld/approval/manager.go#L37))
- No coordination between these two polling mechanisms

#### ID Generation and Conflicts
- Python SDK generates IDs: `call-{secrets.token_urlsafe(8)}` ([humanlayer/core/approval.py:50-51](https://github.com/humanlayer/humanlayer/blob/c254d36798b5aaf29383d939aac50b532ee7f1fb/humanlayer/core/approval.py#L50-L51))
- TypeScript SDK uses: `call-${crypto.randomUUID().slice(0, 8)}` ([humanlayer-ts/src/approval.ts:27](https://github.com/humanlayer/humanlayer/blob/c254d36798b5aaf29383d939aac50b532ee7f1fb/humanlayer-ts/src/approval.ts#L27))
- Only 8 characters of randomness used for IDs

#### Error Handling
- HumanLayer API returns 409 Conflict when approval already has a response
- Daemon properly converts this to `ErrAlreadyResponded` ([hld/approval/manager.go:109-110](https://github.com/humanlayer/humanlayer/blob/c254d36798b5aaf29383d939aac50b532ee7f1fb/hld/approval/manager.go#L109-L110))
- TUI converts error to user-friendly message ([humanlayer-tui/api.go:33-62](https://github.com/humanlayer/humanlayer/blob/c254d36798b5aaf29383d939aac50b532ee7f1fb/humanlayer-tui/api.go#L33-L62))
- WUI only logs error to console, doesn't display to user ([humanlayer-wui/src/utils/errors.ts:17-19](https://github.com/humanlayer/humanlayer/blob/c254d36798b5aaf29383d939aac50b532ee7f1fb/humanlayer-wui/src/utils/errors.ts#L17-L19))

### Root Cause Analysis

1. **Multiple Entry Points**: Approvals can be created and responded to from:
   - MCP server (directly to API)
   - TUI (through daemon to API)
   - WUI (through daemon to API)
   - Web UI (directly on HumanLayer website)

2. **No Idempotency**: 
   - No deduplication when creating approvals
   - Same tool call can create multiple approvals if retried
   - API doesn't prevent duplicate approvals for same operation

3. **Stale Cache**: 
   - Local memory store may not reflect external changes immediately
   - Polling interval creates window for conflicts

### Local Approvals Solution (ENG-1445)

The local approvals implementation completely eliminates these issues:

#### New Architecture
- All approvals stored locally in SQLite ([hld/store/sqlite.go:171-189](worktree://eng-1445/hld/store/sqlite.go#L171-L189))
- Single flow: MCP → Daemon → Local DB
- No external API dependencies
- Local UUID generation with "local-" prefix ([hld/approval/manager.go:42](worktree://eng-1445/hld/approval/manager.go#L42))

#### Benefits
1. **No race conditions** - Single source of truth (local database)
2. **No duplicate polling** - Only daemon manages approvals
3. **Instant updates** - No polling delay for state changes
4. **Better error handling** - No network-related errors
5. **Simplified architecture** - Removed poller.go and correlator.go entirely

## Code References
- `humanlayer/core/approval.py:50-51` - Python SDK ID generation
- `humanlayer-ts/src/approval.ts:27` - TypeScript SDK ID generation
- `hld/approval/manager.go:109-143` - Conflict error handling
- `hld/approval/poller.go:153-268` - Reconciliation logic for external changes
- `hlyr/src/mcp.ts:144-203` - MCP server approval creation
- `thoughts/allison/specifications/hld/workflows/approval_correlation_algorithm.md:224` - 409 error handling specification

## Architecture Insights
- The current system's distributed nature with multiple independent API clients creates inherent race conditions
- Polling-based architectures are prone to state synchronization issues
- The "call already has a response" error is actually proper API behavior, not a bug
- UI error handling needs improvement - errors should be displayed to users, not just logged

## Historical Context (from thoughts/)
- `thoughts/shared/prs/253_description.md` - Previous fix for race condition in approval status updates
- `thoughts/allison/specifications/hld/workflows/approval_correlation_algorithm.md` - Detailed algorithm for handling 409 conflicts
- `thoughts/shared/research/2025-06-25_15-25-33_wui_error_handling.md` - Known issue with WUI not displaying RPC errors to users
- `thoughts/allison/old_stuff/notes.md` - Early observation of manual web UI overrides causing TUI errors

## Related Research
- `thoughts/shared/research/2025-06-27_15-49-08_local-approvals-mvp.md` - Initial local approvals architecture analysis
- `thoughts/shared/research/2025-06-25_15-25-33_wui_error_handling.md` - WUI error handling improvements

## Open Questions
1. Should we implement a short-term fix for better error display in WUI while local approvals is being developed?
2. How will we handle migration of existing approvals when switching to local-only mode?
3. Should the local approvals implementation include retry logic for tool calls that fail due to timing issues?

## Recommendations

1. **Short-term**: Implement proper toast notifications in WUI to display approval errors to users
2. **Medium-term**: Complete and deploy the local approvals implementation (ENG-1445)
3. **Long-term**: Consider adding approval deduplication based on tool call content, not just IDs