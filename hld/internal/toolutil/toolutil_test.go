package toolutil

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsAskUserQuestionTool(t *testing.T) {
	tests := []struct {
		name     string
		toolName string
		expected bool
	}{
		{"exact short name", "ask_user_question", true},
		{"built-in tool name", "AskUserQuestion", true},
		{"MCP codelayer namespaced", "mcp__codelayer__ask_user_question", true},
		{"MCP other namespace", "mcp__custom__ask_user_question", true},
		{"unrelated tool", "Bash", false},
		{"partial match", "ask_user", false},
		{"suffix without separator", "notask_user_question", false},
		{"empty string", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, IsAskUserQuestionTool(tt.toolName))
		})
	}
}
