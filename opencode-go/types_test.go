package opencode

import (
	"encoding/json"
	"testing"
)

func TestStreamEventUnmarshal(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expected    StreamEvent
		expectError bool
	}{
		{
			name: "text event",
			input: `{
				"type": "text",
				"timestamp": 1234567890,
				"sessionID": "session-123",
				"part": {"id": "part-1", "messageID": "msg-1", "type": "text", "text": "Hello world"}
			}`,
			expected: StreamEvent{
				Type:      "text",
				Timestamp: 1234567890,
				SessionID: "session-123",
			},
			expectError: false,
		},
		{
			name: "tool_use event",
			input: `{
				"type": "tool_use",
				"timestamp": 1234567890,
				"sessionID": "session-123",
				"part": {
					"id": "part-2",
					"messageID": "msg-2",
					"type": "tool_use",
					"callID": "call-1",
					"tool": "bash",
					"state": {"status": "pending", "input": {"command": "ls -la"}}
				}
			}`,
			expected: StreamEvent{
				Type:      "tool_use",
				Timestamp: 1234567890,
				SessionID: "session-123",
			},
			expectError: false,
		},
		{
			name: "step_finish event with tokens",
			input: `{
				"type": "step_finish",
				"timestamp": 1234567890,
				"sessionID": "session-123",
				"part": {
					"id": "part-3",
					"messageID": "msg-3",
					"type": "step_finish",
					"reason": "completed",
					"cost": 0.0025,
					"tokens": {"input": 100, "output": 50, "reasoning": 0}
				}
			}`,
			expected: StreamEvent{
				Type:      "step_finish",
				Timestamp: 1234567890,
				SessionID: "session-123",
			},
			expectError: false,
		},
		{
			name: "step_start event",
			input: `{
				"type": "step_start",
				"timestamp": 1234567890,
				"sessionID": "session-123",
				"part": {"id": "part-4", "messageID": "msg-4", "type": "step_start"}
			}`,
			expected: StreamEvent{
				Type:      "step_start",
				Timestamp: 1234567890,
				SessionID: "session-123",
			},
			expectError: false,
		},
		{
			name:        "empty JSON",
			input:       `{}`,
			expected:    StreamEvent{},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var event StreamEvent
			err := json.Unmarshal([]byte(tt.input), &event)

			if (err != nil) != tt.expectError {
				t.Errorf("StreamEvent.Unmarshal() error = %v, expectError %v", err, tt.expectError)
				return
			}

			if event.Type != tt.expected.Type {
				t.Errorf("StreamEvent.Type = %v, want %v", event.Type, tt.expected.Type)
			}

			if event.SessionID != tt.expected.SessionID {
				t.Errorf("StreamEvent.SessionID = %v, want %v", event.SessionID, tt.expected.SessionID)
			}

			if event.Timestamp != tt.expected.Timestamp {
				t.Errorf("StreamEvent.Timestamp = %v, want %v", event.Timestamp, tt.expected.Timestamp)
			}
		})
	}
}

func TestEventPartUnmarshal(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expected    EventPart
		expectError bool
	}{
		{
			name: "text part",
			input: `{
				"id": "part-1",
				"sessionID": "session-123",
				"messageID": "msg-1",
				"type": "text",
				"text": "Hello, world!"
			}`,
			expected: EventPart{
				ID:        "part-1",
				SessionID: "session-123",
				MessageID: "msg-1",
				Type:      "text",
				Text:      "Hello, world!",
			},
			expectError: false,
		},
		{
			name: "tool_use part with state",
			input: `{
				"id": "part-2",
				"sessionID": "session-123",
				"messageID": "msg-2",
				"type": "tool_use",
				"callID": "call-1",
				"tool": "read",
				"title": "Reading file",
				"state": {
					"status": "completed",
					"input": {"filePath": "/tmp/test.txt"},
					"output": "file contents here"
				}
			}`,
			expected: EventPart{
				ID:        "part-2",
				SessionID: "session-123",
				MessageID: "msg-2",
				Type:      "tool_use",
				CallID:    "call-1",
				Tool:      "read",
				Title:     "Reading file",
				State: &ToolState{
					Status: "completed",
					Input:  map[string]interface{}{"filePath": "/tmp/test.txt"},
					Output: "file contents here",
				},
			},
			expectError: false,
		},
		{
			name: "step_finish part with tokens",
			input: `{
				"id": "part-3",
				"sessionID": "session-123",
				"messageID": "msg-3",
				"type": "step_finish",
				"reason": "completed",
				"cost": 0.0025,
				"tokens": {
					"input": 150,
					"output": 75,
					"reasoning": 10,
					"cache": {"read": 50, "write": 25}
				}
			}`,
			expected: EventPart{
				ID:        "part-3",
				SessionID: "session-123",
				MessageID: "msg-3",
				Type:      "step_finish",
				Reason:    "completed",
				Cost:      0.0025,
				Tokens: &TokenUsage{
					Input:     150,
					Output:    75,
					Reasoning: 10,
					Cache:     &CacheUsage{Read: 50, Write: 25},
				},
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var part EventPart
			err := json.Unmarshal([]byte(tt.input), &part)

			if (err != nil) != tt.expectError {
				t.Errorf("EventPart.Unmarshal() error = %v, expectError %v", err, tt.expectError)
				return
			}

			if part.ID != tt.expected.ID {
				t.Errorf("EventPart.ID = %v, want %v", part.ID, tt.expected.ID)
			}

			if part.SessionID != tt.expected.SessionID {
				t.Errorf("EventPart.SessionID = %v, want %v", part.SessionID, tt.expected.SessionID)
			}

			if part.MessageID != tt.expected.MessageID {
				t.Errorf("EventPart.MessageID = %v, want %v", part.MessageID, tt.expected.MessageID)
			}

			if part.Type != tt.expected.Type {
				t.Errorf("EventPart.Type = %v, want %v", part.Type, tt.expected.Type)
			}

			if part.Text != tt.expected.Text {
				t.Errorf("EventPart.Text = %v, want %v", part.Text, tt.expected.Text)
			}

			if part.CallID != tt.expected.CallID {
				t.Errorf("EventPart.CallID = %v, want %v", part.CallID, tt.expected.CallID)
			}

			if part.Tool != tt.expected.Tool {
				t.Errorf("EventPart.Tool = %v, want %v", part.Tool, tt.expected.Tool)
			}

			if part.Reason != tt.expected.Reason {
				t.Errorf("EventPart.Reason = %v, want %v", part.Reason, tt.expected.Reason)
			}

			if part.Cost != tt.expected.Cost {
				t.Errorf("EventPart.Cost = %v, want %v", part.Cost, tt.expected.Cost)
			}

			// Check State
			if tt.expected.State != nil {
				if part.State == nil {
					t.Errorf("EventPart.State is nil, expected non-nil")
				} else {
					if part.State.Status != tt.expected.State.Status {
						t.Errorf("EventPart.State.Status = %v, want %v", part.State.Status, tt.expected.State.Status)
					}
					if part.State.Output != tt.expected.State.Output {
						t.Errorf("EventPart.State.Output = %v, want %v", part.State.Output, tt.expected.State.Output)
					}
				}
			}

			// Check Tokens
			if tt.expected.Tokens != nil {
				if part.Tokens == nil {
					t.Errorf("EventPart.Tokens is nil, expected non-nil")
				} else {
					if part.Tokens.Input != tt.expected.Tokens.Input {
						t.Errorf("EventPart.Tokens.Input = %v, want %v", part.Tokens.Input, tt.expected.Tokens.Input)
					}
					if part.Tokens.Output != tt.expected.Tokens.Output {
						t.Errorf("EventPart.Tokens.Output = %v, want %v", part.Tokens.Output, tt.expected.Tokens.Output)
					}
					if tt.expected.Tokens.Cache != nil {
						if part.Tokens.Cache == nil {
							t.Errorf("EventPart.Tokens.Cache is nil, expected non-nil")
						} else {
							if part.Tokens.Cache.Read != tt.expected.Tokens.Cache.Read {
								t.Errorf("EventPart.Tokens.Cache.Read = %v, want %v", part.Tokens.Cache.Read, tt.expected.Tokens.Cache.Read)
							}
						}
					}
				}
			}
		})
	}
}

func TestToolStateUnmarshal(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expected    ToolState
		expectError bool
	}{
		{
			name: "pending state",
			input: `{
				"status": "pending",
				"input": {"command": "ls -la"}
			}`,
			expected: ToolState{
				Status: "pending",
				Input:  map[string]interface{}{"command": "ls -la"},
			},
			expectError: false,
		},
		{
			name: "completed state with output",
			input: `{
				"status": "completed",
				"input": {"filePath": "/tmp/test.txt"},
				"output": "file contents:\nline1\nline2"
			}`,
			expected: ToolState{
				Status: "completed",
				Input:  map[string]interface{}{"filePath": "/tmp/test.txt"},
				Output: "file contents:\nline1\nline2",
			},
			expectError: false,
		},
		{
			name: "error state",
			input: `{
				"status": "error",
				"input": {"command": "invalid-cmd"},
				"output": "command not found: invalid-cmd"
			}`,
			expected: ToolState{
				Status: "error",
				Input:  map[string]interface{}{"command": "invalid-cmd"},
				Output: "command not found: invalid-cmd",
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var state ToolState
			err := json.Unmarshal([]byte(tt.input), &state)

			if (err != nil) != tt.expectError {
				t.Errorf("ToolState.Unmarshal() error = %v, expectError %v", err, tt.expectError)
				return
			}

			if state.Status != tt.expected.Status {
				t.Errorf("ToolState.Status = %v, want %v", state.Status, tt.expected.Status)
			}

			if state.Output != tt.expected.Output {
				t.Errorf("ToolState.Output = %v, want %v", state.Output, tt.expected.Output)
			}
		})
	}
}

func TestResultUnmarshal(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expected    Result
		expectError bool
	}{
		{
			name: "successful result",
			input: `{
				"session_id": "session-123",
				"result": "Task completed successfully",
				"is_error": false,
				"total_cost": 0.0125,
				"duration_ms": 5000,
				"num_turns": 3,
				"total_input_tokens": 1500,
				"total_output_tokens": 500
			}`,
			expected: Result{
				SessionID:         "session-123",
				Result:            "Task completed successfully",
				IsError:           false,
				TotalCost:         0.0125,
				DurationMS:        5000,
				NumTurns:          3,
				TotalInputTokens:  1500,
				TotalOutputTokens: 500,
			},
			expectError: false,
		},
		{
			name: "error result",
			input: `{
				"session_id": "session-456",
				"result": "",
				"is_error": true,
				"error": "API rate limit exceeded",
				"total_cost": 0.001,
				"duration_ms": 100,
				"num_turns": 1,
				"total_input_tokens": 50,
				"total_output_tokens": 0
			}`,
			expected: Result{
				SessionID:         "session-456",
				Result:            "",
				IsError:           true,
				Error:             "API rate limit exceeded",
				TotalCost:         0.001,
				DurationMS:        100,
				NumTurns:          1,
				TotalInputTokens:  50,
				TotalOutputTokens: 0,
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var result Result
			err := json.Unmarshal([]byte(tt.input), &result)

			if (err != nil) != tt.expectError {
				t.Errorf("Result.Unmarshal() error = %v, expectError %v", err, tt.expectError)
				return
			}

			if result.SessionID != tt.expected.SessionID {
				t.Errorf("Result.SessionID = %v, want %v", result.SessionID, tt.expected.SessionID)
			}

			if result.Result != tt.expected.Result {
				t.Errorf("Result.Result = %v, want %v", result.Result, tt.expected.Result)
			}

			if result.IsError != tt.expected.IsError {
				t.Errorf("Result.IsError = %v, want %v", result.IsError, tt.expected.IsError)
			}

			if result.Error != tt.expected.Error {
				t.Errorf("Result.Error = %v, want %v", result.Error, tt.expected.Error)
			}

			if result.TotalCost != tt.expected.TotalCost {
				t.Errorf("Result.TotalCost = %v, want %v", result.TotalCost, tt.expected.TotalCost)
			}

			if result.DurationMS != tt.expected.DurationMS {
				t.Errorf("Result.DurationMS = %v, want %v", result.DurationMS, tt.expected.DurationMS)
			}

			if result.NumTurns != tt.expected.NumTurns {
				t.Errorf("Result.NumTurns = %v, want %v", result.NumTurns, tt.expected.NumTurns)
			}

			if result.TotalInputTokens != tt.expected.TotalInputTokens {
				t.Errorf("Result.TotalInputTokens = %v, want %v", result.TotalInputTokens, tt.expected.TotalInputTokens)
			}

			if result.TotalOutputTokens != tt.expected.TotalOutputTokens {
				t.Errorf("Result.TotalOutputTokens = %v, want %v", result.TotalOutputTokens, tt.expected.TotalOutputTokens)
			}
		})
	}
}

func TestSessionErrorHandling(t *testing.T) {
	session := &Session{}

	// Test setting error
	err1 := json.Unmarshal([]byte("invalid"), nil)
	session.SetError(err1)

	if session.Error() == nil {
		t.Error("Expected error to be set, got nil")
	}

	// Test that second error doesn't overwrite first
	err2 := json.Unmarshal([]byte("another invalid"), nil)
	session.SetError(err2)

	if session.Error() != err1 {
		t.Errorf("Expected first error to be preserved, got different error")
	}
}

func TestTokenUsageUnmarshal(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expected    TokenUsage
		expectError bool
	}{
		{
			name: "full token usage",
			input: `{
				"input": 1000,
				"output": 500,
				"reasoning": 100,
				"cache": {"read": 200, "write": 50}
			}`,
			expected: TokenUsage{
				Input:     1000,
				Output:    500,
				Reasoning: 100,
				Cache:     &CacheUsage{Read: 200, Write: 50},
			},
			expectError: false,
		},
		{
			name: "minimal token usage",
			input: `{
				"input": 100,
				"output": 50
			}`,
			expected: TokenUsage{
				Input:  100,
				Output: 50,
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var usage TokenUsage
			err := json.Unmarshal([]byte(tt.input), &usage)

			if (err != nil) != tt.expectError {
				t.Errorf("TokenUsage.Unmarshal() error = %v, expectError %v", err, tt.expectError)
				return
			}

			if usage.Input != tt.expected.Input {
				t.Errorf("TokenUsage.Input = %v, want %v", usage.Input, tt.expected.Input)
			}

			if usage.Output != tt.expected.Output {
				t.Errorf("TokenUsage.Output = %v, want %v", usage.Output, tt.expected.Output)
			}

			if usage.Reasoning != tt.expected.Reasoning {
				t.Errorf("TokenUsage.Reasoning = %v, want %v", usage.Reasoning, tt.expected.Reasoning)
			}

			if tt.expected.Cache != nil {
				if usage.Cache == nil {
					t.Errorf("TokenUsage.Cache is nil, expected non-nil")
				} else {
					if usage.Cache.Read != tt.expected.Cache.Read {
						t.Errorf("TokenUsage.Cache.Read = %v, want %v", usage.Cache.Read, tt.expected.Cache.Read)
					}
					if usage.Cache.Write != tt.expected.Cache.Write {
						t.Errorf("TokenUsage.Cache.Write = %v, want %v", usage.Cache.Write, tt.expected.Cache.Write)
					}
				}
			}
		})
	}
}
