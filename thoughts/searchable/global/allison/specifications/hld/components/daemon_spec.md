---
component_name: Daemon
component_type: service
location: hld/daemon/
analyzed_date: 2025-06-26
dependencies: [rpc.Server, session.Manager, approval.Manager, bus.EventBus, store.Store, config.Config]
dependents: [cmd/hld/main.go]
test_coverage: 75
---

# Daemon Component Specification

## Overview

**Purpose**: Core daemon process that coordinates all HLD components and manages lifecycle
**Responsibility**: Initialize components, manage Unix socket, handle graceful shutdown
**Location**: `hld/daemon/daemon.go`

## Public API

### Exported Types

#### `Daemon`

**Purpose**: Main daemon struct that orchestrates all components

**Constructor**:
```go
func New(config *config.Config) (*Daemon, error)
```

**Methods**:

##### `Run(ctx context.Context) error`
- **Purpose**: Start the daemon and run until context is cancelled
- **Access**: public
- **Parameters**: 
  - `ctx` (context.Context): Context for cancellation
- **Returns**: error if startup fails or runtime error occurs
- **File Reference**: `hld/daemon/daemon.go:103`

##### `Shutdown(ctx context.Context) error`
- **Purpose**: Gracefully shutdown all components
- **Access**: public
- **Parameters**:
  - `ctx` (context.Context): Context with timeout for shutdown
- **Returns**: error if shutdown fails
- **File Reference**: `hld/daemon/daemon.go:252`

**Properties**:
- `config` (*config.Config): Daemon configuration
- `logger` (*slog.Logger): Structured logger
- `rpcServer` (*rpc.Server): JSON-RPC server
- `sessionManager` (*session.Manager): Session management
- `approvalManager` (*approval.Manager): Approval handling
- `eventBus` (*bus.EventBus): Event distribution
- `store` (store.Store): Data persistence

## Internal Implementation

### Private Functions

#### `ensureSocketDirectory() error`
- **Purpose**: Create socket directory with proper permissions
- **Used by**: Run() during startup
- **Algorithm**: Creates directory with 0700 permissions if not exists

#### `removeStaleSocket() error`
- **Purpose**: Remove existing socket file if daemon not running
- **Used by**: Run() during startup
- **Algorithm**: Checks if socket exists and removes if stale

#### `startComponents(ctx context.Context) error`
- **Purpose**: Initialize and start all daemon components
- **Used by**: Run() after socket setup
- **Algorithm**: Sequential component initialization with error handling

### Design Patterns

- **Pattern Used**: Coordinator/Orchestrator
- **Rationale**: Central management of component lifecycle
- **Implementation Details**: Daemon owns and coordinates all major components

## Dependencies

### External Dependencies
- `golang.org/x/sys/unix`: Unix system calls for socket management
- `log/slog`: Structured logging

### Internal Dependencies
- `../config`: Configuration management
- `../rpc`: JSON-RPC server
- `../session`: Session management
- `../approval`: Approval management  
- `../bus`: Event bus
- `../store`: Data persistence
- `../client`: HumanLayer API client

## State Management

### Component State
- **State Variables**: 
  - Running status
  - Component references
  - Socket listener
- **State Mutations**: Only during startup/shutdown
- **State Persistence**: No direct persistence

## Error Handling

### Error Types
- `ErrDaemonAlreadyRunning`: Socket already exists
- Socket creation errors
- Component initialization errors
- Shutdown timeout errors

### Error Responses
- Startup errors prevent daemon from running
- Runtime errors logged but daemon continues
- Shutdown errors logged but shutdown proceeds

## Configuration

### Required Configuration
- `socket_path`: Unix socket path (cannot be empty)

### Optional Configuration
- `database_path`: SQLite database path
- `api_key`: HumanLayer API key
- `api_base_url`: API base URL
- `log_level`: Logging level

## Performance Characteristics

- **Startup Time**: < 100ms typical
- **Memory Usage**: ~50MB base
- **Shutdown Time**: < 5s with timeout
- **Resource Cleanup**: Automatic on shutdown

## Testing

### Test Coverage
- Unit Tests: 75% coverage
- Integration Tests: Separate test files

### Key Test Scenarios
1. Clean startup and shutdown
2. Stale socket removal
3. Component initialization failures
4. Graceful shutdown with timeout
5. Concurrent operation handling

### Test File Location
- Unit tests: `hld/daemon/daemon_test.go`
- Integration tests: `hld/daemon/daemon_*_integration_test.go`

## Security Considerations

- **Socket Permissions**: 0600 (owner only)
- **Directory Permissions**: 0700 for socket directory
- **Access Control**: Unix file system based
- **API Keys**: Stored in config, not exposed

## Future Considerations

- **Scalability**: Single daemon per system currently
- **Deprecations**: None planned
- **TODOs**: 
  - Add health check endpoint
  - Implement component health monitoring
  - Add metrics collection

## Code Examples

### Basic Usage
```go
// Create and run daemon
config := &config.Config{
    SocketPath: "~/.humanlayer/daemon.sock",
    DatabasePath: "~/.humanlayer/daemon.db",
}

daemon, err := daemon.New(config)
if err != nil {
    return err
}

ctx := context.Background()
if err := daemon.Run(ctx); err != nil {
    return err
}
```

### Graceful Shutdown
```go
// Handle shutdown signals
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

go func() {
    <-sigChan
    shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer shutdownCancel()
    
    if err := daemon.Shutdown(shutdownCtx); err != nil {
        log.Error("Shutdown error", "error", err)
    }
    cancel()
}()

daemon.Run(ctx)
```

## Related Documentation

- Architecture: [`../../architecture/system_design.md`](../../architecture/system_design.md)
- RPC Server: [`../rpc_server_spec.md`](../rpc_server_spec.md)
- Configuration: [`../../configuration/env_vars.md`](../../configuration/env_vars.md)