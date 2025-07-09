---
date: 2025-06-26 12:29:13 PDT
researcher: allison
git_commit: 1a2058582344f2e9400591615ad447148b305d02
branch: main
repository: humanlayer
topic: "OpenCode Integration Analysis - API Design, Integration Possibilities, and Human-in-the-Loop Gaps"
tags: [research, codebase, opencode, integration, api-design, human-in-the-loop, approvals]
status: complete
last_updated: 2025-06-26
last_updated_by: allison
---

# Research: OpenCode Integration Analysis - API Design, Integration Possibilities, and Human-in-the-Loop Gaps

**Date**: 2025-06-26 12:29:13 PDT
**Researcher**: allison
**Git Commit**: 1a2058582344f2e9400591615ad447148b305d02
**Branch**: main
**Repository**: humanlayer

## Research Question
Analysis of OpenCode's architecture and API design to determine integration possibilities with HumanLayer's infrastructure, focusing on:
1. Wrapping OpenCode's backend API with hld daemon
2. Connecting HumanLayer's WUI directly to OpenCode
3. Learning opportunities from OpenCode's API design
4. Identifying gaps in OpenCode for human-in-the-loop functionality

## Summary
OpenCode is a sophisticated Go-based terminal AI assistant with a TypeScript server backend. While it has an elegant REST+SSE API design and comprehensive tool system, its permission system is currently disabled, making it incompatible with human-in-the-loop workflows out of the box. Integration with HumanLayer is technically feasible through multiple approaches, but would require significant modifications to OpenCode. The most promising approach is to wrap OpenCode's tool execution layer with HumanLayer's approval system while maintaining OpenCode's excellent developer experience.

## Detailed Findings

### OpenCode Architecture Overview

OpenCode uses a dual-language architecture:
- **Go TUI**: Terminal UI built with Bubble Tea framework
- **TypeScript Server**: Local HTTP server (Hono framework) on port 4096
- **Communication**: OpenAPI-generated Go client communicates with TypeScript server
- **Real-time Updates**: Server-Sent Events (SSE) for streaming

Key architectural patterns:
- Event-driven internal communication via typed event bus
- File-based session storage (no database)
- MCP (Model Context Protocol) support for external tools
- Provider-agnostic AI integration

### Integration Approach 1: Wrapping OpenCode with hld Daemon

**Feasibility**: High, with modifications

**Integration Points**:
1. **Tool Execution Interception** (`/Users/allison/git/opencode/packages/opencode/src/session/index.ts:393-437`)
   - Intercept `tool.execute()` calls to route through HumanLayer approval
   - Add approval check before execution
   - Support parameter modification during approval

2. **Session ID Mapping**
   - Map OpenCode's session IDs to HumanLayer's run_ids
   - Set `HUMANLAYER_RUN_ID` environment variable for MCP servers
   - Store bidirectional mapping for correlation

3. **Event Bus Integration**
   - Publish approval events to OpenCode's event bus
   - Subscribe to approval decisions from HumanLayer

**Required Modifications**:
```typescript
// Add to tool execution flow
if (shouldRequireApproval(toolName, args)) {
  const approval = await requestHumanLayerApproval({
    toolName, args, sessionID, runID: getRunIDForSession(sessionID)
  })
  if (!approval.approved) {
    throw new Error(approval.comment || "Tool execution denied")
  }
  args = approval.updatedArgs || args
}
```

### Integration Approach 2: Connecting WUI to OpenCode

**Feasibility**: Medium, requires adapter layer

**API Compatibility Issues**:
1. **Protocol Mismatch**: WUI expects JSON-RPC, OpenCode provides REST+SSE
2. **Session Model Differences**: 
   - OpenCode: Simple file-based sessions
   - HumanLayer: Database-backed with state machine
3. **Missing Endpoints**: OpenCode lacks approval management APIs

**Adapter Design**:
```typescript
class HumanLayerAdapter {
  // Transform OpenCode sessions to HumanLayer format
  async listSessions(): Promise<SessionInfo[]> {
    const sessions = await this.opencodeAPI.listSessions()
    return sessions.map(this.transformSession)
  }
  
  // Poll for approval-like events from permission system
  async fetchApprovals(sessionId?: string) {
    // Transform tool invocations to approval requests
  }
}
```

**Required OpenCode Additions**:
- Approval management endpoints (`/approval_list`, `/approval_decide`)
- Session state tracking endpoint
- Subscription system with filtering
- Cost/token aggregation

### API Design Comparison and Learning Opportunities

**OpenCode Strengths**:
1. **OpenAPI-First Design**
   - Auto-generated documentation and client code
   - Type-safe contracts between components
   - Better tooling ecosystem support

2. **Zod Schema Validation**
   - Runtime type checking beyond TypeScript
   - Composable schema definitions
   - Automatic error serialization

3. **Event Bus Architecture**
   - Type-safe event definitions
   - Loose coupling between components
   - Clean pub/sub patterns

4. **Token Tracking Granularity**
   - Per-message cost calculation
   - Cache token tracking (Anthropic-specific)
   - Detailed reasoning token counts

**HumanLayer Strengths**:
1. **Robust Persistence**
   - SQLite with schema migrations
   - Session recovery capabilities
   - Audit trail for approvals

2. **Explicit State Management**
   - Clear session lifecycle states
   - Process monitoring and recovery
   - Graceful shutdown handling

3. **Human-in-the-Loop First**
   - Built-in approval workflows
   - Multi-channel notification support
   - Policy-based automation potential

**Recommendations for HumanLayer**:
1. Adopt OpenAPI specification for REST API migration
2. Implement Zod-style runtime validation
3. Add per-message token tracking
4. Consider SSE for simpler real-time updates

**Recommendations for OpenCode**:
1. Add database persistence option
2. Implement explicit session state machine
3. Add approval/permission infrastructure
4. Support session recovery/resumption

### Critical Gaps in OpenCode for Human-in-the-Loop

1. **Permission System Completely Disabled**
   - Line 67 in `/packages/opencode/src/permission/index.ts` bypasses all checks
   - TUI permission dialog is non-functional
   - No approval UI implementation

2. **Missing Approval Infrastructure**
   - No external approval source support
   - No approval-related API endpoints
   - No webhook/callback mechanisms
   - No approval event types beyond basic `permission.updated`

3. **Limited Session Control**
   - Cannot pause/resume sessions for approvals
   - No interrupt mechanism for pending approvals
   - Sessions can only be aborted, not suspended

4. **No Parameter Modification**
   - Tool arguments cannot be edited during approval
   - No support for conditional execution
   - Missing pre-execution hooks

5. **No Audit Trail**
   - Approval decisions not persisted
   - No history of tool executions
   - Limited accountability features

## Code References

### OpenCode Key Files
- `/Users/allison/git/opencode/packages/opencode/src/server/server.ts:45-565` - Main REST API implementation
- `/Users/allison/git/opencode/packages/opencode/src/permission/index.ts:67` - Permission bypass bug
- `/Users/allison/git/opencode/packages/opencode/src/session/index.ts:393-437` - Tool execution flow
- `/Users/allison/git/opencode/packages/opencode/src/bus/index.ts:21-95` - Event bus system

### HumanLayer Key Files
- `/Users/allison/humanlayer/humanlayer/hld/daemon/daemon.go:26-281` - Main daemon architecture
- `/Users/allison/humanlayer/humanlayer/hld/approval/manager.go:145-314` - Approval management
- `/Users/allison/humanlayer/humanlayer/humanlayer/core/approval.py:153-274` - SDK decorator implementation
- `/Users/allison/humanlayer/humanlayer/humanlayer-wui/src/hooks/useApprovals.ts:106-164` - WUI integration

## Architecture Insights

1. **Protocol Choice Matters**: OpenCode's REST+SSE is more accessible but HumanLayer's JSON-RPC is more efficient for local IPC
2. **Event-Driven Design**: Both systems benefit from loose coupling via events
3. **Type Safety**: OpenCode's code generation approach reduces bugs and improves DX
4. **Persistence Strategy**: Trade-offs between simplicity (files) and features (database)
5. **Permission Architecture**: Must be designed in from the start, retrofitting is challenging

## Historical Context (from thoughts/)

Based on exploration of the thoughts directory:
- HumanLayer is planning migration from JSON-RPC to REST API with OpenAPI (`thoughts/allison/daemon_api/`)
- MCP integration already exists in HumanLayer for Claude Code sessions
- Architecture designed for future cloud deployment while remaining local-first
- Approval system designed to be extensible with plugin-like architecture

## Implementation Recommendations

### Phase 1: Quick Wins (1-2 days)
1. Fix OpenCode's permission bypass (remove line 67)
2. Create proof-of-concept tool execution wrapper
3. Implement basic session ID to run_id mapping

### Phase 2: Core Integration (1 week)
1. Build HumanLayerClient for OpenCode
2. Implement approval request/response flow
3. Add essential API endpoints to OpenCode
4. Create adapter layer for WUI compatibility

### Phase 3: Full Integration (2-3 weeks)  
1. Implement session pause/resume in OpenCode
2. Add parameter modification support
3. Build comprehensive approval UI in OpenCode TUI
4. Add audit trail and persistence

### Phase 4: Production Ready (1 month)
1. Performance optimization
2. Error handling and recovery
3. Documentation and examples
4. Integration testing suite

## Open Questions

1. **Licensing**: Can OpenCode's architecture be adopted given its license?
2. **Maintenance**: Who would maintain the integration layer?
3. **Performance**: Would the additional approval layer impact responsiveness?
4. **User Experience**: How to minimize friction while maintaining security?
5. **Standardization**: Should we propose a standard for AI tool approval protocols?

## Conclusion

OpenCode and HumanLayer represent complementary approaches to AI-assisted development. OpenCode excels at developer experience and modern API design, while HumanLayer provides robust human oversight and approval workflows. Integration is technically feasible through multiple approaches, with the tool execution wrapper being the most promising. The main challenge is OpenCode's disabled permission system, which would need to be re-enabled and extended for meaningful human-in-the-loop functionality.

The best path forward would be:
1. Short-term: Build an adapter layer to connect the systems
2. Medium-term: Contribute approval infrastructure to OpenCode
3. Long-term: Standardize approval protocols for AI development tools