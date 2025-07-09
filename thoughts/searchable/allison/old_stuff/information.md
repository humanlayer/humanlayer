# HumanLayer Daemon Architecture Decisions

This document captures the architectural decisions and design choices made for the HumanLayer daemon system, which enables tight integration between Claude Code SDK and the HumanLayer approval system.

## Problem Statement

The current HumanLayer TUI (located in `humanlayer-tui/`) fetches approvals from the HumanLayer API but lacks context about which Claude Code session generated each approval request. Additionally, launching and managing multiple concurrent Claude Code sessions requires keeping the TUI open, which limits workflow flexibility.

## Core Architecture Decision: Daemon-Based Approach

After evaluating several options, we chose a daemon-based architecture for the following reasons:

1. **Session Persistence**: Claude Code sessions continue running even if the TUI is closed
2. **Multi-Client Support**: Multiple TUIs and CLI commands can connect to the same daemon
3. **Session-Approval Correlation**: The daemon can track which approvals belong to which Claude sessions
4. **Future Extensibility**: Provides a foundation for local-only approval modes and multi-agent orchestration

This follows established patterns from tools like Docker (daemon + CLI + multiple clients) and tmux (persistent sessions with multiple attachments).

## Technical Stack Decisions

### Language Choice: Go

- **Rationale**: Consistency with existing `humanlayer-tui/` codebase, performance requirements, and excellent concurrency support
- **Existing Foundation**: The `claudecode-go/` SDK already provides session launching, streaming JSON parsing, and MCP configuration
- **Scope**: Both daemon and CLI will be implemented in Go (not TypeScript like `hlyr/`)

### Storage: SQLite

- **Location**: `~/.humanlayer/daemon.db`
- **Rationale**: Structured queries for session/approval correlation, ACID compliance for concurrent access, single-file portability
- **Use Cases**: Store session metadata, approval states, Claude streaming output events

### Communication: Unix Socket with JSON-RPC

- **Socket Path**: `~/.humanlayer/daemon.sock`
- **Protocol**: JSON-RPC 2.0 over Unix socket
- **Rationale**: Simple, debuggable, well-understood protocol; Unix sockets provide secure local IPC with automatic client isolation

## Integration Strategy

### Session-Approval Correlation

1. **Run ID Control**: Daemon generates a `run_id` before launching Claude Code
2. **Environment Variable Bridge**: Pass `HUMANLAYER_RUN_ID` to Claude process
3. **MCP Server Integration**: The MCP server in `hlyr/src/mcp.ts` reads this environment variable
4. **API Correlation**: HumanLayer approvals are created with this `run_id`, enabling correlation

This approach requires no changes to the HumanLayer API backend, working within existing constraints.

### Approval Management

The daemon will handle approval synchronization (Option B from our analysis):

- Poll HumanLayer API for pending approvals
- Match approvals to sessions using `run_id`
- Provide unified interface for TUI to query approvals with session context
- Handle approval responses and sync back to API

## Data Flow

1. **Session Launch**: CLI/TUI → Daemon → claudecode-go SDK → Claude Code (with HUMANLAYER_RUN_ID)
2. **Streaming Events**: Claude → claudecode-go SDK → Daemon (for storage and correlation)
3. **Approval Request**: Claude → MCP Server → HumanLayer API
4. **Approval Fetch**: Daemon ← HumanLayer API (polling)
5. **Approval Display**: TUI ← Daemon (with session context)
6. **Approval Response**: TUI → Daemon → HumanLayer API

## Key Design Principles

### Separation of Concerns

- **Daemon**: Session lifecycle, approval polling, state management
- **TUI**: Pure presentation layer, no direct API calls
- **CLI**: Thin client for session operations
- **MCP Server**: Unchanged, continues to use HumanLayer SDK

### Incremental Development

Start with core daemon functionality and gradually add features:

1. Basic session launching and tracking
2. Approval polling and correlation
3. Rich session context (streaming output, tool usage)
4. Future: Local-only approval mode

### Compatibility

- Works with existing HumanLayer API without modifications
- Compatible with current MCP server implementation
- TUI migration can be incremental

## Configuration and State

### Persistent State

- Session metadata and status in SQLite
- Claude streaming output stored for debugging and context
- Approval history with correlation to sessions

### Runtime State

- Active session processes tracked by daemon
- Real-time approval queue updates
- Client connections managed per-socket

## Future Considerations

This architecture enables several future enhancements:

- **Local-Only Mode**: MCP server could talk directly to daemon, bypassing API
- **Multi-Agent Orchestration**: Daemon could manage agent interactions
- **Rich Context**: Tool-specific viewers leveraging stored session data
- **Session Resume**: Reconnect to existing Claude sessions after daemon restart

## Related Documentation

- Existing TUI implementation: `humanlayer-tui/`
- Claude Code Go SDK (foundation for daemon): `claudecode-go/`
- MCP server that will read environment variables: `hlyr/src/mcp.ts`
- Current approval flow: `humanlayer-ts/src/approval.ts`
- Go SDK for HumanLayer API: `humanlayer-go/`
- Architecture thoughts: `thoughts/notes.md` and `thoughts/quick_approval.md`
