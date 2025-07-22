package session

import (
	"context"
	"encoding/json"
	"testing"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestEventProcessor_ProcessStreamEvent(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	processor := NewEventProcessor(mockStore, mockEventBus)
	ctx := context.Background()
	sessionID := "test-session"
	claudeSessionID := "claude-session-123"

	t.Run("processes system session_created event", func(t *testing.T) {
		event := claudecode.StreamEvent{
			Type:      "system",
			Subtype:   "session_created",
			SessionID: claudeSessionID,
		}

		expectedConvEvent := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeSystem,
			Role:            "system",
			Content:         "Session created with ID: " + claudeSessionID,
		}

		mockStore.EXPECT().AddConversationEvent(ctx, expectedConvEvent).Return(nil)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)
		mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(e bus.Event) {
			assert.Equal(t, bus.EventConversationUpdated, e.Type)
			assert.Equal(t, sessionID, e.Data["session_id"])
			assert.Equal(t, claudeSessionID, e.Data["claude_session_id"])
			assert.Equal(t, "system", e.Data["event_type"])
		})

		err := processor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event)
		assert.NoError(t, err)
	})

	t.Run("processes init event with model detection", func(t *testing.T) {
		event := claudecode.StreamEvent{
			Type:    "system",
			Subtype: "init",
			Model:   "anthropic.claude-3-opus-20240229",
		}

		dbSession := &store.Session{
			ID:    sessionID,
			Model: "", // Empty model
		}

		mockStore.EXPECT().GetSession(ctx, sessionID).Return(dbSession, nil)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Model)
			assert.Equal(t, "opus", *update.Model)
		}).Return(nil)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil) // For activity update

		err := processor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event)
		assert.NoError(t, err)
	})

	t.Run("processes text message event", func(t *testing.T) {
		event := claudecode.StreamEvent{
			Type: "assistant",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{
						Type: "text",
						Text: "Hello, how can I help you?",
					},
				},
			},
		}

		expectedConvEvent := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeMessage,
			Role:            "assistant",
			Content:         "Hello, how can I help you?",
		}

		mockStore.EXPECT().AddConversationEvent(ctx, expectedConvEvent).Return(nil)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)
		mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(e bus.Event) {
			assert.Equal(t, bus.EventConversationUpdated, e.Type)
			assert.Equal(t, "message", e.Data["event_type"])
			assert.Equal(t, "assistant", e.Data["role"])
			assert.Equal(t, "Hello, how can I help you?", e.Data["content"])
		})

		err := processor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event)
		assert.NoError(t, err)
	})

	t.Run("processes tool_use event", func(t *testing.T) {
		toolInput := map[string]interface{}{
			"file_path": "/test/file.txt",
		}
		event := claudecode.StreamEvent{
			Type:            "assistant",
			ParentToolUseID: "parent-tool-123",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{
						Type:  "tool_use",
						ID:    "tool-123",
						Name:  "Read",
						Input: toolInput,
					},
				},
			},
		}

		inputJSON, _ := json.Marshal(toolInput)
		expectedConvEvent := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeToolCall,
			ToolID:          "tool-123",
			ToolName:        "Read",
			ToolInputJSON:   string(inputJSON),
			ParentToolUseID: "parent-tool-123",
		}

		mockStore.EXPECT().AddConversationEvent(ctx, expectedConvEvent).Return(nil)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)
		mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(e bus.Event) {
			assert.Equal(t, bus.EventConversationUpdated, e.Type)
			assert.Equal(t, "tool_call", e.Data["event_type"])
			assert.Equal(t, "tool-123", e.Data["tool_id"])
			assert.Equal(t, "Read", e.Data["tool_name"])
		})

		err := processor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event)
		assert.NoError(t, err)
	})

	t.Run("processes tool_result event", func(t *testing.T) {
		event := claudecode.StreamEvent{
			Type: "user",
			Message: &claudecode.Message{
				Role: "user",
				Content: []claudecode.Content{
					{
						Type:      "tool_result",
						ToolUseID: "tool-123",
						Content:   "File content here",
					},
				},
			},
		}

		expectedConvEvent := &store.ConversationEvent{
			SessionID:         sessionID,
			ClaudeSessionID:   claudeSessionID,
			EventType:         store.EventTypeToolResult,
			Role:              "user",
			ToolResultForID:   "tool-123",
			ToolResultContent: "File content here",
		}

		// Mock for the main event processing
		mockStore.EXPECT().AddConversationEvent(ctx, expectedConvEvent).Return(nil)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)
		mockEventBus.EXPECT().Publish(gomock.Any())
		mockStore.EXPECT().MarkToolCallCompleted(ctx, "tool-123", sessionID).Return(nil)

		// Mock for GetToolCallByID (for file snapshot logic)
		mockStore.EXPECT().GetToolCallByID(ctx, "tool-123").Return(&store.ConversationEvent{
			ToolName: "NotRead", // Not a Read tool, so no snapshot
		}, nil)

		err := processor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event)
		assert.NoError(t, err)
	})

	t.Run("processes thinking event", func(t *testing.T) {
		event := claudecode.StreamEvent{
			Type: "assistant",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{
						Type:     "thinking",
						Thinking: "Let me think about this...",
					},
				},
			},
		}

		expectedConvEvent := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeThinking,
			Role:            "assistant",
			Content:         "Let me think about this...",
		}

		mockStore.EXPECT().AddConversationEvent(ctx, expectedConvEvent).Return(nil)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)
		mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(e bus.Event) {
			assert.Equal(t, bus.EventConversationUpdated, e.Type)
			assert.Equal(t, "thinking", e.Data["event_type"])
			assert.Equal(t, "assistant", e.Data["role"])
			assert.Equal(t, "Let me think about this...", e.Data["content"])
		})

		err := processor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event)
		assert.NoError(t, err)
	})

	t.Run("processes result event for completion", func(t *testing.T) {
		event := claudecode.StreamEvent{
			Type:       "result",
			IsError:    false,
			CostUSD:    0.05,
			DurationMS: 10000,
		}

		expectedStatus := store.SessionStatusCompleted
		// First call from processResultEvent
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, expectedStatus, *update.Status)
			assert.NotNil(t, update.CostUSD)
			assert.Equal(t, 0.05, *update.CostUSD)
			assert.NotNil(t, update.DurationMS)
			assert.Equal(t, 10000, *update.DurationMS)
		}).Return(nil)
		// Second call from updateSessionActivity (deferred)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.LastActivityAt)
		}).Return(nil)

		err := processor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event)
		assert.NoError(t, err)
	})

	t.Run("processes result event for failure", func(t *testing.T) {
		event := claudecode.StreamEvent{
			Type:    "result",
			IsError: true,
			Error:   "Some error occurred",
		}

		expectedStatus := store.SessionStatusFailed
		// First call from processResultEvent
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, expectedStatus, *update.Status)
			assert.NotNil(t, update.ErrorMessage)
			assert.Equal(t, "Some error occurred", *update.ErrorMessage)
		}).Return(nil)
		// Second call from updateSessionActivity (deferred)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.LastActivityAt)
		}).Return(nil)

		err := processor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event)
		assert.NoError(t, err)
	})

	t.Run("skips events without claude session ID", func(t *testing.T) {
		event := claudecode.StreamEvent{
			Type: "system",
		}

		// No expectations on store or event bus - should return early

		err := processor.ProcessStreamEvent(ctx, sessionID, "", event)
		assert.NoError(t, err)
	})
}

func TestParseReadToolContent(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name: "parses line-numbered content",
			input: `     1→This is line 1
     2→This is line 2
     3→This is line 3`,
			expected: "This is line 1\nThis is line 2\nThis is line 3",
		},
		{
			name:     "handles empty input",
			input:    "",
			expected: "",
		},
		{
			name: "handles lines without arrows",
			input: `This line has no arrow
     1→This line has arrow
Another line without`,
			expected: "This line has arrow",
		},
		{
			name: "handles UTF-8 content",
			input: `     1→Unicode: 你好世界 🌍
     2→More text`,
			expected: "Unicode: 你好世界 🌍\nMore text",
		},
		{
			name: "handles empty lines after arrow",
			input: `     1→
     2→Some content
     3→`,
			expected: "\nSome content\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseReadToolContent(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestEventProcessor_CaptureFileSnapshot(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	processor := NewEventProcessor(mockStore, nil)
	ctx := context.Background()
	sessionID := "test-session"
	toolID := "tool-123"

	t.Run("captures full file content for non-partial read", func(t *testing.T) {
		toolInput := map[string]interface{}{
			"file_path": "/test/file.txt",
		}
		toolInputJSON, _ := json.Marshal(toolInput)
		toolResultContent := `     1→Line 1 content
     2→Line 2 content`

		expectedSnapshot := &store.FileSnapshot{
			ToolID:    toolID,
			SessionID: sessionID,
			FilePath:  "/test/file.txt",
			Content:   "Line 1 content\nLine 2 content",
		}

		mockStore.EXPECT().CreateFileSnapshot(ctx, expectedSnapshot).Return(nil)

		// Run in same goroutine for testing
		processor.captureFileSnapshot(ctx, sessionID, toolID, string(toolInputJSON), toolResultContent)
	})

	t.Run("handles invalid JSON in tool input", func(t *testing.T) {
		// Invalid JSON should log error and return early
		// No store expectations

		processor.captureFileSnapshot(ctx, sessionID, toolID, "invalid json", "some content")
	})

	t.Run("handles missing file_path in tool input", func(t *testing.T) {
		toolInput := map[string]interface{}{
			"other_field": "value",
		}
		toolInputJSON, _ := json.Marshal(toolInput)

		// No store expectations - should return early

		processor.captureFileSnapshot(ctx, sessionID, toolID, string(toolInputJSON), "some content")
	})
}

func TestEventProcessor_UpdateSessionActivity(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	processor := NewEventProcessor(mockStore, nil)
	ctx := context.Background()
	sessionID := "test-session"

	t.Run("updates session activity timestamp", func(t *testing.T) {
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			require.NotNil(t, update.LastActivityAt)
		}).Return(nil)

		processor.updateSessionActivity(ctx, sessionID)
	})

	t.Run("logs warning on update failure", func(t *testing.T) {
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(assert.AnError)

		// Should not panic, just log warning
		processor.updateSessionActivity(ctx, sessionID)
	})
}
