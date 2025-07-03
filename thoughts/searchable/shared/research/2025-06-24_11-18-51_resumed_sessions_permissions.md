---
date: 2025-06-24 11:15:35 PDT
researcher: allison
git_commit: 6f2c2d2b569fbb5ceed975b80039a2f98a0ddfee
branch: claude_and_uv
repository: humanlayer
topic: "Resumed Sessions Not Getting Permissions Wired Properly"
tags: [research, codebase, sessions, permissions]
status: complete
last_updated: 2025-06-24
last_updated_by: allison
---

# Research: Resumed Sessions Not Getting Permissions Wired Properly

**Date**: 2025-06-24 11:15:35 PDT
**Researcher**: allison
**Git Commit**: 6f2c2d2b569fbb5ceed975b80039a2f98a0ddfee
**Branch**: claude_and_uv
**Repository**: humanlayer
## Research Question

Resumed sessions do not get permissions wired properly - investigating the issue where permissions/parameters are not correctly transferred when resuming sessions in WUI/HLD.

## Summary

The root cause is that permission-related parameters (`permission_prompt_tool`, `allowed_tools`, `disallowed_tools`) are **not stored in the database**. When a session is resumed, these parameters are lost because they cannot be retrieved from the parent session. The HLD daemon only inherits `Model` and `WorkingDir` from the parent, while permission settings must be explicitly re-specified in the continuation request.

## Detailed Findings

### Database Schema Limitation

- The `sessions` table lacks columns for permission-related fields ([sqlite.go:64-91](hld/store/sqlite.go:64-91))
- The `Session` struct doesn't include permission fields ([store.go:44-66](hld/store/store.go:44-66))
- Only `Model` and `WorkingDir` are persisted and retrievable

### Session Continuation Flow

- **Validation Phase** ([manager.go:645-664](hld/session/manager.go:645-664)):

  - Retrieves parent session from database
  - Validates status and required fields
  - But cannot retrieve permission settings

- **Configuration Building** ([manager.go:701-736](hld/session/manager.go:701-736)):
  - Inherits only `Model` and `WorkingDir` from parent
  - Permission fields only set if provided in request
  - No fallback to parent's original permissions

### WUI Implementation

- **Session Launch** ([useSessionLauncher.ts:95-112](humanlayer-wui/src/hooks/useSessionLauncher.ts:95-112)):
  - Sets up MCP config with approvals enabled
  - Specifies `permission_prompt_tool` as `mcp__approvals__request_permission`
- **Session Continuation** ([SessionDetail.tsx:551-573](humanlayer-wui/src/components/internal/SessionDetail.tsx:551-573)):
  - Only sends `session_id` and `query`
  - Does not re-send permission configuration

## Code References

- `hld/store/sqlite.go:64-91` - Database schema missing permission fields
- `hld/store/store.go:44-66` - Session struct lacks permission fields
- `hld/session/manager.go:721-727` - Permission fields only set from request
- `hld/session/manager.go:701-736` - Limited inheritance from parent session
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:551-573` - WUI doesn't send permissions on continue

## Architecture Insights

1. **Stateless Permission Model**: Permissions are part of session configuration but not session state
2. **MCP Server Storage**: MCP configurations ARE stored (`mcp_servers` table) but not retrieved during continuation
3. **Inheritance Gap**: Only core fields (Model, WorkingDir) are inherited; all configuration is lost
4. **UI Assumption**: WUI assumes permissions will be inherited, but backend doesn't support this

## Historical Context (from thoughts/)

- `thoughts/shared/prs/229_description.md` - PR #229 added validation for working directory during continuation
- `thoughts/allison/old_stuff/daemon_plan_v2.md` - Original plan shows session continuation was Phase 4
- `thoughts/allison/old_stuff/TODO.md` - Known UX issues with resume functionality
- `thoughts/allison/daemon_api/docs/jsonrpc-protocol.md` - Documents optional permission fields in `continueSession`

## Related Research

- Session continuation was implemented as part of Phase 4 backend work
- Working directory validation was a known issue fixed in PR #229
- Tool call approval correlation has separate known issues

## Open Questions

1. Should permissions be stored in the database for inheritance?
2. Should WUI explicitly re-send permission configuration when continuing?
3. Should MCP server configurations be automatically inherited?
4. Is the current behavior intentional (requiring explicit permission re-specification)?
