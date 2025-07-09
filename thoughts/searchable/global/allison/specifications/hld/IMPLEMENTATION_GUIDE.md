---
project_name: hld
document_type: implementation_guide
created_date: 2025-06-26
completeness: 95
---

# HLD Implementation Guide - Building from Specifications

## Overview

This guide shows how to implement the HumanLayer Daemon (hld) from scratch using the specifications in this directory. The specifications are language-agnostic and provide enough detail to recreate the system in any programming language.

## Specification Documents Created

### 1. Core Documentation
- **00_overview.md** - Project overview and architecture (START HERE)
- **IMPLEMENTATION_GUIDE.md** - This document

### 2. Component Specifications
Located in `components/`:
- **daemon_spec.md** - Main daemon process that orchestrates everything
- **session_manager_spec.md** - Claude Code session lifecycle management
- **approval_manager_spec.md** - Human-in-the-loop approval workflows
- **event_bus_spec.md** - Pub/sub event distribution system
- **store_spec.md** - SQLite data persistence layer

### 3. Interface Specifications
Located in `interfaces/`:
- **json_rpc_api.md** - Complete API method documentation
- **rpc_protocol.md** - Detailed protocol specification (message format, timing)
- **client_implementation_guide.md** - How to build a client in any language

### 4. Data Specifications
Located in `data_models/`:
- **schemas.sql** - Complete SQLite database schema
- **entities.md** - Entity relationships and data models
- **database_operations.md** - Every SQL query used in the system

### 5. Workflow Specifications
Located in `workflows/`:
- **approval_correlation_algorithm.md** - Exact algorithm for matching approvals
- **session_state_machine.md** - All state transitions and rules
- **sequence_diagrams.md** - Message flows for all operations

### 6. Testing Specifications
Located in `testing/`:
- **strategy.md** - Testing patterns and approaches

## Implementation Order

### Phase 1: Foundation (Week 1)
1. **Database Layer** (`data_models/schemas.sql`, `store_spec.md`)
   - Create SQLite database with schema
   - Implement Store interface with all operations
   - Add connection pooling and error handling

2. **Event Bus** (`components/event_bus_spec.md`)
   - Implement pub/sub with filtering
   - Add buffered channels
   - Test concurrent access

3. **Core Types** (`data_models/entities.md`)
   - Define all data structures
   - Implement serialization/deserialization
   - Add validation

### Phase 2: Core Components (Week 2)
4. **Session Manager** (`components/session_manager_spec.md`)
   - Implement state machine (`workflows/session_state_machine.md`)
   - Add Claude process management
   - Handle parent-child relationships

5. **Approval Manager** (`components/approval_manager_spec.md`)
   - Implement correlation algorithm (`workflows/approval_correlation_algorithm.md`)
   - Add polling with backoff
   - Handle external API communication

6. **RPC Server** (`interfaces/rpc_protocol.md`)
   - Implement JSON-RPC 2.0 handler
   - Add Unix socket listener
   - Implement all API methods

### Phase 3: Integration (Week 3)
7. **Daemon** (`components/daemon_spec.md`)
   - Wire all components together
   - Add lifecycle management
   - Implement graceful shutdown

8. **Client Library** (`interfaces/client_implementation_guide.md`)
   - Build reference client
   - Add connection management
   - Implement subscription handling

9. **Testing** (`testing/strategy.md`)
   - Unit tests for each component
   - Integration tests for workflows
   - End-to-end scenarios

## Key Implementation Details

### 1. Constants You'll Need
```
# Timing
POLL_INTERVAL = 5000ms
HEARTBEAT_INTERVAL = 30000ms
MAX_BACKOFF = 300000ms (5 min)
BACKOFF_FACTOR = 2.0

# Limits
MAX_MESSAGE_SIZE = 1048576 (1MB)
EVENT_BUFFER_SIZE = 100
SOCKET_PERMISSIONS = 0600

# Versions
DAEMON_VERSION = "0.1.0"
JSONRPC_VERSION = "2.0"
```

### 2. Critical Algorithms
- **Approval Correlation**: See `workflows/approval_correlation_algorithm.md`
- **State Transitions**: See `workflows/session_state_machine.md`
- **Message Protocol**: See `interfaces/rpc_protocol.md`

### 3. Database Queries
- All queries documented in `data_models/database_operations.md`
- Use parameterized queries to prevent SQL injection
- Enable foreign keys and WAL mode

### 4. Error Codes
```
-32700: Parse error
-32600: Invalid request
-32601: Method not found
-32602: Invalid params
-32603: Internal error
```

## Testing Your Implementation

### 1. Unit Test Each Component
- Test state transitions
- Test error cases
- Test concurrent access

### 2. Integration Test Workflows
- Launch session → Get events → Complete
- Approval flow → Decision → State change
- Subscription → Events → Disconnect

### 3. Protocol Compliance
- Test with reference client
- Validate JSON-RPC compliance
- Check message size limits

## Validation Checklist

### Core Functionality
- [ ] Can launch Claude Code sessions
- [ ] Can track session state changes
- [ ] Can handle approval workflows
- [ ] Can deliver events to subscribers
- [ ] Can persist and retrieve conversations

### Protocol Compliance
- [ ] Accepts JSON-RPC 2.0 requests
- [ ] Returns properly formatted responses
- [ ] Handles errors with correct codes
- [ ] Supports long-polling subscriptions
- [ ] Sends heartbeats every 30 seconds

### Data Integrity
- [ ] Foreign key constraints enforced
- [ ] Session states properly transitioned
- [ ] Approvals correctly correlated
- [ ] Parent sessions properly linked
- [ ] No orphaned records

### Security
- [ ] Unix socket permissions 0600
- [ ] Input validation on all methods
- [ ] SQL injection prevention
- [ ] Resource limits enforced

## Common Pitfalls

1. **Race Conditions**: Use proper locking for state transitions
2. **Memory Leaks**: Clean up subscriptions on disconnect
3. **Deadlocks**: Avoid circular waits in event handling
4. **Resource Exhaustion**: Limit concurrent connections
5. **SQL Injection**: Always use parameterized queries

## Support Resources

1. **Sequence Diagrams**: Visual flows in `workflows/sequence_diagrams.md`
2. **API Examples**: Request/response examples in `interfaces/json_rpc_api.md`
3. **Client Examples**: Implementation patterns in `interfaces/client_implementation_guide.md`

## Success Criteria

Your implementation is complete when:
1. All unit tests pass
2. Integration tests complete successfully
3. Can interoperate with existing HLD clients
4. Handles errors gracefully
5. Performs within expected parameters

Remember: These specifications are detailed enough that you should not need to reference the original Go implementation. Everything needed to build a compatible system is documented here.