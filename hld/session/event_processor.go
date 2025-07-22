package session

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

// EventProcessor handles processing of Claude session events
type EventProcessor struct {
	store    store.ConversationStore
	eventBus bus.EventBus
}

// NewEventProcessor creates a new event processor
func NewEventProcessor(store store.ConversationStore, eventBus bus.EventBus) *EventProcessor {
	return &EventProcessor{
		store:    store,
		eventBus: eventBus,
	}
}

// ProcessStreamEvent processes a streaming event and stores it in the database
func (p *EventProcessor) ProcessStreamEvent(ctx context.Context, sessionID string, claudeSessionID string, event claudecode.StreamEvent) error {
	// Skip events without claude session ID
	if claudeSessionID == "" {
		return nil
	}

	// Update session activity for relevant events
	defer p.updateSessionActivity(ctx, sessionID)

	switch event.Type {
	case "system":
		return p.processSystemEvent(ctx, sessionID, claudeSessionID, event)
	case "assistant", "user":
		return p.processMessageEvent(ctx, sessionID, claudeSessionID, event)
	case "result":
		return p.processResultEvent(ctx, sessionID, event)
	}

	return nil
}

// processSystemEvent handles system events
func (p *EventProcessor) processSystemEvent(ctx context.Context, sessionID, claudeSessionID string, event claudecode.StreamEvent) error {
	switch event.Subtype {
	case "session_created":
		// Store system event
		convEvent := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeSystem,
			Role:            "system",
			Content:         fmt.Sprintf("Session created with ID: %s", event.SessionID),
		}
		if err := p.store.AddConversationEvent(ctx, convEvent); err != nil {
			return err
		}

		// Publish conversation updated event
		if p.eventBus != nil {
			p.eventBus.Publish(bus.Event{
				Type: bus.EventConversationUpdated,
				Data: map[string]interface{}{
					"session_id":        sessionID,
					"claude_session_id": claudeSessionID,
					"event_type":        "system",
					"subtype":           event.Subtype,
					"content":           fmt.Sprintf("Session created with ID: %s", event.SessionID),
					"content_type":      "system",
				},
			})
		}

	case "init":
		// Check if we need to populate the model
		session, err := p.store.GetSession(ctx, sessionID)
		if err != nil {
			slog.Error("failed to get session for model update", "error", err)
			return nil // Non-fatal, continue processing
		}

		// Only update if model is empty and init event has a model
		if session != nil && session.Model == "" && event.Model != "" {
			// Extract simple model name from API format (case-insensitive)
			var modelName string
			lowerModel := strings.ToLower(event.Model)
			if strings.Contains(lowerModel, "opus") {
				modelName = "opus"
			} else if strings.Contains(lowerModel, "sonnet") {
				modelName = "sonnet"
			}

			// Update session with detected model
			if modelName != "" {
				update := store.SessionUpdate{
					Model: &modelName,
				}
				if err := p.store.UpdateSession(ctx, sessionID, update); err != nil {
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
			} else {
				// Log when we detect a model but don't recognize the format
				slog.Debug("unrecognized model format in init event",
					"session_id", sessionID,
					"model", event.Model)
			}
		}
		// Don't store init event in conversation history - we only extract the model
	}
	// Other system events can be added as needed

	return nil
}

// processMessageEvent handles assistant and user messages
func (p *EventProcessor) processMessageEvent(ctx context.Context, sessionID, claudeSessionID string, event claudecode.StreamEvent) error {
	if event.Message == nil {
		return nil
	}

	// Process each content block
	for _, content := range event.Message.Content {
		switch content.Type {
		case "text":
			// Text message
			convEvent := &store.ConversationEvent{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeMessage,
				Role:            event.Message.Role,
				Content:         content.Text,
			}
			if err := p.store.AddConversationEvent(ctx, convEvent); err != nil {
				return err
			}

			// Publish conversation updated event
			if p.eventBus != nil {
				p.eventBus.Publish(bus.Event{
					Type: bus.EventConversationUpdated,
					Data: map[string]interface{}{
						"session_id":        sessionID,
						"claude_session_id": claudeSessionID,
						"event_type":        "message",
						"role":              event.Message.Role,
						"content":           content.Text,
						"content_type":      "text",
					},
				})
			}

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
				ParentToolUseID: event.ParentToolUseID, // Capture from event level
				// We don't know yet if this needs approval - that comes from HumanLayer API
			}
			if err := p.store.AddConversationEvent(ctx, convEvent); err != nil {
				return err
			}

			// Publish conversation updated event
			if p.eventBus != nil {
				// Parse tool input for event data
				var toolInput map[string]interface{}
				if err := json.Unmarshal([]byte(string(inputJSON)), &toolInput); err != nil {
					toolInput = nil // Don't include invalid JSON
				}

				p.eventBus.Publish(bus.Event{
					Type: bus.EventConversationUpdated,
					Data: map[string]interface{}{
						"session_id":         sessionID,
						"claude_session_id":  claudeSessionID,
						"event_type":         "tool_call",
						"tool_id":            content.ID,
						"tool_name":          content.Name,
						"tool_input":         toolInput,
						"parent_tool_use_id": event.ParentToolUseID,
						"content_type":       "tool_use",
					},
				})
			}

		case "tool_result":
			// Tool result (in user message)
			convEvent := &store.ConversationEvent{
				SessionID:         sessionID,
				ClaudeSessionID:   claudeSessionID,
				EventType:         store.EventTypeToolResult,
				Role:              "user",
				ToolResultForID:   content.ToolUseID,
				ToolResultContent: content.Content,
			}
			if err := p.store.AddConversationEvent(ctx, convEvent); err != nil {
				return err
			}

			// Asynchronously capture file snapshot for Read tool results
			if toolCall, err := p.store.GetToolCallByID(ctx, content.ToolUseID); err == nil && toolCall != nil && toolCall.ToolName == "Read" {
				go p.captureFileSnapshot(ctx, sessionID, content.ToolUseID, toolCall.ToolInputJSON, content.Content)
			}

			// Publish conversation updated event
			if p.eventBus != nil {
				p.eventBus.Publish(bus.Event{
					Type: bus.EventConversationUpdated,
					Data: map[string]interface{}{
						"session_id":          sessionID,
						"claude_session_id":   claudeSessionID,
						"event_type":          "tool_result",
						"tool_result_for_id":  content.ToolUseID,
						"tool_result_content": content.Content,
						"content_type":        "tool_result",
					},
				})
			}

			// Mark the corresponding tool call as completed
			if err := p.store.MarkToolCallCompleted(ctx, content.ToolUseID, sessionID); err != nil {
				slog.Error("failed to mark tool call as completed",
					"tool_id", content.ToolUseID,
					"session_id", sessionID,
					"error", err)
				// Continue anyway - this is not fatal
			}

		case "thinking":
			// Thinking message
			convEvent := &store.ConversationEvent{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeThinking,
				Role:            event.Message.Role,
				Content:         content.Thinking,
			}
			if err := p.store.AddConversationEvent(ctx, convEvent); err != nil {
				return err
			}

			// Publish conversation updated event
			if p.eventBus != nil {
				p.eventBus.Publish(bus.Event{
					Type: bus.EventConversationUpdated,
					Data: map[string]interface{}{
						"session_id":        sessionID,
						"claude_session_id": claudeSessionID,
						"event_type":        "thinking",
						"role":              event.Message.Role,
						"content":           content.Thinking,
						"content_type":      "thinking",
					},
				})
			}
		}
	}

	return nil
}

// processResultEvent handles session completion events
func (p *EventProcessor) processResultEvent(ctx context.Context, sessionID string, event claudecode.StreamEvent) error {
	status := store.SessionStatusCompleted
	if event.IsError {
		status = store.SessionStatusFailed
	}

	now := time.Now()
	update := store.SessionUpdate{
		Status:         &status,
		CompletedAt:    &now,
		LastActivityAt: &now,
		CostUSD:        &event.CostUSD,
		DurationMS:     &event.DurationMS,
	}
	if event.Error != "" {
		update.ErrorMessage = &event.Error
	}

	return p.store.UpdateSession(ctx, sessionID, update)
}

// updateSessionActivity updates the last_activity_at timestamp for a session
func (p *EventProcessor) updateSessionActivity(ctx context.Context, sessionID string) {
	now := time.Now()
	if err := p.store.UpdateSession(ctx, sessionID, store.SessionUpdate{
		LastActivityAt: &now,
	}); err != nil {
		slog.Warn("failed to update session activity timestamp",
			"session_id", sessionID,
			"error", err)
	}
}

// captureFileSnapshot captures full file content for Read tool results
func (p *EventProcessor) captureFileSnapshot(ctx context.Context, sessionID, toolID, toolInputJSON, toolResultContent string) {
	// Parse tool input to get file path
	var input map[string]interface{}
	if err := json.Unmarshal([]byte(toolInputJSON), &input); err != nil {
		slog.Error("failed to parse Read tool input", "error", err)
		return
	}

	filePath, ok := input["file_path"].(string)
	if !ok {
		slog.Error("Read tool input missing file_path")
		return
	}

	// Read tool returns plain text with line numbers, not JSON
	// Check if this is a partial read by looking for limit/offset in input
	_, hasLimit := input["limit"]
	_, hasOffset := input["offset"]
	isPartialRead := hasLimit || hasOffset

	var content string

	// If it's a full read (no limit/offset), we can use the tool result content directly
	if !isPartialRead {
		// Parse the line-numbered format from Read tool
		content = parseReadToolContent(toolResultContent)
		slog.Debug("using full content from Read tool result", "path", filePath)
	} else {
		// Partial read - need to read full file from filesystem
		// Get session to access working directory
		session, err := p.store.GetSession(ctx, sessionID)
		if err != nil {
			slog.Error("failed to get session for snapshot", "error", err)
			return
		}

		// Construct full path for reading
		var fullPath string
		if filepath.IsAbs(filePath) {
			// Path is already absolute
			fullPath = filePath
		} else {
			// Path is relative, join with working directory
			fullPath = filepath.Join(session.WorkingDir, filePath)

			// Verify the constructed path exists
			if _, err := os.Stat(fullPath); err != nil {
				slog.Error("constructed file path does not exist",
					"working_dir", session.WorkingDir,
					"file_path", filePath,
					"full_path", fullPath,
					"error", err)
				return
			}
		}

		// Read file with size limit (10MB)
		const maxFileSize = 10 * 1024 * 1024
		fileInfo, err := os.Stat(fullPath)
		if err != nil {
			slog.Error("failed to stat file for snapshot", "path", fullPath, "error", err)
			return
		}

		if fileInfo.Size() > maxFileSize {
			slog.Warn("file too large for snapshot, using partial content", "path", fullPath, "size", fileInfo.Size())
			// Store partial content from tool result as fallback
			content = parseReadToolContent(toolResultContent)
		} else {
			fileBytes, err := os.ReadFile(fullPath)
			if err != nil {
				slog.Error("failed to read file for snapshot", "path", fullPath, "error", err)
				return
			}
			content = string(fileBytes)
			slog.Debug("read full file content from filesystem", "path", fullPath)
		}
	}

	// Store snapshot with relative path from tool call
	snapshot := &store.FileSnapshot{
		ToolID:    toolID,
		SessionID: sessionID,
		FilePath:  filePath, // Store exactly as provided in tool call
		Content:   content,
	}

	if err := p.store.CreateFileSnapshot(ctx, snapshot); err != nil {
		slog.Error("failed to store file snapshot", "error", err)
	}
}

// parseReadToolContent extracts content from Read tool's line-numbered format
func parseReadToolContent(toolResult string) string {
	lines := strings.Split(toolResult, "\n")
	var contentLines []string

	for _, line := range lines {
		// Find the arrow separator "→"
		if idx := strings.Index(line, "→"); idx > 0 {
			// Extract content after the arrow (UTF-8 aware)
			contentLines = append(contentLines, line[idx+len("→"):])
		}
	}

	return strings.Join(contentLines, "\n")
}
