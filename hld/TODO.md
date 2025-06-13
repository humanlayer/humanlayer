# HumanLayer Daemon (HLD) - TODO

## Bugs

## Features (Planned)

### Conversation History Bulk Endpoint

**Goal**: Reduce N+1 problem for TUI message count display
**Current issue**: TUI needs separate `GetConversation` call per session to count messages
**Proposed solution**: Add bulk endpoint that returns conversation metadata (message count, last message, etc.) for multiple sessions
**Alternative**: Extend `ListSessions` to include conversation metadata
**Performance impact**: Would significantly improve TUI session list load times
**Files**: `rpc/handlers.go` (new endpoint), `rpc/types.go` (new types)
**Priority**: Medium - would enable TUI message count feature without performance penalty

### Session Status Real-time Updates

**Goal**: Ensure session status accurately reflects current state including approval blocking
**Current limitation**: Status may not update when sessions are blocked on approvals
**Implementation**: Improve status propagation between approval system and session manager
**Files**: `approval/manager.go`, `session/manager.go`, event bus integration
**Dependencies**: May require event bus improvements for cross-component communication
**Priority**: High - accurate status is critical for user understanding

### Full-Text Search for Sessions

**Goal**: Enable TUI to search session content, not just metadata
**Implementation**: Add search indexing for conversation content
**Considerations**:

- SQLite FTS (Full-Text Search) extension
- Elasticsearch/similar for advanced search
- Simple LIKE queries for basic search
  **Performance**: Would need to index conversation content on creation/update
  **Files**: `store/sqlite.go` (search methods), `rpc/handlers.go` (search endpoint)
  **Priority**: Low - complex to implement, unclear user need initially

### Enhanced Session Metrics

**Goal**: Provide more detailed session analytics for TUI display
**Current data**: Basic cost, token count, duration
**Additional metrics**:

- Tool call counts by type
- Approval response times
- Session complexity scores
- Resource usage patterns
  **Storage**: Could extend session storage or create separate metrics tables
  **Files**: `session/manager.go` (metrics collection), `store/sqlite.go` (metrics storage)
  **Priority**: Low - nice to have for power users

### Conversation Export API

**Goal**: Enable TUI to export session data in various formats
**Formats**: JSON, CSV, Markdown conversation logs
**Implementation**: New RPC endpoints for data export
**Considerations**:

- Large conversation handling
- Streaming vs. bulk export
- Format-specific processing
  **Files**: `rpc/handlers.go` (export endpoints), potentially new export package
  **Priority**: Low - users can access data through other means currently

### Bulk Session Operations

**Goal**: Support bulk operations on sessions (delete, archive, etc.)
**Current limitation**: Only single-session operations supported
**Use cases**: Cleanup, batch processing, administrative operations
**Implementation**: New RPC endpoints for bulk operations with transaction support
**Files**: `rpc/handlers.go` (bulk endpoints), `session/manager.go` (bulk operations)
**Priority**: Low - single operations sufficient for most use cases initially

## Technical Debt

### Event Bus Improvements

**Goal**: Better cross-component communication for status updates
**Current limitation**: Limited event propagation between approval and session systems
**Improvements needed**:

- More granular event types
- Better error handling in event processing
- Event persistence/replay for reliability
  **Files**: `bus/events.go`, integration points in `approval/` and `session/`
  **Priority**: Medium - would solve several status update issues

### Database Schema Optimization

**Goal**: Optimize queries and storage for growing session data
**Areas for improvement**:

- Index optimization for common queries
- Conversation storage efficiency
- Session metadata normalization
  **Tools**: SQLite ANALYZE, query profiling
  **Files**: `store/sqlite.go`, potentially migration scripts
  **Priority**: Low - current performance is acceptable for expected scale

### Error Handling Standardization

**Goal**: Consistent error responses across all RPC endpoints
**Current issue**: Inconsistent error formats make debugging harder
**Implementation**: Standardized error types and response formatting
**Files**: `rpc/handlers.go`, `rpc/types.go` (error types)
**Priority**: Low - functional but could improve developer experience

## Future Features

### WebSocket/Streaming Support

**Goal**: Real-time updates for active sessions instead of polling
**Current limitation**: TUI polls for updates every 3 seconds
**Implementation**: WebSocket or Server-Sent Events for live updates
**Complexity**: High - requires significant architecture changes
**Priority**: Low - polling works well enough for current scale

### Multi-User Session Sharing

**Goal**: Allow multiple users to collaborate on sessions
**Implementation**: Session permissions, user management, collaborative editing
**Complexity**: Very high - requires authentication, authorization, conflict resolution
**Priority**: Very low - single-user focus for now

### Session Templates

**Goal**: Save and reuse session configurations
**Implementation**: Template storage, template management API
**Files**: New template storage, `rpc/handlers.go` (template endpoints)
**Priority**: Low - can be implemented client-side initially

### Advanced Analytics

**Goal**: Usage patterns, performance analytics, optimization insights
**Implementation**: Analytics collection, aggregation, reporting APIs
**Privacy considerations**: What data to collect, retention policies
**Priority**: Very low - basic metrics sufficient initially
