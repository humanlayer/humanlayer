---
project_name: hld
analyzed_date: 2025-06-26
analyzer: allison
source_commit: 1a2058582344f2e9400591615ad447148b305d02
specification_version: 1.0.0
completeness: 95
status: complete
---

# HumanLayer Daemon (hld) - Complete Specification Overview

## Executive Summary

The HumanLayer Daemon (hld) is a Go-based daemon that manages Claude Code sessions and provides human-in-the-loop approval workflows. It acts as a coordination layer between the HumanLayer CLI tools (hlyr), Terminal UI (TUI), Web UI (WUI), and the HumanLayer Cloud API. The daemon provides a JSON-RPC 2.0 API over Unix domain sockets for local-only access, manages session state in SQLite, and handles approval polling and event distribution.

## Project Metadata

- **Repository Path**: /Users/allison/humanlayer/humanlayer/hld
- **Primary Language**: Go 1.24.0
- **Total Files**: 51 (Go source files)
- **Total Lines of Code**: ~8,000 (estimated)
- **Last Analysis Update**: 2025-06-26

## Technology Stack

### Core Technologies
- **Language**: Go 1.24.0
- **Runtime**: Go runtime with CGO enabled
- **Framework**: Standard library + minimal dependencies

### Build Tools
- **Make**: Build automation and task running
- **golangci-lint**: Code quality and linting
- **mockgen**: Mock generation for testing
- **go test**: Testing framework

### Dependencies Summary
- Production Dependencies: 7
- Development Dependencies: 3
- Total External APIs: 1 (HumanLayer Cloud API)

## Architecture Overview

### High-Level Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                   Unix Domain Socket                          │
│                 (~/.humanlayer/daemon.sock)                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      RPC Server Layer                         │
│                    (JSON-RPC 2.0 Protocol)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Daemon Core                             │
│                    (Coordination Layer)                       │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Session Manager │  │ Approval Manager│  │    Event Bus    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SQLite Store Layer                         │
│                  (~/.humanlayer/daemon.db)                    │
└─────────────────────────────────────────────────────────────┘
```

### Key Components
1. **Main Entry Point**
   - Purpose: Initialize and run the daemon process
   - Location: `cmd/hld/main.go`
   - Dependencies: daemon, config, slog

2. **Daemon Core**
   - Purpose: Coordinate all components and manage lifecycle
   - Location: `daemon/daemon.go`
   - Dependencies: rpc, session, approval, bus, store

3. **RPC Server**
   - Purpose: Handle JSON-RPC 2.0 requests over Unix socket
   - Location: `rpc/`
   - Dependencies: session manager, approval manager

4. **Session Manager**
   - Purpose: Manage Claude Code session lifecycle
   - Location: `session/`
   - Dependencies: store, bus, client

5. **Approval Manager**
   - Purpose: Poll and manage human-in-the-loop approvals
   - Location: `approval/`
   - Dependencies: client, bus

6. **Event Bus**
   - Purpose: Distribute events to subscribers
   - Location: `bus/`
   - Dependencies: none (standalone)

7. **Store Layer**
   - Purpose: Persist data in SQLite database
   - Location: `store/`
   - Dependencies: sqlite3 driver

### Entry Points
- `cmd/hld/main.go`: Main daemon executable entry point

## Directory Structure

```
hld/
├── approval/               # Approval management system
│   ├── correlator.go      # Correlates approvals with sessions
│   ├── manager.go         # Main approval manager
│   ├── poller.go          # Polls HumanLayer API
│   └── types.go           # Approval type definitions
├── bus/                   # Event bus implementation
│   ├── events.go          # Event bus implementation
│   └── types.go           # Event type definitions
├── client/                # HumanLayer API client
│   ├── client.go          # API client implementation
│   └── types.go           # API types
├── cmd/
│   └── hld/              
│       └── main.go        # Main entry point
├── config/                # Configuration management
│   └── config.go          # Config struct and loading
├── daemon/                # Core daemon implementation
│   ├── daemon.go          # Main daemon logic
│   └── errors.go          # Error definitions
├── internal/
│   └── testutil/          # Test utilities
│       └── socket.go      # Socket test helpers
├── rpc/                   # JSON-RPC server
│   ├── approval_handlers.go    # Approval-related handlers
│   ├── handlers.go            # Core RPC handlers
│   ├── server.go              # RPC server implementation
│   ├── subscription_handlers.go # Event subscription handlers
│   ├── types.go               # RPC types
│   └── types_constants.go     # RPC constants
├── session/               # Session management
│   ├── manager.go         # Session manager
│   ├── summary.go         # Session summarization
│   └── types.go           # Session types
├── store/                 # Data persistence layer
│   ├── sqlite.go          # SQLite implementation
│   └── store.go           # Store interface
├── go.mod                 # Go module definition
├── go.sum                 # Dependency checksums
├── Makefile              # Build automation
├── PROTOCOL.md           # Protocol documentation
├── README.md             # Project README
├── TESTING.md            # Testing documentation
└── TODO.md               # Development TODOs
```

## Specification Document Index

### Component Specifications
- [`components/daemon_spec.md`](components/daemon_spec.md) - Daemon core details ✓
- [`components/session_manager_spec.md`](components/session_manager_spec.md) - Session management system ✓
- [`components/approval_manager_spec.md`](components/approval_manager_spec.md) - Approval system ✓
- [`components/event_bus_spec.md`](components/event_bus_spec.md) - Event distribution system ✓
- [`components/store_spec.md`](components/store_spec.md) - Data persistence layer ✓

### Interface Documentation
- [`interfaces/json_rpc_api.md`](interfaces/json_rpc_api.md) - Complete JSON-RPC API documentation ✓
- [`interfaces/rpc_protocol.md`](interfaces/rpc_protocol.md) - Detailed RPC protocol specification ✓
- [`interfaces/client_implementation_guide.md`](interfaces/client_implementation_guide.md) - Client implementation in any language ✓

### Data Specifications
- [`data_models/schemas.sql`](data_models/schemas.sql) - SQLite database schemas ✓
- [`data_models/entities.md`](data_models/entities.md) - Entity relationships ✓
- [`data_models/database_operations.md`](data_models/database_operations.md) - All SQL queries and operations ✓

### Workflow Documentation
- [`workflows/approval_correlation_algorithm.md`](workflows/approval_correlation_algorithm.md) - Detailed correlation logic ✓
- [`workflows/session_state_machine.md`](workflows/session_state_machine.md) - Complete state transitions ✓
- [`workflows/sequence_diagrams.md`](workflows/sequence_diagrams.md) - All system workflows ✓

### Testing
- [`testing/strategy.md`](testing/strategy.md) - Testing approach and patterns ✓

### Configuration
- Configuration details integrated throughout component specifications

## Analysis Progress

### Completed (95%)
- [x] Directory structure mapping
- [x] Technology stack identification
- [x] Entry point analysis
- [x] Component identification
- [x] Configuration analysis
- [x] API documentation
- [x] Interface documentation
- [x] Component specifications
- [x] Data model extraction
- [x] Workflow documentation
- [x] Testing strategy documentation
- [x] External dependencies analysis
- [x] Database schema extraction
- [x] State management patterns
- [x] Error handling patterns
- [x] Security measures analysis
- [x] Protocol specifications
- [x] Client implementation guide
- [x] Sequence diagrams
- [x] Algorithm documentation
- [x] SQL query documentation

### Not Included (5%)
- [ ] Performance benchmarking data
- [ ] Visual architecture diagrams
- [ ] Installation scripts
- [ ] Migration guides
- [ ] Deployment configurations

## Quick Start Guide

To recreate this project from specifications:

1. Set up the development environment using [`configuration/setup.md`](configuration/setup.md)
2. Implement core types from [`data_models/entities.md`](data_models/entities.md)
3. Build RPC server following [`interfaces/json_rpc_api.md`](interfaces/json_rpc_api.md)
4. Implement managers per [`components/`](components/) specifications
5. Configure using [`configuration/env_vars.md`](configuration/env_vars.md)
6. Run tests as described in [`testing/strategy.md`](testing/strategy.md)

## Open Questions

1. How does the daemon handle MCP server lifecycle management?
2. What are the exact retry strategies for API polling?
3. How are orphaned sessions cleaned up?
4. What are the performance limits for concurrent sessions?

## Key Findings

### Architecture Strengths
1. **Clean separation of concerns** with interface-based design
2. **Event-driven architecture** enables loose coupling
3. **Comprehensive testing** with mocks and integration tests
4. **Security through simplicity** - Unix socket with file permissions

### Notable Design Patterns
1. **Repository Pattern** for data access
2. **Observer Pattern** for event distribution
3. **Strategy Pattern** for pluggable components
4. **Coordinator Pattern** for daemon lifecycle

### Security Considerations
1. **Local-only access** via Unix domain sockets
2. **File system permissions** (0600) for access control
3. **No encryption at rest** - relies on OS security
4. **API key storage** in plaintext configuration

### Performance Characteristics
1. **Polling-based** approval system (5s default interval)
2. **SQLite with WAL mode** for concurrent access
3. **In-memory event bus** with buffered channels
4. **No explicit rate limiting** or throttling

## Recommendations for Implementation

1. **Add performance metrics** collection and monitoring
2. **Implement encrypted storage** for sensitive data
3. **Add webhook support** to replace polling for approvals
4. **Create setup automation** scripts for easier deployment
5. **Add health check endpoints** with detailed status

This specification provides a comprehensive foundation for understanding, maintaining, or reimplementing the HumanLayer Daemon. The modular architecture and clear interfaces make it suitable for extension and modification.