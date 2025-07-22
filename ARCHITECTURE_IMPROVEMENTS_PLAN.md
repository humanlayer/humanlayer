Architecture Improvements Plan

This document outlines architectural improvements for the HumanLayer local tools suite based on comprehensive code analysis. Items are prioritized by impact and implementation complexity.

## Priority 1: Critical Architectural Issues

### 1. Consolidate Dual Store System in WUI (HIGH PRIORITY) ✅ COMPLETED
**Problem**: The React WUI has two competing stores (`AppStore.ts` and `stores/appStore.ts`) causing confusion and potential state sync issues.
**Solution**:
- ✅ Merged both stores into a single Zustand store at `stores/appStore.ts`
- ✅ Migrated all features from root `AppStore.ts` (bulk selection, range selection, navigation tracking)
- ✅ Updated all components to use the unified store
- ✅ Added comprehensive tests for the unified store
**Impact**: Eliminated state synchronization bugs, reduced complexity, improved maintainability
**Completion Date**: 2025-07-22

### 2. Refactor Session Manager in hld (HIGH PRIORITY) ✅ COMPLETED
**Problem**: The `monitorSession` method in session/manager.go was 266 lines and handled too many responsibilities.
**Solution**:
- ✅ Extracted event processing into `session/event_processor.go` with dedicated methods for each event type
- ✅ Implemented session lifecycle management in `session/lifecycle_manager.go` with clear state transitions
- ✅ Created `session/query_injector.go` for query injection logic
- ✅ Refactored monitorSession to use these components, reducing it to a clean orchestration method
- ✅ Added comprehensive unit tests for all new components
- ✅ Updated integration tests to work with refactored code
**Impact**: Improved testability (all components have >80% coverage), reduced complexity, clearer session lifecycle management
**Completion Date**: 2025-07-22

### 3. Add Context Support to claudecode-go (HIGH PRIORITY) ✅ COMPLETED
**Problem**: The SDK lacked context support for cancellation and timeouts, leading to potential resource leaks.
**Solution**:
- ✅ Added `WaitContext(ctx context.Context) (*Result, error)` method
- ✅ Implemented proper cleanup on context cancellation with process termination
- ✅ Added `Timeout time.Duration` field to SessionConfig
- ✅ Updated all blocking operations to respect context (parsing goroutines are context-aware)
- ✅ Added `LaunchAndWaitContext` method for external context control
- ✅ Maintained backward compatibility with existing `Wait()` method
- ✅ Added comprehensive unit and integration tests
**Impact**: Prevents resource leaks, enables proper timeout handling, improves reliability, maintains backward compatibility
**Completion Date**: 2025-07-22

## Priority 2: Type Safety and Error Handling

### 4. Strengthen Type Safety in hlyr (HIGH PRIORITY) ✅ COMPLETED
**Problem**: JSON-RPC interfaces use `any` and `unknown` types, reducing type safety.
**Solution**:
- ✅ Created comprehensive type definitions in `src/types/rpc.ts` with all RPC request/response types
- ✅ Refactored `daemonClient.ts` to use type-safe method signatures with `RPCMethods` interface
- ✅ Updated `mcp.ts` to use proper types (ToolInput, Approval types)
- ✅ Added runtime validation in `src/types/validation.ts` for critical types
- ✅ Removed all `any` types from the codebase (only one remains with proper typing)
- ✅ All tests passing with improved type safety
**Impact**: Type errors are now caught at compile time, better IDE support, runtime validation prevents invalid data
**Completion Date**: 2025-07-22

### 5. Implement Consistent Error Handling in hld (HIGH PRIORITY) ✅ COMPLETED
**Problem**: Inconsistent error wrapping and missing error types make debugging difficult.
**Solution**:
- ✅ Created domain-specific error types in `errors/` package with sentinel errors and structured types
- ✅ Implemented consistent error wrapping with typed errors (SessionError, ApprovalError, StoreError, ValidationError)
- ✅ Added error codes for RPC responses with proper mapping (-32001 to -32005 for domain errors)
- ✅ Created comprehensive error documentation for API consumers in errors/README.md
- ✅ Updated all packages (rpc, store, session, approval, daemon) to use new error handling
- ✅ Added helper functions for error checking (IsNotFound, IsAlreadyExists, etc.)
- ✅ All tests updated and passing
**Impact**: Consistent error messages, type-safe error checking, better debugging context, clear API documentation
**Completion Date**: 2025-07-22

### 6. Fix Type Safety Issues in WUI (HIGH PRIORITY) ✅ COMPLETED
**Problem**: Several components use `any` types for approvals and events.
**Solution**:
- ✅ Created comprehensive type definitions for all daemon events in `lib/daemon/eventTypes.ts`
- ✅ Typed all approval objects properly using generics and tool type mappings
- ✅ TypeScript strict mode already enabled (confirmed in tsconfig.json)
- ✅ Generated types from Go structs (manual mapping for type safety)
- ✅ Removed all problematic `any` types from the codebase
- ✅ Added type guards and discriminated unions for event handling
- ✅ Updated all stores, hooks, and components to use proper types
**Impact**: Type errors now caught at compile time, better IDE support, runtime validation prevents invalid data
**Completion Date**: 2025-07-22

## Priority 3: Performance and Scalability

### 9. Add List Virtualization to WUI ✅ COMPLETED
**Problem**: Large session lists could cause performance issues.
**Solution**:
- ✅ Implemented react-window for SessionTable virtualization
- ✅ Added pagination support to RPC getSessionLeaves operation
- ✅ Created VirtualizedSessionTable component that renders efficiently
- ✅ Created InfiniteScrollSessionTable with lazy loading
- ✅ Added usePaginatedSessions hook for server-side pagination
- ✅ Integrated three-tier system: regular table (<100), virtualized (100-500), infinite scroll (>500)
**Impact**: Smooth UI performance with thousands of sessions, reduced memory usage, faster initial render
**Completion Date**: 2025-07-22

## Priority 4: Code Organization and Maintainability

### 10. Break Down Large Components in WUI
**Problem**: SessionDetail.tsx is 916 lines, violating single responsibility principle.
**Solution**:
- Extract into: SessionHeader, ConversationView, ResponseInput, LoadingStates
- Create custom hooks for session actions, approvals, clipboard operations
- Move event handling logic to dedicated hooks
- Add component-level error boundaries
**Impact**: Easier to test, maintain, and extend

### 11. Simplify Configuration System in hlyr ✅ COMPLETED
**Problem**: Configuration system is complex with multiple layers and sources.
**Solution**:
- ✅ Implemented singleton ConfigManager pattern to eliminate repeated file reads
- ✅ Added in-memory caching of parsed configurations and resolved values  
- ✅ Simplified the resolution chain with clear precedence: flags > env > config > defaults
- ✅ Added configuration validation at load time with clear error messages
- ✅ Created comprehensive configuration documentation (CONFIG.md)
- ✅ Maintained backward compatibility through config.ts wrapper
- ✅ Added comprehensive unit tests with 100% coverage
**Impact**: Significant performance improvement (no repeated file I/O), easier configuration management, better error messages, maintains backward compatibility
**Completion Date**: 2025-07-22

### 12. Extract Command Registration in hlyr
**Problem**: index.ts is 247 lines with mixed concerns.
**Solution**:
- Create `commands/registry.ts` for command registration
- Move authentication hook logic to separate module
- Create command interface for consistent implementation
- Add command documentation generation
**Impact**: Better code organization, easier to add new commands

## Priority 5: Testing and Observability

### 13. Add Comprehensive Testing Infrastructure
**Problem**: Limited test coverage across all components.
**Solution**:
- Add unit tests for all business logic in hld using testify
- Add React Testing Library tests for WUI components
- Add integration tests for RPC flows
- Add end-to-end tests for critical user journeys
- Set up CI with coverage requirements
**Impact**: Prevents regressions, improves confidence in changes

### 14. Implement Unified Logging in hlyr
**Problem**: Only MCP has dedicated logging, other components use console.log.
**Solution**:
- Implement winston or similar logging library
- Add log levels and structured logging
- Create logging configuration
- Add request ID tracking
- Integrate with daemon logs
**Impact**: Better debugging, production monitoring

### 15. Add Observability to hld
**Problem**: Limited metrics and tracing capabilities.
**Solution**:
- Add OpenTelemetry integration
- Implement health check endpoints with detailed status
- Add performance metrics for RPC calls
- Add distributed tracing for session operations
- Create Grafana dashboards
**Impact**: Better production monitoring, faster issue resolution

## Priority 6: Security and API Design

### 16. Add Authentication to Unix Socket
**Problem**: No authentication on Unix socket beyond file permissions.
**Solution**:
- Implement token-based authentication
- Add rate limiting middleware
- Add audit logging for sensitive operations
- Consider mTLS for network deployments
**Impact**: Better security for multi-user systems

### 17. Improve RPC API Consistency
**Problem**: Inconsistent naming and mixed concerns in some RPC methods.
**Solution**:
- Standardize on camelCase for all RPC methods
- Split methods with mixed concerns
- Add API versioning support
- Create OpenAPI specification
- Add pagination to all list operations
**Impact**: Better API usability, easier client generation

## Implementation Approach

1. Start with Priority 1 items as they have the highest impact
2. Each improvement should include:
   - Comprehensive tests
   - Documentation updates
   - Migration guide if breaking changes
3. Use feature flags for gradual rollout of major changes
4. Create detailed implementation plans in thoughts/shared/plans/
5. Track progress in Linear tickets

## Success Metrics

- Reduced bug reports related to state synchronization
- Improved response times for large session lists
- Reduced memory usage in daemon
- Increased test coverage (target: 80%+)
- Reduced time to debug production issues
- Improved developer satisfaction scores

This plan provides a roadmap for systematic improvement of the HumanLayer architecture while maintaining backward compatibility and system stability.
