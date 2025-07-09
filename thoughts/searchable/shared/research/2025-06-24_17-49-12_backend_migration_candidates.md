# Research: Backend Migration Candidates from TUI/WUI/hlyr to HLD

**Date**: 2025-06-24 16:56:33 PDT
**Researcher**: allison
**Git Commit**: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
**Branch**: main

## Research Question
What are things that happen in tui or wui or hlyr (or anything that connects to daemon (hld)) that could see value from being ported to the backend (with potential api changes or more backend logic)?

## Summary
Analysis reveals significant opportunities to move client-side logic to the backend, with approval enrichment, real-time updates via SSE, and centralized configuration management as top priorities. The daemon is currently thin in many areas, primarily acting as a coordinator between clients and the HumanLayer cloud API.

## Detailed Findings

### Common Patterns Across All Clients

#### 1. **Approval-Session Enrichment**
- **TUI**: `humanlayer-tui/api.go:109-209` - Fetches approvals then sessions, creates enrichment map
- **WUI**: `src/utils/enrichment.ts:6-112` - Client-side enrichment with session context
- **Current Issue**: Every client implements this logic separately, causing inconsistency and multiple API calls
- **Backend Solution**: Server returns pre-enriched approvals with session context

#### 2. **Polling for Real-time Updates**
- **TUI**: `conversation.go:113-134` - Polls every 3 seconds
- **WUI**: `useConversation.ts:60` - Polls every 1 second
- **hlyr**: Falls back to polling when subscriptions fail
- **Backend Solution**: Implement SSE (Server-Sent Events) as planned in `thoughts/allison/daemon_api/`

#### 3. **Configuration Resolution**
- **hlyr**: `config.ts:108-236` - Complex priority-based config resolution
- **TUI/WUI**: Each has its own config handling
- **Backend Solution**: Centralized configuration service with normalized responses

### TUI-Specific Findings

#### High Priority Migrations:
1. **Tool Result/Approval Correlation** (`conversation.go:649-673`)
   - Already noted in TODO.md as needing backend migration
   - O(n) lookup for each tool result
   - Solution: Store approval_status directly on tool_result in database

2. **Session Sorting Logic** (`sessions.go:166-197`)
   - Complex status-based prioritization
   - Solution: Server-side sorting with configurable orders

3. **Error Message Preprocessing** (`api.go:33-62`)
   - Standardizes API errors to user-friendly messages
   - Solution: Backend returns structured errors with user messages

#### Medium Priority:
- Conversation caching (`tui.go:933-985`)
- Session data validation and defaults
- Approval grouping and counting

### WUI-Specific Findings

#### High Priority Migrations:
1. **Fuzzy Search Implementation** (`lib/fuzzy-search.ts:1-201`)
   - Complex scoring algorithms implemented client-side
   - Solution: Server-side search with caching

2. **Event Formatting** (`SessionDetail.tsx:80-422`)
   - 340+ lines of event transformation logic
   - Solution: Backend provides pre-formatted events

3. **Subscription Fallbacks** (multiple files)
   - Falls back to 5-second polling when subscriptions fail
   - Solution: Reliable SSE implementation

#### Medium Priority:
- Session filtering and status parsing
- Validation logic duplication
- Launch session configuration

### hlyr-Specific Findings

#### High Priority Migrations:
1. **Authentication & Session Management** (`index.ts:44-63`)
   - Local API key validation
   - Solution: Centralized auth service

2. **MCP Server Business Logic** (`mcp.ts:144-196`)
   - Approval workflows and permission handling
   - Solution: Backend handles approval logic, MCP acts as thin client

3. **Thoughts Repository Management** (`thoughtsConfig.ts:39-163`)
   - Git operations and indexing
   - Solution: Cloud-based thoughts service (optional)

### Backend (HLD) Current State

#### Thin/Passthrough Areas:
- Approval system (mostly proxies to cloud API)
- Session launch (delegates to claudecode-go)
- Event distribution (simple pub/sub)
- Error handling (basic propagation)

#### Areas with Business Logic:
- Session state management
- Conversation history aggregation
- Tool call correlation
- Orphan session detection

## Architecture Insights

### Planned Evolution (from thoughts/)
The team has already designed a migration path:
1. JSON-RPC → REST API with OpenAPI
2. Custom event bus → SSE for real-time updates
3. Client-side enrichment → Server-side enrichment
4. Manual polling → Push-based updates

### Design Philosophy
- **Backend-First**: Move complexity to daemon for consistency
- **Schema-Based**: JSON Schema for flexible responses
- **Cloud-Ready**: Support future remote daemons
- **Local-First**: Maintain offline capabilities

## Code References

### Priority Implementation Areas:
- `humanlayer-tui/TODO.md:169-176` - Tool result correlation
- `humanlayer-tui/api.go:109-209` - Approval enrichment
- `humanlayer-wui/src/utils/enrichment.ts:6-112` - Enrichment logic
- `hlyr/src/mcp.ts:144-196` - MCP approval workflows
- `hld/TODO.md:7` - Bulk conversation endpoint
- `hld/TODO.md:17` - Real-time status updates

## Historical Context (from thoughts/)

### Key Decisions:
- `thoughts/allison/daemon_api/docs/design-rationale.md` - Why REST over JSON-RPC
- `thoughts/allison/daemon_api/docs/architecture.md` - SSE for events chosen
- `thoughts/allison/old_stuff/daemon_plan_v2.md` - SQLite-only storage decision

### Implementation Progress:
- Phases 1-4 complete: SQLite storage, RPC methods, approval correlation
- Phase 5 (TUI improvements) pending
- REST API migration designed but not implemented

## Related Research
- `thoughts/shared/research/2025-06-24_16-33-46_session_fork_display_api.md` - Session tree API options

## Open Questions
1. Should fuzzy search remain client-side for responsiveness or move to backend for consistency?
2. How much event formatting should be backend vs. client responsibility?
3. Should thoughts management be optional local feature or cloud service?
4. What's the timeline for the REST API migration already designed?

## Recommendations

### Immediate Actions (High ROI):
1. **Implement approval enrichment in daemon** - Reduces API calls, ensures consistency
2. **Add SSE for real-time updates** - Eliminates polling inefficiency
3. **Move tool result correlation to database** - Already in TODO, clear win

### Medium-term Goals:
1. **REST API migration** - Follow existing design in thoughts/
2. **Centralized configuration service** - Reduce client complexity
3. **Server-side search and filtering** - Enable pagination

### Long-term Vision:
1. **Cloud-based thoughts service** - Optional for teams
2. **Full event formatting in backend** - Consistent across clients
3. **Approval rules engine** - As designed in daemon_api docs