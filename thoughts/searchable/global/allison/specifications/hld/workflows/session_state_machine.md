---
component_name: Session State Machine
component_type: workflow
location: hld/session/
analyzed_date: 2025-06-26
dependencies: []
dependents: [session_manager]
test_coverage: 90
---

# Session State Machine Specification (Language-Agnostic)

## Overview

This document specifies the exact state transitions for Claude Code sessions, including triggers, guards, and side effects.

## State Definitions

### States
1. **starting** - Initial state, session created but Claude process not yet ready
2. **running** - Active session, Claude is processing
3. **waiting_input** - Blocked on human approval or input
4. **completed** - Session finished successfully
5. **failed** - Session encountered an error

### State Properties
```
State {
  name: string
  is_terminal: boolean
  allowed_transitions: []string
  timeout: duration (optional)
}
```

## State Machine Definition

```
STATES = {
  starting: {
    is_terminal: false,
    allowed_transitions: [running, failed],
    timeout: 60s
  },
  running: {
    is_terminal: false,
    allowed_transitions: [waiting_input, completed, failed]
  },
  waiting_input: {
    is_terminal: false,
    allowed_transitions: [running, failed]
  },
  completed: {
    is_terminal: true,
    allowed_transitions: []
  },
  failed: {
    is_terminal: true,
    allowed_transitions: []
  }
}
```

## Transition Rules

### 1. starting → running
**Trigger**: Claude session ID received
**Guard**: Session must be in "starting" state
**Actions**:
```
1. Update session.claude_session_id = received_id
2. Update session.status = "running"
3. Update session.last_activity_at = NOW()
4. Emit SessionStatusChanged(starting, running)
```

### 2. starting → failed
**Trigger**: Launch timeout OR launch error
**Guard**: Session must be in "starting" state
**Actions**:
```
1. Update session.status = "failed"
2. Update session.error_message = error_details
3. Update session.completed_at = NOW()
4. Calculate session.duration_ms = NOW() - created_at
5. Emit SessionStatusChanged(starting, failed)
```

### 3. running → waiting_input
**Trigger**: Approval correlated to session's tool call
**Guard**: Session must be in "running" state
**Actions**:
```
1. Update session.status = "waiting_input"
2. Update session.last_activity_at = NOW()
3. Emit SessionStatusChanged(running, waiting_input)
```

### 4. waiting_input → running
**Trigger**: Approval resolved (approved/denied/responded)
**Guard**: Session must be in "waiting_input" state
**Actions**:
```
1. Update session.status = "running"
2. Update session.last_activity_at = NOW()
3. Emit SessionStatusChanged(waiting_input, running)
```

### 5. running → completed
**Trigger**: Claude process exits with code 0
**Guard**: Session must be in "running" state
**Actions**:
```
1. Update session.status = "completed"
2. Update session.completed_at = NOW()
3. Calculate session.duration_ms = NOW() - created_at
4. Calculate session.cost_usd = CalculateCost(total_tokens)
5. Generate session.summary = GenerateSummary(conversation)
6. Emit SessionStatusChanged(running, completed)
```

### 6. running → failed
**Trigger**: Claude process exits with non-zero code OR interrupt requested
**Guard**: Session must be in "running" state
**Actions**:
```
1. Update session.status = "failed"
2. Update session.error_message = exit_reason
3. Update session.completed_at = NOW()
4. Calculate session.duration_ms = NOW() - created_at
5. Emit SessionStatusChanged(running, failed)
```

### 7. waiting_input → failed
**Trigger**: Session interrupt OR approval timeout
**Guard**: Session must be in "waiting_input" state
**Actions**:
```
1. Update session.status = "failed"
2. Update session.error_message = "Interrupted while waiting for approval"
3. Update session.completed_at = NOW()
4. Calculate session.duration_ms = NOW() - created_at
5. Emit SessionStatusChanged(waiting_input, failed)
```

## Transition Algorithm

```
FUNCTION TransitionSession(session_id, new_status, metadata):
    session = LoadSession(session_id)
    old_status = session.status
    
    // Validate transition
    IF new_status NOT IN STATES[old_status].allowed_transitions:
        RETURN ERROR("Invalid transition: {old_status} → {new_status}")
    
    // Check if already terminal
    IF STATES[old_status].is_terminal:
        RETURN ERROR("Cannot transition from terminal state: {old_status}")
    
    // Begin transaction
    BEGIN_TRANSACTION()
    
    TRY:
        // Update session
        session.status = new_status
        session.last_activity_at = NOW()
        
        // Apply state-specific updates
        SWITCH new_status:
            CASE "running":
                IF metadata.claude_session_id:
                    session.claude_session_id = metadata.claude_session_id
            
            CASE "completed":
                session.completed_at = NOW()
                session.duration_ms = NOW() - session.created_at
                session.cost_usd = metadata.cost_usd OR 0
                session.total_tokens = metadata.total_tokens OR 0
                session.summary = metadata.summary OR ""
            
            CASE "failed":
                session.completed_at = NOW()
                session.duration_ms = NOW() - session.created_at
                session.error_message = metadata.error_message OR "Unknown error"
        
        // Save to database
        SaveSession(session)
        
        // Emit event
        EmitEvent({
            type: "session_status_changed",
            data: {
                session_id: session_id,
                old_status: old_status,
                new_status: new_status
            }
        })
        
        COMMIT_TRANSACTION()
        RETURN SUCCESS
        
    CATCH error:
        ROLLBACK_TRANSACTION()
        RETURN ERROR(error)
```

## Special Cases

### 1. Orphaned Sessions
**Scenario**: Daemon restarts while sessions are active
**Detection**: On startup, find sessions with status IN ["starting", "running", "waiting_input"]
**Action**:
```
FOR session IN orphaned_sessions:
    TransitionSession(session.id, "failed", {
        error_message: "Session orphaned due to daemon restart"
    })
```

### 2. Parent-Child Sessions
**Scenario**: Continue session creates child with parent reference
**Rules**:
- Child session starts in "starting" state
- Child inherits parent's conversation history
- Child has independent state from parent
- Parent state is NOT affected by child state

### 3. Concurrent Transitions
**Prevention**: Use database transactions with row locking
```
SQL: SELECT * FROM sessions WHERE id = ? FOR UPDATE
```

### 4. External State Changes
**Scenario**: Multiple daemons or external updates
**Handling**: Always read current state before transition

## State Queries

### Active Sessions
```sql
SELECT * FROM sessions 
WHERE status IN ('starting', 'running', 'waiting_input')
ORDER BY last_activity_at DESC
```

### Terminal Sessions
```sql
SELECT * FROM sessions
WHERE status IN ('completed', 'failed')
ORDER BY completed_at DESC
```

### Sessions Awaiting Input
```sql
SELECT s.*, ce.tool_name, ce.approval_id
FROM sessions s
JOIN conversation_events ce ON s.id = ce.session_id
WHERE s.status = 'waiting_input'
  AND ce.approval_status = 'pending'
```

## Monitoring and Timeouts

### Starting Timeout
```
IF session.status == "starting" AND (NOW() - session.created_at) > 60s:
    TransitionSession(session.id, "failed", {
        error_message: "Timeout waiting for Claude session ID"
    })
```

### Activity Monitoring
```
EVERY 30s:
    FOR session IN active_sessions:
        IF (NOW() - session.last_activity_at) > ACTIVITY_TIMEOUT:
            LogWarning("Session {session.id} inactive for {duration}")
```

## Implementation Requirements

1. **Atomic Transitions**: Use database transactions
2. **Event Emission**: Emit events AFTER successful transition
3. **Validation**: Always validate current state before transition
4. **Idempotency**: Handle duplicate transition requests gracefully
5. **Audit Trail**: Log all state transitions with timestamp and reason