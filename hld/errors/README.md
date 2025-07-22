# HLD Error Handling Documentation

This document describes the error handling system used in the HumanLayer Daemon (hld).

## Error Types

### Sentinel Errors

The following sentinel errors are defined and can be checked using `errors.Is()`:

#### Session Errors
- `ErrSessionNotFound` - The requested session does not exist
- `ErrSessionNotActive` - The session is not in an active state
- `ErrSessionAlreadyCompleted` - Attempt to modify a completed session
- `ErrInvalidSessionState` - Invalid state transition attempted
- `ErrSessionOrphaned` - Session has been orphaned (no active process)

#### Approval Errors
- `ErrApprovalNotFound` - The requested approval does not exist
- `ErrApprovalAlreadyResolved` - Attempt to resolve an already resolved approval
- `ErrNoMatchingToolCall` - No matching tool call found for approval
- `ErrInvalidApprovalStatus` - Invalid approval status specified

#### Store Errors
- `ErrDuplicateSession` - Attempt to create a session with duplicate ID
- `ErrDatabaseConnection` - Database connection failed
- `ErrDatabaseMigration` - Database migration failed

#### RPC Errors
- `ErrInvalidRequest` - The RPC request is invalid
- `ErrMissingRequiredField` - A required field is missing
- `ErrMethodNotFound` - The requested RPC method does not exist

#### Daemon Errors
- `ErrDaemonAlreadyRunning` - Daemon is already running on the socket
- `ErrDaemonNotRunning` - Daemon is not running

#### Operation Errors
- `ErrOperationTimeout` - Operation timed out
- `ErrOperationCancelled` - Operation was cancelled

### Structured Error Types

#### SessionError
Provides rich context for session-related errors:
```go
type SessionError struct {
    SessionID string
    RunID     string
    Operation string
    State     string
    Err       error
}
```

#### ApprovalError
Provides rich context for approval-related errors:
```go
type ApprovalError struct {
    ApprovalID string
    SessionID  string
    ToolCallID string
    Status     string
    Operation  string
    Err        error
}
```

#### ValidationError
Represents validation failures:
```go
type ValidationError struct {
    Field   string
    Value   interface{}
    Message string
}
```

#### StoreError
Provides context for database operations:
```go
type StoreError struct {
    Operation string
    Table     string
    Query     string
    Err       error
}
```

## RPC Error Codes

The following error codes are used in JSON-RPC responses:

### Standard JSON-RPC Codes
- `-32700` - Parse error
- `-32600` - Invalid request
- `-32601` - Method not found
- `-32602` - Invalid params
- `-32603` - Internal error

### Custom Error Codes
- `-32001` - Resource not found (sessions, approvals, etc.)
- `-32002` - Resource conflict (duplicate, already exists)
- `-32003` - Operation timeout
- `-32004` - Invalid state transition
- `-32005` - Validation failed

## Error Checking

### Using Sentinel Errors
```go
if errors.Is(err, hlderrors.ErrSessionNotFound) {
    // Handle session not found
}
```

### Using Helper Functions
```go
if hlderrors.IsNotFound(err) {
    // Handles ErrSessionNotFound or ErrApprovalNotFound
}

if hlderrors.IsAlreadyExists(err) {
    // Handles duplicate/conflict errors
}

if hlderrors.IsInvalidState(err) {
    // Handles invalid state transitions
}

if hlderrors.IsTimeout(err) {
    // Handles timeout errors
}

if hlderrors.IsCancelled(err) {
    // Handles cancellation errors
}
```

### Extracting Structured Errors
```go
var sessionErr *hlderrors.SessionError
if errors.As(err, &sessionErr) {
    fmt.Printf("Session %s failed during %s operation\n",
        sessionErr.SessionID, sessionErr.Operation)
}

var validationErr *hlderrors.ValidationError
if errors.As(err, &validationErr) {
    fmt.Printf("Validation failed for field %s: %s\n",
        validationErr.Field, validationErr.Message)
}
```

## Best Practices

1. **Use Sentinel Errors for Known Conditions**
   ```go
   if session == nil {
       return hlderrors.ErrSessionNotFound
   }
   ```

2. **Wrap Errors with Context**
   ```go
   return hlderrors.NewSessionError("launch", sessionID, err)
   ```

3. **Check Specific Errors First**
   ```go
   if errors.Is(err, sql.ErrNoRows) {
       return hlderrors.ErrSessionNotFound
   }
   return hlderrors.NewStoreError("query", "sessions", err)
   ```

4. **Use Validation Errors for Input Validation**
   ```go
   if req.Query == "" {
       return hlderrors.NewValidationError("query", "required field")
   }
   ```

5. **Don't Expose Internal Details**
   - Database queries and internal paths should not be exposed in client-facing errors
   - Use the RPC error mapping to sanitize error messages

## Error Response Format

RPC error responses follow this format:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Resource not found",
    "data": {
      "error": "session not found"
    }
  }
}
```

For validation errors:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32005,
    "message": "Validation failed",
    "data": {
      "field": "query",
      "message": "required field"
    }
  }
}
```

## Migration Guide

If you're updating existing code to use the new error system:

1. Replace string error checks:
   ```go
   // Old
   if err.Error() == "session not found" {

   // New
   if errors.Is(err, hlderrors.ErrSessionNotFound) {
   ```

2. Replace generic error creation:
   ```go
   // Old
   return fmt.Errorf("failed to get session: %w", err)

   // New
   return hlderrors.NewSessionError("get", sessionID, err)
   ```

3. Update error responses:
   ```go
   // Old
   return &Response{
       Error: &Error{
           Code:    InternalError,
           Message: err.Error(),
       },
   }

   // New
   return wrapError(id, err)
   ```
