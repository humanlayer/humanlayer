# HumanLayer Daemon Implementation Plan

## Overview

Build a Go daemon (`hld`) that acts as a central coordinator between Claude Code sessions and the HumanLayer approval system. The daemon will manage session lifecycle, poll for approvals, correlate approvals with sessions via `run_id`, and expose a JSON-RPC interface over a Unix socket for clients (TUI, CLI, future GUIs).

**Core Value**: Enable persistent Claude Code sessions with rich context about which approvals belong to which sessions, while supporting multiple concurrent clients.

## Architecture

```
┌─────────┐  JSON-RPC   ┌─────────┐   polls    ┌──────────────┐
│   TUI   │◀───────────▶│   hld   │◀──────────▶│ HumanLayer   │
└─────────┘   notify    │ daemon  │             │    API       │
                        └────┬────┘             └──────────────┘
                             │ launches
                        ┌────▼────┐
                        │ Claude  │
                        │ + MCP   │
                        └─────────┘
```

## Package Structure

Create a clean package hierarchy that follows Go best practices:

```
hld/                              # All daemon code under single directory
├── cmd/
│   └── hld/                      # Daemon entry point
│       └── main.go
├── daemon/                       # Core daemon package
│   ├── daemon.go                # Core daemon orchestration
│   ├── daemon_test.go           # Unit tests
│   ├── daemon_integration_test.go # Integration tests
│   └── errors.go                # Custom error types
├── rpc/
│   ├── server.go                # JSON-RPC server implementation
│   └── types.go                 # Request/response types
├── config/
│   └── config.go                # Configuration management
├── session/                     # (Phase 2)
│   ├── manager.go               # Session lifecycle management
│   └── types.go                 # Session-specific types
├── approval/                    # (Phase 3)
│   ├── poller.go                # HumanLayer API polling
│   └── correlator.go            # run_id correlation logic
├── store/                       # (Phase 6)
│   ├── interface.go             # Storage abstraction
│   ├── memory.go                # Initial in-memory implementation
│   └── sqlite.go                # Future SQLite implementation
├── bus/                         # (Phase 5)
│   └── events.go                # Internal event distribution
├── go.mod                       # Module definition
├── Makefile                     # Build and test automation
├── README.md                    # Documentation
└── .gitignore                   # Git ignore rules
```

## Implementation Phases

### Phase 1: Foundation (Socket & RPC) ✅ COMPLETE

**Goal**: Establish daemon that listens on Unix socket and responds to basic RPC calls.

**Key Files to Reference**:

- Use `humanlayer-tui/config.go` as inspiration for configuration loading patterns
- Socket path: `~/.humanlayer/daemon.sock` (permissions: 0600)

**Deliverables**:

- Daemon starts and creates socket
- Basic RPC methods stubbed (ping/health check)
- Graceful shutdown on SIGINT/SIGTERM
- Integration test confirms RPC round-trip

**Success Criteria**:

- ✓ Daemon starts and creates Unix socket at `~/.humanlayer/daemon.sock` with 0600 permissions
- ✓ RPC health check method returns `{"status": "ok", "version": "x.y.z"}`
- ✓ Socket is cleaned up on daemon shutdown (file doesn't exist after SIGTERM)
- ✓ Integration test can connect, call health check, and receive valid response
- ✓ Daemon refuses to start if socket already exists (another instance running)
- ✓ All tests pass with `-race` flag enabled

**Testing Guidance**: Focus on daemon lifecycle - can it start, accept connections, and shut down cleanly? Mock the socket listener for unit tests.

**Implementation Notes (Phase 1 Complete)**:

- All daemon code lives under `hld/` directory with its own go.mod
- Configuration uses viper with environment variable support (prefix: `HUMANLAYER_`)
- Custom error type `ErrDaemonAlreadyRunning` for proper error handling
- Tests use temporary directories for isolation (no external dependencies)
- Integration tests verify actual binary behavior (build tag: `integration`)
- Makefile provides convenient commands for build/test/run operations

### Phase 2: Session Management ✅ COMPLETE

**Goal**: Launch and track Claude Code sessions with proper `run_id` correlation.

**Key Files to Reference**:

- `claudecode-go/client.go`: Use this SDK to launch Claude sessions
- `claudecode-go/types.go`: Understand `SessionConfig`, `MCPServer.Env` for passing environment variables
- `information.md`: See "Session-Approval Correlation" section for run_id strategy

**Implementation Notes**:

- Generate unique `run_id` before launching Claude
- Pass `HUMANLAYER_RUN_ID` environment variable to Claude process via `MCPServer.Env`
- Track sessions in memory (initially) with goroutine per session monitoring lifecycle
- Expose `LaunchSession` and `ListSessions` RPC methods
- Add new RPC handlers in `hld/rpc/handlers.go` (create this file)
- Session manager in `hld/session/manager.go` should handle lifecycle

**Success Criteria**:

- ✓ `LaunchSession` RPC creates new Claude session and returns session ID + run_id
- ✓ Claude process receives `HUMANLAYER_RUN_ID` environment variable (verified via mock)
- ✓ `ListSessions` returns all active sessions with status (running/completed/failed)
- ✓ Session cleanup occurs when Claude process exits (goroutine terminates, memory freed)
- ✓ Can launch 5 concurrent sessions without race conditions
- ✓ In-memory store operations are concurrent-safe (tested with `-race`)
- ✓ Integration test launches real session and verifies it appears in list

**Testing Guidance**: Verify sessions launch with correct environment variables. Test concurrent session management and proper cleanup on session exit.

**Implementation Notes (Phase 2 Complete)**:

- Created `hld/session/` package with `types.go` and `manager.go`
- Session manager tracks Claude sessions with unique IDs and run IDs
- RPC handlers in `hld/rpc/handlers.go` provide LaunchSession and ListSessions methods
- Session lifecycle monitored via goroutines with proper cleanup
- Race conditions fixed by ensuring all session data access is protected by mutexes
- Created `hld/internal/testutil/socket.go` to handle macOS socket path length limits
- Updated `hlyr/src/mcp.ts` to use `HUMANLAYER_RUN_ID` when available
- All tests pass with `-race` flag

### Phase 3: Approval Integration ✅ COMPLETE

**Goal**: Poll HumanLayer API for approvals and correlate them with sessions.

**Key Files to Reference**:

- `humanlayer-go/client.go`: Use `GetPendingFunctionCalls()` and `GetPendingHumanContacts()`
- `humanlayer-go/models.go`: Understand `FunctionCall` and `HumanContact` structures
- Both types have `RunID` field for correlation

**Implementation Notes**:

- Polling worker runs every 5 seconds (configurable)
- Store approvals in memory, indexed by both `call_id` and `run_id`
- Implement `FetchApprovals` RPC method (can filter by session)
- Implement `SendDecision` RPC method using `ApproveFunctionCall`, `DenyFunctionCall`, or `RespondToHumanContact`

**Success Criteria**:

- ✓ Polling worker starts on daemon launch and stops on shutdown
- ✓ Approvals fetched from API are stored and indexed by both `call_id` and `run_id`
- ✓ `FetchApprovals` returns all pending approvals (both function calls and human contacts)
- ✓ `FetchApprovals` with session_id filter returns only approvals for that session
- ✓ `SendDecision` successfully calls appropriate API method and updates local state
- ✓ Approvals without run_id are handled gracefully (shown as "unassociated")
- ✓ Polling continues after API errors (with backoff)
- ✓ Mock API test verifies 100 approvals can be processed without memory leaks

**Testing Guidance**: Mock the HumanLayer client for predictable testing. Verify correlation logic handles approvals with and without run_ids correctly.

**Implementation Notes (Phase 3 Complete)**:

- Created `hld/approval/` package with clean architecture:
  - `types.go` - All interfaces (Manager, Store, APIClient) following session package pattern
  - `poller.go` - Polls API with exponential backoff (2x factor, max 5 minutes)
  - `correlator.go` - Thread-safe in-memory store with dual indexing
  - `manager.go` - Coordinates polling and API interactions
- RPC handlers in `hld/rpc/approval_handlers.go` provide:
  - `FetchApprovals` - Returns pending approvals with optional session filter
  - `SendDecision` - Handles approve/deny/respond with proper validation
- Integrated with daemon lifecycle - poller starts/stops with daemon
- Mock generation using `mockgen` for all interfaces (added to Makefile)
- Comprehensive test coverage:
  - Unit tests for store (concurrent access, filtering, marking responded)
  - Unit tests for poller (backoff logic, error handling) using generated mocks
  - Integration test verifying end-to-end approval flow with simulated backend
- Configuration supports API key and base URL from environment/config
- All tests pass with `-race` flag enabled

### Phase 4: TUI Migration

**Goal**: Update TUI to use daemon instead of direct API calls.

**Key Files to Reference**:

- `humanlayer-tui/tui.go`: Current implementation to refactor
- Remove direct `humanlayer.Client` usage
- Replace with RPC client calls

**Implementation Notes**:

- Create simple RPC client helper in TUI package
- Replace `fetchRequests()` to call daemon's `FetchApprovals`
- Update `sendApproval()` and `sendHumanResponse()` to use daemon
- Maintain same user experience

**Success Criteria**:

- ✓ TUI no longer imports or uses `humanlayer.Client` directly
- ✓ TUI connects to daemon via Unix socket at startup
- ✓ TUI displays helpful error if daemon is not running
- ✓ All approval types (function calls and human contacts) display correctly
- ✓ Approval/deny/respond actions complete successfully through daemon
- ✓ TUI can reconnect if daemon restarts (connection retry logic)
- ✓ End-to-end test: Launch daemon → Launch TUI → Approve mock request → Verify API called

**Testing Guidance**: Manual testing is acceptable here given TUI nature. Ensure all approval flows work end-to-end through daemon.

**Implementation Notes (Phase 4 Complete)**:

- Created `hld/client` package with interface-based RPC client
- Client package includes full test coverage with mock server
- Refactored TUI to use daemon client instead of direct HumanLayer API
- TUI config simplified to only need daemon socket path (no API keys)
- Added auto-start capability: `hlyr` launches daemon if not running
- Build process updated to include both `hld` and `humanlayer-tui` binaries
- Added `npx humanlayer launch` command for testing sessions
- Approvals enabled by default (use `--no-approvals` to disable)
- Added debug logging support (`-debug` flag or `HUMANLAYER_DEBUG=true`)
- Fixed critical bug: set `permission_prompt_tool` for MCP approvals
- Created comprehensive testing documentation in `hld/TESTING.md`
- All communication now flows through Unix socket at `~/.humanlayer/daemon.sock`

### Phase 5: Real-time Updates ✅ COMPLETE

**Goal**: Push approval updates to connected clients for responsive UI.

**Implementation Notes**:

- Add subscription mechanism to RPC (consider long-polling initially)
- When poller finds new approvals, notify subscribed clients
- TUI subscribes on connect and updates view on notifications

**Success Criteria**:

- ✓ `Subscribe` RPC method allows clients to register for updates
- ✓ New approvals trigger notifications to all subscribed clients within 1 second
- ✓ Session status changes (completed/failed) trigger notifications
- ✓ Slow/disconnected clients don't block other clients (non-blocking sends)
- ✓ TUI updates display immediately when notifications arrive (no manual refresh needed)
- ✓ 10 concurrent clients can subscribe and receive updates without degradation
- ✓ Memory usage remains stable with clients connecting/disconnecting repeatedly

**Testing Guidance**: Test that updates propagate within 1 second. Verify multiple clients receive notifications correctly.

**Implementation Notes (Phase 5 Complete)**:

- Created `hld/bus/` package with comprehensive event bus system:
  - `types.go` - Interfaces and types (EventBus, Event, EventFilter, Subscriber)
  - `events.go` - Concrete implementation with thread-safe pub/sub
  - Event types: EventNewApproval, EventApprovalResolved, EventSessionStatusChanged
  - Non-blocking publish with channel buffering (100 events per subscriber)
  - Automatic cleanup when subscriber contexts are canceled
- Implemented subscription RPC in `hld/rpc/subscription_handlers.go`:
  - Long-polling approach with separate connection per subscription
  - Connection monitoring for immediate disconnect detection
  - Heartbeat messages every 30 seconds to keep connections alive
  - Event filtering by type, session ID, and run ID
  - Validation to prevent sending events with empty types
- Enhanced client with Subscribe method in `hld/client/client.go`:
  - Creates dedicated connection for each subscription
  - Synchronous confirmation before returning (5 second timeout)
  - Filters out heartbeats and invalid messages
  - Fixed JSON-RPC ID handling (interface{} instead of int64) for notifications
- Integrated event publishing throughout the system:
  - Approval manager/poller publishes EventNewApproval and EventApprovalResolved
  - Session manager publishes EventSessionStatusChanged with old/new status
  - All managers accept EventBus interface during initialization
- Updated TUI (`humanlayer-tui/tui.go`) to use subscriptions:
  - Subscribes to EventNewApproval and EventApprovalResolved on startup
  - Automatically refreshes display when events arrive
  - Graceful handling if subscription fails (falls back to manual refresh)
- Comprehensive test coverage:
  - Event bus unit tests with race detection
  - Integration tests for concurrent subscribers and filtering
  - Memory stability test with 100 connect/disconnect cycles
  - Fixed subscriber ID generation to use crypto/rand for uniqueness
- All tests pass with `-race` flag enabled

### Phase 6: Persistence (Future)

**Goal**: Replace in-memory storage with SQLite for daemon restart resilience.

**Key Files to Reference**:

- Database location: `~/.humanlayer/daemon.db` (per `information.md`)

**Implementation Notes**:

- Keep storage interface from Phase 1 to make this a clean swap
- Store sessions, approvals, and potentially Claude output events
- Consider schema versioning from the start

**Success Criteria**:

- ✓ SQLite store implements same interface as memory store (zero changes to daemon logic)
- ✓ Database created at `~/.humanlayer/daemon.db` with proper schema
- ✓ Sessions persist across daemon restarts
- ✓ Approvals persist across daemon restarts with correct session associations
- ✓ Migration from empty database works correctly
- ✓ Concurrent daemon operations don't cause SQLite "database is locked" errors
- ✓ Performance: Can handle 1000 approvals with <100ms query time
- ✓ Integration test: Stop daemon → Restart daemon → Verify state restored

## Key Integration Points

### Session-Approval Correlation

The critical integration flow (from `information.md`):

1. Daemon generates `run_id` before launching Claude
2. Pass via `HUMANLAYER_RUN_ID` environment variable
3. MCP server (`hlyr/src/mcp.ts`) reads this variable
4. HumanLayer SDK includes `run_id` in approval requests
5. Daemon correlates approvals back to sessions using this ID

### Configuration

Follow patterns from `humanlayer-tui/config.go`:

- Support environment variables with `HUMANLAYER_` prefix
- Config file at `~/.config/humanlayer/daemon.json` (optional)
- Required: API key for HumanLayer client

## Testing Philosophy

Rather than prescriptive rules, follow these principles:

1. **Test behavior, not implementation**: Focus on what the daemon does, not how
2. **Use interfaces for testability**: Storage, API clients, and RPC handlers should be mockable
3. **Race detection is your friend**: Run tests with `-race` flag regularly
4. **Integration tests prove the system works**: Each phase should have at least one integration test
5. **Manual testing for UI is fine**: TUIs are hard to test automatically; document test scenarios instead

## Development Guidelines

### Concurrency

- Every goroutine should accept a `context.Context` for cancellation
- Use channels for communication between components
- Protect shared state with appropriate synchronization

### Error Handling

- Wrap errors with context (consider `fmt.Errorf` with `%w`)
- Log errors at appropriate levels (Error, Warn, Info, Debug)
- Never panic in production code paths

### Code Organization

- Keep functions small and focused
- Interfaces belong in the package that uses them, not the one that implements them
- Avoid global state; pass dependencies explicitly

## Success Metrics

The daemon is successful when:

1. Multiple Claude sessions can run concurrently with proper isolation
2. Approvals appear in the TUI with clear session context
3. Clients can connect/disconnect without affecting running sessions
4. The system gracefully handles daemon restarts (future: with SQLite)
5. Developers find the codebase easy to understand and extend

## Next Steps

1. Set up package structure and basic daemon skeleton
2. Implement Phase 1 with basic RPC infrastructure
3. Add CI pipeline with linting, testing, and race detection
4. Iterate through phases, ensuring each is complete before moving on

Remember: This plan provides direction and principles. Use your judgment on specific implementation details, keeping the code clean, testable, and idiomatic Go throughout.
