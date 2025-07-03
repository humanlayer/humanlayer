---
component_name: Store
component_type: repository
location: hld/store/
analyzed_date: 2025-06-26
dependencies: [mattn/go-sqlite3]
dependents: [daemon.Daemon, session.Manager, approval.Correlator]
test_coverage: 85
---

# Store Component Specification

## Overview

**Purpose**: Provides persistent storage layer for sessions, conversations, and related data using SQLite
**Responsibility**: Database operations, schema management, and data integrity
**Location**: `hld/store/`

## Public API

### Exported Interfaces

#### `Store`

**Purpose**: Main interface for all storage operations

```go
type Store interface {
    ConversationStore
    
    // Lifecycle methods
    Initialize(ctx context.Context) error
    Close() error
}
```

#### `ConversationStore`

**Purpose**: Interface for conversation and session operations

```go
type ConversationStore interface {
    // Session operations
    CreateSession(ctx context.Context, session *Session) error
    UpdateSession(ctx context.Context, session *Session) error
    GetSession(ctx context.Context, sessionID string) (*Session, error)
    GetSessionByClaudeID(ctx context.Context, claudeSessionID string) (*Session, error)
    ListSessions(ctx context.Context) ([]*Session, error)
    UpdateSessionStatus(ctx context.Context, sessionID, status string) error
    UpdateSessionClaudeID(ctx context.Context, sessionID, claudeSessionID string) error
    
    // Conversation operations
    RecordConversationEvent(ctx context.Context, event *ConversationEvent) error
    GetConversationHistory(ctx context.Context, sessionID string) ([]*ConversationEvent, error)
    GetConversationByClaudeSessionID(ctx context.Context, claudeSessionID string) ([]*ConversationEvent, error)
    GetPendingToolCalls(ctx context.Context, sessionID string) ([]*ConversationEvent, error)
    UpdateToolCallApproval(ctx context.Context, eventID int, approvalID, status string) error
    
    // MCP server operations
    SaveMCPServers(ctx context.Context, sessionID string, servers map[string]interface{}) error
    GetMCPServers(ctx context.Context, sessionID string) (map[string]interface{}, error)
    
    // Raw event operations
    SaveRawEvent(ctx context.Context, sessionID string, eventJSON string) error
}
```

### Exported Types

#### `Session`
```go
type Session struct {
    ID                string
    RunID             string
    ClaudeSessionID   string
    ParentSessionID   *string
    Status            string
    Query             string
    Summary           string
    Model             string
    WorkingDir        string
    CreatedAt         time.Time
    LastActivityAt    time.Time
    CompletedAt       *time.Time
    ErrorMessage      string
    CostUSD           float64
    TotalTokens       int
    DurationMS        int64
}
```

#### `ConversationEvent`
```go
type ConversationEvent struct {
    ID                  int
    SessionID           string
    ClaudeSessionID     string
    Sequence            int
    EventType           string
    CreatedAt           time.Time
    Role                string
    Content             string
    ToolID              string
    ToolName            string
    ToolInputJSON       string
    ToolResultForID     string
    ToolResultContent   string
    ToolResultError     bool
    IsCompleted         bool
    ApprovalStatus      string
    ApprovalID          string
    ApprovalResolvedAt  *time.Time
}
```

### Constructor

```go
func NewSQLiteStore(dbPath string, logger *slog.Logger) (Store, error)
```

## Internal Implementation

### Private Types

#### `SQLiteStore`

**Fields**:
- `db` (*sql.DB): Database connection
- `logger` (*slog.Logger): Logger instance
- `dbPath` (string): Database file path

### Private Methods

#### Database Setup
- `createTables() error`: Create all database tables
- `enableWAL() error`: Enable Write-Ahead Logging mode
- `enableForeignKeys() error`: Enable foreign key constraints

#### Transaction Helpers
- `withTx(ctx, func(*sql.Tx) error) error`: Execute function in transaction

#### Query Builders
- `buildConversationQuery(includeParent bool) string`: Build conversation query
- `scanSession(rows) (*Session, error)`: Scan session from rows
- `scanConversationEvent(rows) (*ConversationEvent, error)`: Scan event from rows

### Design Patterns

- **Pattern Used**: Repository Pattern
- **Rationale**: Abstracts database operations from business logic
- **Implementation Details**: Interface-based design for testability

## Database Schema

### Tables
1. **sessions**: Session metadata and state
2. **conversation_events**: Polymorphic event storage
3. **mcp_servers**: MCP server configurations
4. **raw_events**: Raw JSON event storage
5. **schema_version**: Migration tracking

### Key Features
- **WAL Mode**: Better concurrency performance
- **Foreign Keys**: Referential integrity enforced
- **Indexes**: Optimized for common queries
- **Views**: Pre-defined queries for common operations

## Error Handling

### Error Types
- Database connection errors
- Constraint violation errors
- Not found errors (return nil, no error)
- JSON marshaling/unmarshaling errors

### Error Handling Strategy
- All errors wrapped with context
- Transactions rolled back on error
- Resources cleaned up in defer blocks

## Configuration

### Database Configuration
- **File Path**: Configurable via constructor
- **Pragmas**:
  - `journal_mode = WAL`
  - `foreign_keys = ON`
  - `busy_timeout = 5000`

## Performance Characteristics

- **Connection Pool**: Single connection (SQLite limitation)
- **WAL Mode**: Allows concurrent reads
- **Indexes**: All foreign keys and common filters indexed
- **Query Performance**: 
  - Session queries: O(1) with ID
  - Conversation queries: O(n) with n events
  - List operations: O(n) with n records

## Testing

### Test Coverage
- Unit Tests: 85% coverage
- Integration Tests: Full CRUD operations

### Key Test Scenarios
1. Database initialization and schema creation
2. Session lifecycle (create, update, retrieve)
3. Conversation recording and retrieval
4. Parent-child session relationships
5. Approval correlation updates
6. Transaction rollback on errors
7. Concurrent access (WAL mode)

### Test Files
- Unit tests: `hld/store/sqlite_test.go`
- Integration tests: `hld/store/sqlite_integration_test.go`
- Mock: `hld/store/mock_store.go`

## Security Considerations

- **SQL Injection**: All queries use parameterized statements
- **File Permissions**: Database file inherits directory permissions
- **No Encryption**: Data stored in plaintext
- **Access Control**: Relies on file system permissions

## Future Considerations

- **Migration System**: Automated schema migrations
- **Backup/Restore**: Database backup functionality
- **Encryption**: SQLCipher for encrypted storage
- **Metrics**: Query performance tracking
- **Archival**: Old data archival strategy

## Code Examples

### Creating Store
```go
store, err := store.NewSQLiteStore("~/.humanlayer/daemon.db", logger)
if err != nil {
    return err
}
defer store.Close()

// Initialize schema
if err := store.Initialize(ctx); err != nil {
    return err
}
```

### Recording Conversation Event
```go
event := &store.ConversationEvent{
    SessionID:       sessionID,
    ClaudeSessionID: claudeSessionID,
    Sequence:        1,
    EventType:       "message",
    Role:            "user",
    Content:         "Hello, Claude!",
}

err := store.RecordConversationEvent(ctx, event)
```

### Querying with Parent History
```go
// Get conversation including parent sessions
events, err := store.GetConversationHistory(ctx, sessionID)

// Events will include parent session events
// ordered by session hierarchy and sequence
```

## Related Documentation

- Database Schema: [`../../data_models/schemas.sql`](../../data_models/schemas.sql)
- Entity Relationships: [`../../data_models/entities.md`](../../data_models/entities.md)
- Session Manager: [`../session_manager_spec.md`](../session_manager_spec.md)