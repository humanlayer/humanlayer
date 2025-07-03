# Research: HLD Daemon Interface and Available Requests

**Date**: 2025-06-24 10:15:53 PDT
**Researcher**: nyx
**Git Commit**: 61c50c0b61dfde4084a582015681bd4a9da51680
**Branch**: render-todos

## Research Question

Give me a sense of the hld daemon interface, what things can I request?

## Summary

The HumanLayer Daemon (HLD) provides a comprehensive JSON-RPC 2.0 API over Unix domain sockets for managing Claude Code sessions, approval workflows, and real-time event subscriptions. The daemon serves as the central coordination point between client applications and the HumanLayer cloud API, offering 13 distinct request types across 5 major functional areas.

## Detailed Findings

### Core Architecture

- **Protocol**: JSON-RPC 2.0 over Unix domain sockets
- **Socket Path**: `~/.humanlayer/daemon.sock` (configurable via `HUMANLAYER_DAEMON_SOCKET`)
- **Security**: 0600 file permissions (owner read/write only)
- **Message Format**: Line-delimited JSON with newline terminators
- **Implementation**: Go-based daemon with SQLite persistence

### Health & Status Management

- **`health`** ([hld/rpc/server.go:234-240](file://hld/rpc/server.go#L234))
  - Parameters: None
  - Response: `{"status": "ok", "version": "0.1.0"}`
  - Usage: Connection verification, daemon availability testing

### Session Management Operations

- **`launchSession`** ([hld/rpc/handlers.go:50-100](file://hld/rpc/handlers.go#L50))

  - Parameters: `LaunchSessionRequest` with query, model, MCP config, working directory
  - Response: `{"session_id": "string", "run_id": "string"}`
  - Usage: Create new Claude Code sessions with configurable parameters

- **`listSessions`** ([hld/rpc/handlers.go:112-128](file://hld/rpc/handlers.go#L112))

  - Parameters: None
  - Response: Array of session information objects
  - Usage: Enumerate active and historical sessions

- **`getSessionState`** ([hld/rpc/handlers.go:185-235](file://hld/rpc/handlers.go#L185))

  - Parameters: `{"session_id": "string"}`
  - Response: Complete session state with status, timing, costs, metadata
  - Usage: Monitor session progress and resource consumption

- **`continueSession`** ([hld/rpc/handlers.go:237-286](file://hld/rpc/handlers.go#L237))

  - Parameters: `ContinueSessionRequest` with session_id and optional overrides
  - Response: New session details for continuation
  - Usage: Resume sessions with new queries or configuration changes

- **`interruptSession`** ([hld/rpc/handlers.go:288-321](file://hld/rpc/handlers.go#L288))
  - Parameters: `{"session_id": "string"}`
  - Response: Success confirmation
  - Usage: Terminate running sessions gracefully

### Conversation History Access

- **`getConversation`** ([hld/rpc/handlers.go:130-183](file://hld/rpc/handlers.go#L130))
  - Parameters: Either `session_id` or `claude_session_id`
  - Response: Array of conversation events with tool calls, results, approval status
  - Usage: Retrieve complete interaction history for analysis or display

### Approval Workflow Management

- **`fetchApprovals`** ([hld/rpc/approval_handlers.go:36-76](file://hld/rpc/approval_handlers.go#L36))

  - Parameters: Optional `session_id` filter
  - Response: Array of pending approvals (function calls and human contacts)
  - Usage: Poll for items requiring human decision

- **`sendDecision`** ([hld/rpc/approval_handlers.go:92-152](file://hld/rpc/approval_handlers.go#L92))
  - Parameters: `call_id`, `type` (function_call/human_contact), `decision` (approve/deny/respond), `comment`
  - Response: Success/error status
  - Usage: Provide human decisions on pending approvals

### Real-time Event Subscription

- **`Subscribe`** ([hld/rpc/subscription_handlers.go:64-203](file://hld/rpc/subscription_handlers.go#L64))
  - Parameters: `SubscribeRequest` with optional event type and session filters
  - Behavior: Long-polling connection with 30-second heartbeats
  - Events: `new_approval`, `approval_resolved`, `session_status_changed`, `conversation_updated`
  - Usage: Real-time monitoring of daemon state changes

## Code References

### Server Implementation

- `hld/daemon/daemon.go:1-281` - Main daemon process and Unix socket server
- `hld/rpc/server.go:1-241` - JSON-RPC 2.0 protocol implementation
- `hld/rpc/types.go:1-112` - Request/response type definitions
- `hld/rpc/types_constants.go:1-87` - Protocol constants and error codes

### Client Libraries

- `hld/client/client.go:1-408` - Go client implementation
- `hlyr/src/daemonClient.ts:1-374` - TypeScript client with retry logic
- `humanlayer-wui/src/lib/daemon/client.ts` - Tauri-based Web UI client

### Event System

- `hld/bus/events.go:1-197` - Event bus implementation
- `hld/bus/types.go:1-55` - Event type definitions

## Architecture Insights

### Protocol Design Decisions

1. **Unix Domain Sockets**: Chosen for security (filesystem permissions) and performance (no network overhead)
2. **JSON-RPC 2.0**: Provides standardized error handling and request correlation
3. **Separate Subscription Connections**: Enables concurrent request/response and event streaming
4. **Line-Delimited JSON**: Allows streaming protocol over persistent connections

### Session State Management

- **SQLite Persistence**: Sessions survive daemon restarts
- **Run ID Correlation**: Links approvals to specific session executions
- **Status Tracking**: `starting`, `running`, `completed`, `failed`, `waiting_input`

### Approval System Architecture

- **Polling-Based**: Client polls for new approvals rather than push notifications
- **Type-Specific Handling**: Different workflows for function calls vs human contacts
- **Decision Correlation**: Uses call_id to match decisions with original requests

### Event Distribution

- **100-Item Buffered Channels**: Prevents blocking on slow consumers
- **Heartbeat Mechanism**: 30-second intervals maintain connection liveness
- **Event Filtering**: Clients can subscribe to specific event types or sessions

## Historical Context (from thoughts/)

### Critical Bug: Session Resume MCP Configuration Loss

From `thoughts/dex/mcp-diagnosis.md`:

- **Problem**: `ContinueSession` doesn't inherit parent session's MCP configuration
- **Impact**: Resumed sessions lose approval functionality
- **Root Cause**: MCP config only applied if explicitly provided in continue request
- **Location**: `hld/session/manager.go` in `ContinueSession` function

### Development Context

From `hld/README.md` and `hld/PROTOCOL.md`:

- Daemon designed as persistent coordinator for Claude Code sessions
- Supports auto-starting via TUI interface
- Comprehensive debugging available with `-debug` flag
- Manual testing possible via netcat and JSON-RPC commands

## Related Research

- See `hld/TESTING.md` for integration testing approaches
- See `hld/TODO.md` for planned enhancements (bulk endpoints, full-text search)
- See `humanlayer-wui/docs/ARCHITECTURE.md` for UI integration patterns

## Open Questions

1. **Session Cleanup**: How are orphaned sessions handled on daemon restart?
2. **Rate Limiting**: Are there limits on request frequency or concurrent sessions?
3. **Error Recovery**: How does the daemon handle corrupted SQLite database?
4. **Scalability**: What are the practical limits on concurrent sessions and subscriptions?
