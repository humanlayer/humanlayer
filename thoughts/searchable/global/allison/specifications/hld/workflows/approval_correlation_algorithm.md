---
component_name: Approval Correlation Algorithm
component_type: workflow
location: hld/approval/correlator.go
analyzed_date: 2025-06-26
dependencies: [database, event_bus]
dependents: [approval_manager]
test_coverage: 85
---

# Approval Correlation Algorithm (Language-Agnostic)

## Overview

This algorithm matches approval requests from an external API with pending tool calls in active sessions. It handles polling, correlation, state management, and event distribution.

## Data Structures

### Approval Structure
```
Approval {
  id: string                     // Unique approval ID
  call_id: string                // Unique call identifier
  run_id: string                 // Session run identifier
  type: string                   // "function_call" or "human_contact"
  status: string                 // "pending", "approved", "denied"
  function_name: string          // Name of function being called
  function_args: map<string, any> // Function arguments
  requested_at: timestamp        // When approval was requested
  timeout_at: timestamp          // When approval expires
}
```

### Tool Call Structure
```
ToolCall {
  id: integer                    // Database primary key
  session_id: string             // Session identifier
  tool_id: string                // Unique tool call ID
  tool_name: string              // Name of tool being called
  tool_input_json: string        // JSON string of inputs
  is_completed: boolean          // Has result been received?
  approval_status: string        // NULL, "pending", "approved", "denied"
  approval_id: string            // Linked approval ID
  sequence: integer              // Order in conversation
}
```

## Algorithm Steps

### 1. Polling Loop
```
WHILE daemon is running:
    TRY:
        approvals = FetchPendingApprovals()
        ReconcileApprovals(approvals)
        CorrelateApprovals(approvals)
        ResetBackoff()
    CATCH error:
        backoff = MIN(backoff * BACKOFF_FACTOR, MAX_BACKOFF)
        SLEEP(backoff)
    
    SLEEP(POLL_INTERVAL)
```

### 2. Fetch Pending Approvals
```
FUNCTION FetchPendingApprovals():
    function_calls = HTTP_GET("/function_calls?status=pending")
    human_contacts = HTTP_GET("/human_contacts?status=pending")
    RETURN CONCAT(function_calls, human_contacts)
```

### 3. Reconcile Approvals (Detect External Resolution)
```
FUNCTION ReconcileApprovals(fetched_approvals):
    fetched_ids = SET(approval.call_id FOR approval IN fetched_approvals)
    
    FOR cached_approval IN cache:
        IF cached_approval.call_id NOT IN fetched_ids:
            // Approval resolved externally
            MarkApprovalResolved(cached_approval, "resolved")
            RemoveFromCache(cached_approval)
            EmitResolvedEvent(cached_approval)
```

### 4. Correlate Approvals
```
FUNCTION CorrelateApprovals(approvals):
    FOR approval IN approvals:
        IF approval.run_id IS EMPTY:
            CONTINUE
        
        session = FindSessionByRunID(approval.run_id)
        IF session IS NULL:
            // Check if it's a parent session
            child_sessions = FindSessionsByParentRunID(approval.run_id)
            IF child_sessions IS NOT EMPTY:
                session = child_sessions[0]
        
        IF session IS NOT NULL:
            tool_call = FindUncompletedToolCall(session.id, approval.function_name)
            IF tool_call IS NOT NULL:
                CorrelateToolCall(tool_call, approval)
                UpdateSessionStatus(session.id, "waiting_input")
                EmitNewApprovalEvent(approval)
```

### 5. Find Uncompleted Tool Call
```
FUNCTION FindUncompletedToolCall(session_id, tool_name):
    SQL = "
        SELECT * FROM conversation_events
        WHERE session_id = ?
          AND tool_name = ?
          AND event_type = 'tool_call'
          AND is_completed = FALSE
          AND (approval_status IS NULL OR approval_status = '')
        ORDER BY sequence DESC
        LIMIT 1
    "
    RETURN ExecuteQuery(SQL, [session_id, tool_name])
```

### 6. Correlate Tool Call
```
FUNCTION CorrelateToolCall(tool_call, approval):
    SQL = "
        UPDATE conversation_events
        SET approval_status = 'pending',
            approval_id = ?
        WHERE id = ?
    "
    ExecuteUpdate(SQL, [approval.id, tool_call.id])
    AddToCache(approval)
```

### 7. Update Session Status
```
FUNCTION UpdateSessionStatus(session_id, new_status):
    old_status = GetSessionStatus(session_id)
    
    SQL = "UPDATE sessions SET status = ? WHERE id = ?"
    ExecuteUpdate(SQL, [new_status, session_id])
    
    EmitStatusChangeEvent(session_id, old_status, new_status)
```

### 8. Handle Approval Decision
```
FUNCTION HandleApprovalDecision(call_id, decision, comment):
    approval = cache[call_id]
    IF approval IS NULL:
        RETURN ERROR("Approval not found")
    
    // Update API
    IF approval.type == "function_call":
        IF decision NOT IN ["approve", "deny"]:
            RETURN ERROR("Invalid decision")
        IF decision == "deny" AND comment IS EMPTY:
            RETURN ERROR("Comment required for deny")
        
        API_POST("/function_calls/{call_id}/respond", {
            "decision": decision,
            "reason": comment
        })
    ELSE IF approval.type == "human_contact":
        IF decision != "respond":
            RETURN ERROR("Must use 'respond' for human contact")
        IF comment IS EMPTY:
            RETURN ERROR("Response required")
        
        API_POST("/human_contacts/{call_id}/respond", {
            "response": comment
        })
    
    // Update database
    SQL = "
        UPDATE conversation_events
        SET approval_status = ?,
            approval_resolved_at = CURRENT_TIMESTAMP
        WHERE approval_id = ?
    "
    ExecuteUpdate(SQL, [decision, approval.id])
    
    // Update session status back to running
    sessions = FindSessionsByRunID(approval.run_id)
    FOR session IN sessions:
        IF session.status == "waiting_input":
            UpdateSessionStatus(session.id, "running")
    
    RemoveFromCache(approval)
    EmitResolvedEvent(approval, decision, comment)
```

## Constants

```
# Timing
POLL_INTERVAL = 5000ms          # Base polling interval
MAX_BACKOFF = 300000ms          # 5 minutes maximum backoff
BACKOFF_FACTOR = 2.0            # Exponential backoff multiplier
POLL_TIMEOUT = 30000ms          # HTTP request timeout

# Approval Types
TYPE_FUNCTION_CALL = "function_call"
TYPE_HUMAN_CONTACT = "human_contact"

# Approval Statuses  
STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"
STATUS_RESOLVED = "resolved"

# Decision Types
DECISION_APPROVE = "approve"
DECISION_DENY = "deny"
DECISION_RESPOND = "respond"
```

## Error Handling

### API Errors
- **409 Conflict**: Already responded - return ErrAlreadyResponded
- **404 Not Found**: Approval doesn't exist - remove from cache
- **5xx Errors**: Retry with backoff

### Database Errors
- Log error and continue processing other approvals
- Don't remove from cache on database errors

### Correlation Failures
- No matching tool call: Log debug, continue (might be for different system)
- Already correlated: Skip silently
- Session not found: Check parent sessions before giving up

## Events Emitted

### NewApproval Event
```json
{
  "type": "new_approval",
  "timestamp": "2025-06-26T10:00:00Z",
  "data": {
    "approvals": [...],
    "run_id": "run_123"
  }
}
```

### ApprovalResolved Event  
```json
{
  "type": "approval_resolved",
  "timestamp": "2025-06-26T10:00:00Z",
  "data": {
    "approval_id": "appr_123",
    "call_id": "call_456",
    "run_id": "run_789",
    "decision": "approved",
    "session_id": "sess_abc"
  }
}
```

### SessionStatusChanged Event
```json
{
  "type": "session_status_changed",
  "timestamp": "2025-06-26T10:00:00Z",
  "data": {
    "session_id": "sess_123",
    "old_status": "running",
    "new_status": "waiting_input"
  }
}
```

## Implementation Notes

1. **Concurrency**: Correlation runs in single thread to avoid race conditions
2. **Caching**: In-memory cache indexed by call_id and run_id
3. **Persistence**: Approval state stored in database for recovery
4. **Idempotency**: Correlation can be retried safely
5. **Parent Sessions**: Always check parent session if no match in current