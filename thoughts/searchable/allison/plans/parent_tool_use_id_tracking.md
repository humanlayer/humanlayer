# Parent Tool Use ID Tracking Implementation Plan

## Overview

This plan implements tracking of parent-child relationships for Claude sub-task events in the hld daemon. The `parent_tool_use_id` field is already present in the streaming JSON at the event level but is not being captured or stored.

## Problem Statement

From ENG-1478:
- Events with `parent_tool_use_id` are stored flat in SQLite without preserving relationships
- No way to query events by parent task
- Cannot determine task hierarchy or nesting depth

## Key Discovery

Looking at the streaming JSON:
```json
{
  "type": "assistant",
  "message": { ... },
  "parent_tool_use_id": "toolu_01PBJVpvVJtGFVCk4L8TmRED",
  "session_id": "e844331c-19ba-4658-9feb-ffe449924030"
}
```

The `parent_tool_use_id` is at the **event level**, not inside the message content. This is important because:
- It's metadata about the entire event
- It sits alongside `type`, `message`, and `session_id`
- It applies to all content within the message

## Current State

1. **Raw events are stored**: We already store the full JSON in `raw_events` table
2. **Structured storage missing**: The `conversation_events` table doesn't capture parent relationships
3. **Frontend could parse raw JSON**: But this would be inefficient and not queryable

## Implementation Steps

### Phase 1: Update claudecode-go to Parse Parent Tool Use ID

**File:** `claudecode-go/types.go`

Add field to StreamEvent struct:
```go
type StreamEvent struct {
    Type       string      `json:"type"`
    Subtype    string      `json:"subtype,omitempty"`
    SessionID  string      `json:"session_id,omitempty"`
    Message    *Message    `json:"message,omitempty"`
    
    // Parent tracking for sub-tasks
    ParentToolUseID string `json:"parent_tool_use_id,omitempty"`  // NEW
    
    // ... rest of fields
}
```

**Success Criteria:**
- [ ] Field parses correctly from JSON
- [ ] Tests pass in claudecode-go

### Phase 2: Database Schema Update

**File:** `hld/store/sqlite.go`

Add migration:
```go
{
    version: 3,
    description: "Add parent_tool_use_id for sub-task tracking",
    sql: `
        ALTER TABLE conversation_events 
        ADD COLUMN parent_tool_use_id TEXT;
        
        CREATE INDEX IF NOT EXISTS idx_conversation_parent_tool 
        ON conversation_events(parent_tool_use_id) 
        WHERE parent_tool_use_id IS NOT NULL;
    `,
}
```

**File:** `hld/store/store.go`

Update struct:
```go
type ConversationEvent struct {
    // ... existing fields ...
    
    // Tool call fields
    ToolID          string
    ToolName        string
    ToolInputJSON   string
    ParentToolUseID string  // NEW
    
    // ... rest of fields ...
}
```

**Success Criteria:**
- [ ] Migration applies cleanly
- [ ] ConversationEvent struct updated
- [ ] Index created for queries

### Phase 3: Capture Parent ID in Session Manager

**File:** `hld/session/manager.go`

Update processStreamEvent to pass parent ID to all conversation events:
```go
func (m *Manager) processStreamEvent(ctx context.Context, sessionID string, claudeSessionID string, event claudecode.StreamEvent) error {
    // ... existing code ...
    
    case "assistant", "user":
        if event.Message != nil {
            for _, content := range event.Message.Content {
                switch content.Type {
                case "tool_use":
                    // Tool call
                    inputJSON, err := json.Marshal(content.Input)
                    if err != nil {
                        return fmt.Errorf("failed to marshal tool input: %w", err)
                    }

                    convEvent := &store.ConversationEvent{
                        SessionID:       sessionID,
                        ClaudeSessionID: claudeSessionID,
                        EventType:       store.EventTypeToolCall,
                        ToolID:          content.ID,
                        ToolName:        content.Name,
                        ToolInputJSON:   string(inputJSON),
                        ParentToolUseID: event.ParentToolUseID,  // NEW: From event level
                    }
                    // ... rest of code
```

**Note:** The parent ID comes from the event level, not the content, because it's metadata about the entire message.

**Success Criteria:**
- [ ] Parent ID captured for tool calls
- [ ] Parent ID is empty/null for non-sub-tasks
- [ ] No regression in existing functionality

### Phase 4: Update Store Implementation

**File:** `hld/store/sqlite.go`

Update all queries to handle the new field:

1. **AddConversationEvent** - Include in INSERT
2. **GetConversation/GetSessionConversation** - Include in SELECT and scanning
3. Other query methods as needed

Example:
```go
// In AddConversationEvent
query := `
    INSERT INTO conversation_events (
        ..., parent_tool_use_id
    ) VALUES (..., ?)
`

// In GetConversation scanning
&event.ParentToolUseID,
```

**Success Criteria:**
- [ ] All queries handle the new field
- [ ] NULL values handled correctly
- [ ] Field returned in GetConversation results

### Phase 5: Testing

**Test Scenarios:**
1. Launch session with Task tool that spawns sub-tasks
2. Verify parent_tool_use_id is stored correctly
3. Query conversation and verify field is returned
4. Test that regular tool calls have NULL parent ID

**Success Criteria:**
- [ ] Sub-tasks have correct parent_tool_use_id
- [ ] Regular tool calls have NULL parent_tool_use_id
- [ ] GetConversation returns the field
- [ ] Can query by parent ID using the index

## Why This Approach

1. **Event-level field**: We correctly capture parent_tool_use_id from where it actually exists in the JSON
2. **Structured storage**: Makes querying efficient vs parsing raw JSON
3. **Frontend ready**: GetConversation will return the field for UI use
4. **Minimal changes**: Just adding one field throughout the stack

## What We're NOT Doing

- Not trying to build tree structures in the backend
- Not adding new RPC methods (getConversation already returns everything needed)
- Not modifying how events are displayed (frontend concern)

## Total Implementation Time

Estimated 2-3 hours:
1. claudecode-go update (30 min)
2. Database migration (30 min)  
3. Manager + Store updates (1 hour)
4. Testing (30-60 min)