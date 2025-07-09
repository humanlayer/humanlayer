# Capture Claude's Default Model from Init Event Implementation Plan

## Overview

When launching Claude Code without specifying a model, the daemon should capture and store the actual model Claude uses from its init event. This ensures the UI displays the correct model instead of showing "ø" for sessions using Claude's default.

## Current State Analysis

Currently, when a user launches Claude without specifying a model:
1. The session is created with an empty model field
2. Claude uses its own default model from settings
3. Claude sends an init event containing the actual model used
4. The daemon ignores the init event completely
5. The UI shows "ø" because the model field remains empty

### Key Discoveries:
- Init events contain full API model names like `"claude-opus-4-20250514"` (hld/session/manager.go:557)
- The Model field already exists in the Session struct (hld/store/store.go:64)
- SessionUpdate struct lacks a Model field (hld/store/store.go:86-98)
- Only `subtype="session_created"` events are currently processed (hld/session/manager.go:529)

## What We're NOT Doing

- NOT allowing model changes after session creation
- NOT tracking model switches during a session
- NOT displaying both requested and actual models
- NOT changing how models are initially set when explicitly specified
- NOT adding complex model validation or transformation logic

## Implementation Approach

Only update the model field when:
1. The session was created without a model (model field is empty)
2. Claude sends its init event with the actual model
3. The model name contains "opus" or "sonnet" (simple string matching)

## Phase 1: Enable Model Updates in Store

### Overview
Add the Model field to SessionUpdate struct to allow conditional updates to the session's model.

### Changes Required:

#### 1. Update SessionUpdate Struct
**File**: `hld/store/store.go`
**Changes**: Add Model field to enable updates

```go
// SessionUpdate contains fields that can be updated
type SessionUpdate struct {
	ClaudeSessionID *string
	Summary         *string
	Status          *string
	LastActivityAt  *time.Time
	CompletedAt     *time.Time
	CostUSD         *float64
	TotalTokens     *int
	DurationMS      *int
	NumTurns        *int
	ResultContent   *string
	ErrorMessage    *string
	Model           *string  // Add this line
}
```

#### 2. Update SQLite Store Implementation
**File**: `hld/store/sqlite.go`
**Changes**: Add model update logic in UpdateSession method

Find the section where update parts are built (around line 512-515) and add:

```go
if updates.Model != nil {
	setParts = append(setParts, "model = ?")
	args = append(args, *updates.Model)
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Code compiles successfully: `cd hld && go build ./...`
- [ ] Unit tests pass: `cd hld && go test ./store/...`
- [ ] No linting errors: `cd hld && golangci-lint run`

#### Manual Verification:
- [ ] Database accepts model updates when tested directly

---

## Phase 2: Process Init Events and Populate Model

### Overview
Add handler for init events that captures Claude's model selection and updates the session only if the model was empty.

### Changes Required:

#### 1. Add Init Event Handler
**File**: `hld/session/manager.go`
**Changes**: Add handler after the session_created handler (after line 556)

```go
} else if event.Subtype == "init" {
	// Check if we need to populate the model
	session, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		slog.Error("failed to get session for model update", "error", err)
		return nil // Non-fatal, continue processing
	}
	
	// Only update if model is empty and init event has a model
	if session != nil && session.Model == "" && event.Model != "" {
		// Extract simple model name from API format
		var modelName string
		if strings.Contains(event.Model, "opus") {
			modelName = "opus"
		} else if strings.Contains(event.Model, "sonnet") {
			modelName = "sonnet"
		}
		
		// Update session with detected model
		if modelName != "" {
			update := store.SessionUpdate{
				Model: &modelName,
			}
			if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
				slog.Error("failed to update session model from init event", 
					"session_id", sessionID,
					"model", modelName,
					"error", err)
			} else {
				slog.Info("populated session model from init event",
					"session_id", sessionID,
					"model", modelName,
					"original", event.Model)
			}
		}
	}
	
	// Store the init event in conversation history
	convEvent := &store.ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		EventType:       store.EventTypeSystem,
		Role:            "system",
		Content:         fmt.Sprintf("Session initialized - Model: %s, CWD: %s", event.Model, event.CWD),
	}
	if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
		return err
	}
	
	// Publish conversation updated event
	if m.eventBus != nil {
		m.eventBus.Publish(bus.Event{
			Type: bus.EventConversationUpdated,
			Data: map[string]interface{}{
				"session_id":        sessionID,
				"claude_session_id": claudeSessionID,
				"event_type":        "system",
				"subtype":           event.Subtype,
				"content":           convEvent.Content,
				"content_type":      "system",
			},
		})
	}
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Code compiles successfully: `cd hld && go build ./...`
- [ ] All tests pass: `cd hld && go test ./...`
- [ ] Integration tests pass: `cd hld && go test -tags=integration ./...`

#### Manual Verification:
- [ ] Launch Claude without specifying a model
- [ ] Verify the session's model field gets populated with "opus" or "sonnet"
- [ ] Verify the UI no longer shows "ø" for the model
- [ ] Launch Claude WITH a model specified and verify it's not overwritten
- [ ] Check logs for "populated session model from init event" message

---

## Testing Strategy

### Unit Tests:
- Test string matching logic for model name extraction
- Test that model updates only occur when session model is empty
- Test error handling when session lookup fails

### Integration Tests:
- Launch session without model and verify it gets populated
- Launch session with model and verify it's not changed
- Test with various model name formats from init events

### Manual Testing Steps:
1. Build and run the updated daemon
2. Launch Claude Code without specifying a model: `claude --profile test`
3. Check the session list in WUI/TUI - model should show "opus" or "sonnet"
4. Launch Claude Code with explicit model: `claude --profile test --model sonnet`
5. Verify the explicit model is preserved and not overwritten
6. Check daemon logs for model population messages

## Performance Considerations

- Session lookup adds minimal overhead (single query by primary key)
- String matching is simple and fast
- Only processes init events once per session
- No impact on existing session creation flow

## Migration Notes

No database migration required - the model column already exists and this only populates empty values.

## References

- Original ticket: `thoughts/allison/tickets/eng_1540.md`
- Related issue: `thoughts/allison/tickets/eng_1536.md` (model selector issue)
- Init event structure: See raw_events table in daemon.db for examples