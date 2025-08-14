package claudecode

import (
	"encoding/json"
	"testing"
)

func TestContentFieldUnmarshal(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
		wantErr  bool
	}{
		{
			name:     "string content",
			input:    `"simple string content"`,
			expected: "simple string content",
			wantErr:  false,
		},
		{
			name:     "array content with single text",
			input:    `[{"type": "text", "text": "array content"}]`,
			expected: "array content",
			wantErr:  false,
		},
		{
			name:     "array content with multiple texts",
			input:    `[{"type": "text", "text": "line1"}, {"type": "text", "text": "line2"}]`,
			expected: "line1\nline2",
			wantErr:  false,
		},
		{
			name:     "array content with non-text types filtered",
			input:    `[{"type": "image", "text": "ignored"}, {"type": "text", "text": "kept"}]`,
			expected: "kept",
			wantErr:  false,
		},
		{
			name:     "empty array",
			input:    `[]`,
			expected: "",
			wantErr:  false,
		},
		{
			name:     "empty string",
			input:    `""`,
			expected: "",
			wantErr:  false,
		},
		{
			name:     "null value",
			input:    `null`,
			expected: "",
			wantErr:  false,
		},
		{
			name:     "invalid content format - object",
			input:    `{"invalid": "object"}`,
			expected: "",
			wantErr:  true,
		},
		{
			name:     "invalid content format - number",
			input:    `12345`,
			expected: "",
			wantErr:  true,
		},
		{
			name:     "invalid content format - boolean",
			input:    `true`,
			expected: "",
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var c ContentField
			err := json.Unmarshal([]byte(tt.input), &c)

			if (err != nil) != tt.wantErr {
				t.Errorf("ContentField.UnmarshalJSON() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if c.Value != tt.expected {
				t.Errorf("ContentField.UnmarshalJSON() = %v, want %v", c.Value, tt.expected)
			}
		})
	}
}

func TestContentFieldMarshal(t *testing.T) {
	tests := []struct {
		name     string
		field    ContentField
		expected string
	}{
		{
			name:     "marshal simple string",
			field:    ContentField{Value: "test content"},
			expected: `"test content"`,
		},
		{
			name:     "marshal empty string",
			field:    ContentField{Value: ""},
			expected: `""`,
		},
		{
			name:     "marshal multiline string",
			field:    ContentField{Value: "line1\nline2"},
			expected: `"line1\nline2"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := json.Marshal(tt.field)
			if err != nil {
				t.Errorf("ContentField.MarshalJSON() error = %v", err)
				return
			}

			if string(result) != tt.expected {
				t.Errorf("ContentField.MarshalJSON() = %v, want %v", string(result), tt.expected)
			}
		})
	}
}

func TestContentStructWithContentField(t *testing.T) {
	// Test the full Content struct with ContentField
	tests := []struct {
		name     string
		input    string
		expected Content
		wantErr  bool
	}{
		{
			name: "tool result with string content",
			input: `{
				"type": "tool_result",
				"tool_use_id": "tool_123",
				"content": "Tool execution successful"
			}`,
			expected: Content{
				Type:      "tool_result",
				ToolUseID: "tool_123",
				Content:   ContentField{Value: "Tool execution successful"},
			},
			wantErr: false,
		},
		{
			name: "tool result with array content (Task tool format)",
			input: `{
				"type": "tool_result",
				"tool_use_id": "task_456",
				"content": [{"type": "text", "text": "Task completed successfully"}]
			}`,
			expected: Content{
				Type:      "tool_result",
				ToolUseID: "task_456",
				Content:   ContentField{Value: "Task completed successfully"},
			},
			wantErr: false,
		},
		{
			name: "text content without tool result",
			input: `{
				"type": "text",
				"text": "Regular text content"
			}`,
			expected: Content{
				Type: "text",
				Text: "Regular text content",
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var c Content
			err := json.Unmarshal([]byte(tt.input), &c)

			if (err != nil) != tt.wantErr {
				t.Errorf("Content unmarshal error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if c.Type != tt.expected.Type {
				t.Errorf("Content.Type = %v, want %v", c.Type, tt.expected.Type)
			}

			if c.ToolUseID != tt.expected.ToolUseID {
				t.Errorf("Content.ToolUseID = %v, want %v", c.ToolUseID, tt.expected.ToolUseID)
			}

			if c.Content.Value != tt.expected.Content.Value {
				t.Errorf("Content.Content.Value = %v, want %v", c.Content.Value, tt.expected.Content.Value)
			}

			if c.Text != tt.expected.Text {
				t.Errorf("Content.Text = %v, want %v", c.Text, tt.expected.Text)
			}
		})
	}
}

func TestPermissionDenialsUnmarshal(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		expectDenials []PermissionDenial
		expectError   bool
	}{
		{
			name: "object array format",
			input: `[{
				"tool_name": "Bash",
				"tool_use_id": "toolu_01M6qJZgpwjmzg14TBS5Mwhm",
				"tool_input": {"command": "git fetch origin main"}
			}]`,
			expectDenials: []PermissionDenial{{
				ToolName:  "Bash",
				ToolUseID: "toolu_01M6qJZgpwjmzg14TBS5Mwhm",
				ToolInput: map[string]interface{}{"command": "git fetch origin main"},
			}},
			expectError: false,
		},
		{
			name: "multiple denials",
			input: `[
				{"tool_name": "Bash", "tool_use_id": "tool_1", "tool_input": {"command": "rm -rf /"}},
				{"tool_name": "Write", "tool_use_id": "tool_2", "tool_input": {"path": "/etc/passwd"}}
			]`,
			expectDenials: []PermissionDenial{
				{ToolName: "Bash", ToolUseID: "tool_1", ToolInput: map[string]interface{}{"command": "rm -rf /"}},
				{ToolName: "Write", ToolUseID: "tool_2", ToolInput: map[string]interface{}{"path": "/etc/passwd"}},
			},
			expectError: false,
		},
		{
			name:          "legacy string array format",
			input:         `["Bash", "Write", "Delete"]`,
			expectDenials: []PermissionDenial{{ToolName: "Bash"}, {ToolName: "Write"}, {ToolName: "Delete"}},
			expectError:   false,
		},
		{
			name:          "empty array",
			input:         `[]`,
			expectDenials: []PermissionDenial{},
			expectError:   false,
		},
		{
			name:          "null value",
			input:         `null`,
			expectDenials: nil,
			expectError:   false,
		},
		{
			name:        "invalid format - plain object",
			input:       `{"tool_name": "Bash"}`,
			expectError: true,
		},
		{
			name:        "invalid format - number",
			input:       `123`,
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var p PermissionDenials
			err := json.Unmarshal([]byte(tt.input), &p)

			if (err != nil) != tt.expectError {
				t.Errorf("PermissionDenials.UnmarshalJSON() error = %v, expectError %v", err, tt.expectError)
				return
			}

			if !tt.expectError {
				if len(p.Denials) != len(tt.expectDenials) {
					t.Errorf("PermissionDenials.UnmarshalJSON() got %d denials, want %d", len(p.Denials), len(tt.expectDenials))
					return
				}

				for i, denial := range p.Denials {
					if denial.ToolName != tt.expectDenials[i].ToolName {
						t.Errorf("Denial[%d].ToolName = %v, want %v", i, denial.ToolName, tt.expectDenials[i].ToolName)
					}
					if denial.ToolUseID != tt.expectDenials[i].ToolUseID {
						t.Errorf("Denial[%d].ToolUseID = %v, want %v", i, denial.ToolUseID, tt.expectDenials[i].ToolUseID)
					}
				}
			}
		})
	}
}

func TestPermissionDenialsToStrings(t *testing.T) {
	p := PermissionDenials{
		Denials: []PermissionDenial{
			{ToolName: "Bash"},
			{ToolName: "Write"},
		},
	}

	strings := p.ToStrings()
	expected := []string{"Bash", "Write"}

	if len(strings) != len(expected) {
		t.Errorf("ToStrings() returned %d items, want %d", len(strings), len(expected))
	}

	for i, s := range strings {
		if s != expected[i] {
			t.Errorf("ToStrings()[%d] = %v, want %v", i, s, expected[i])
		}
	}
}
