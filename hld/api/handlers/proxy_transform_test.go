package handlers

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTransformAnthropicToOpenAI_ToolsFormat(t *testing.T) {
	handler := &ProxyHandler{}

	anthropicReq := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{
				"role":    "user",
				"content": "What's the weather?",
			},
		},
		"tools": []interface{}{
			map[string]interface{}{
				"name":        "get_weather",
				"description": "Get current weather",
				"input_schema": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"location": map[string]interface{}{
							"type": "string",
						},
					},
				},
			},
		},
	}

	session := map[string]interface{}{
		"id": "test-session",
	}

	result := handler.transformAnthropicToOpenAI(anthropicReq, session)

	// Verify tools format
	tools, ok := result["tools"].([]interface{})
	assert.True(t, ok, "should have tools field")
	assert.Len(t, tools, 1)

	tool := tools[0].(map[string]interface{})
	assert.Equal(t, "function", tool["type"])

	function := tool["function"].(map[string]interface{})
	assert.Equal(t, "get_weather", function["name"])
	assert.Equal(t, "Get current weather", function["description"])

	// Verify tool_choice is set
	assert.Equal(t, "auto", result["tool_choice"])
}

func TestTransformAnthropicToOpenAI_BatchToolFiltered(t *testing.T) {
	handler := &ProxyHandler{}

	anthropicReq := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{
				"role":    "user",
				"content": "Execute batch",
			},
		},
		"tools": []interface{}{
			map[string]interface{}{
				"name":        "BatchTool",
				"description": "Internal batch tool",
				"input_schema": map[string]interface{}{
					"type": "object",
				},
			},
			map[string]interface{}{
				"name":        "real_tool",
				"description": "A real tool",
				"input_schema": map[string]interface{}{
					"type": "object",
				},
			},
		},
	}

	session := map[string]interface{}{
		"id": "test-session",
	}

	result := handler.transformAnthropicToOpenAI(anthropicReq, session)

	// Verify BatchTool is filtered out
	tools, ok := result["tools"].([]interface{})
	assert.True(t, ok, "should have tools field")
	assert.Len(t, tools, 1, "BatchTool should be filtered out")

	tool := tools[0].(map[string]interface{})
	function := tool["function"].(map[string]interface{})
	assert.Equal(t, "real_tool", function["name"])
}

func TestTransformAnthropicToOpenAI_ToolChoice(t *testing.T) {
	handler := &ProxyHandler{}

	testCases := []struct {
		name           string
		toolChoice     interface{}
		expectedChoice interface{}
	}{
		{
			name: "specific tool choice",
			toolChoice: map[string]interface{}{
				"type": "tool",
				"name": "get_weather",
			},
			expectedChoice: map[string]interface{}{
				"type": "function",
				"function": map[string]interface{}{
					"name": "get_weather",
				},
			},
		},
		{
			name: "any tool choice",
			toolChoice: map[string]interface{}{
				"type": "any",
			},
			expectedChoice: "auto",
		},
		{
			name: "no tool choice",
			toolChoice: map[string]interface{}{
				"type": "none",
			},
			expectedChoice: "none",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			anthropicReq := map[string]interface{}{
				"messages": []interface{}{
					map[string]interface{}{
						"role":    "user",
						"content": "Test",
					},
				},
				"tools": []interface{}{
					map[string]interface{}{
						"name":        "get_weather",
						"description": "Get weather",
						"input_schema": map[string]interface{}{
							"type": "object",
						},
					},
				},
				"tool_choice": tc.toolChoice,
			}

			session := map[string]interface{}{
				"id": "test-session",
			}

			result := handler.transformAnthropicToOpenAI(anthropicReq, session)
			assert.Equal(t, tc.expectedChoice, result["tool_choice"])
		})
	}
}

func TestTransformAnthropicToOpenAI_RemoveURIFormat(t *testing.T) {
	handler := &ProxyHandler{}

	anthropicReq := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{
				"role":    "user",
				"content": "Test URI format removal",
			},
		},
		"tools": []interface{}{
			map[string]interface{}{
				"name":        "test_tool",
				"description": "Test tool",
				"input_schema": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"url": map[string]interface{}{
							"type":   "string",
							"format": "uri",
						},
						"normal_string": map[string]interface{}{
							"type": "string",
						},
					},
				},
			},
		},
	}

	session := map[string]interface{}{
		"id": "test-session",
	}

	result := handler.transformAnthropicToOpenAI(anthropicReq, session)

	// Verify tools format
	tools, ok := result["tools"].([]interface{})
	require.True(t, ok, "should have tools field")
	require.Len(t, tools, 1)

	tool := tools[0].(map[string]interface{})
	function := tool["function"].(map[string]interface{})
	params := function["parameters"].(map[string]interface{})
	props := params["properties"].(map[string]interface{})

	// Check URI format is removed
	urlProp := props["url"].(map[string]interface{})
	_, hasFormat := urlProp["format"]
	assert.False(t, hasFormat, "format:uri should be removed")

	// Check normal string is unchanged
	normalProp := props["normal_string"].(map[string]interface{})
	assert.Equal(t, "string", normalProp["type"])
}

func TestMapStopReason(t *testing.T) {
	testCases := []struct {
		openaiReason   string
		expectedReason string
	}{
		{"tool_calls", "tool_use"},
		{"stop", "end_turn"},
		{"length", "max_tokens"},
		{"unknown", "end_turn"},
		{"", "end_turn"},
	}

	for _, tc := range testCases {
		t.Run(tc.openaiReason, func(t *testing.T) {
			result := mapStopReason(tc.openaiReason)
			assert.Equal(t, tc.expectedReason, result)
		})
	}
}

func TestTransformOpenAIToAnthropic_TokenExtraction(t *testing.T) {
	testCases := []struct {
		name                string
		message             map[string]interface{}
		finishReason        string
		usage               map[string]interface{}
		expectedInputTokens int
		expectedOutputTokens int
	}{
		{
			name: "with valid usage data",
			message: map[string]interface{}{
				"content": "Test response",
			},
			finishReason: "stop",
			usage: map[string]interface{}{
				"prompt_tokens":     float64(1234),
				"completion_tokens": float64(567),
				"total_tokens":      float64(1801),
			},
			expectedInputTokens:  1234,
			expectedOutputTokens: 567,
		},
		{
			name: "with nil usage",
			message: map[string]interface{}{
				"content": "Test response",
			},
			finishReason:         "stop",
			usage:                nil,
			expectedInputTokens:  100, // fallback estimate
			expectedOutputTokens: 50,  // fallback estimate
		},
		{
			name: "with empty usage map",
			message: map[string]interface{}{
				"content": "Test response",
			},
			finishReason:         "stop",
			usage:                map[string]interface{}{},
			expectedInputTokens:  0,
			expectedOutputTokens: 0,
		},
		{
			name: "with tool calls",
			message: map[string]interface{}{
				"content": "",
				"tool_calls": []interface{}{
					map[string]interface{}{
						"id":   "call_123",
						"type": "function",
						"function": map[string]interface{}{
							"name":      "get_weather",
							"arguments": `{"location": "San Francisco"}`,
						},
					},
				},
			},
			finishReason: "tool_calls",
			usage: map[string]interface{}{
				"prompt_tokens":     float64(100),
				"completion_tokens": float64(50),
			},
			expectedInputTokens:  100,
			expectedOutputTokens: 50,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := transformOpenAIToAnthropic(tc.message, tc.finishReason, tc.usage)

			// Check basic structure
			assert.NotEmpty(t, result["id"])
			assert.Equal(t, "message", result["type"])
			assert.Equal(t, "assistant", result["role"])
			assert.NotNil(t, result["content"])

			// Check token extraction
			usage, ok := result["usage"].(map[string]interface{})
			require.True(t, ok, "should have usage field")
			assert.Equal(t, tc.expectedInputTokens, usage["input_tokens"])
			assert.Equal(t, tc.expectedOutputTokens, usage["output_tokens"])

			// Check stop reason mapping
			if tc.finishReason == "tool_calls" {
				assert.Equal(t, "tool_use", result["stop_reason"])
			} else {
				assert.Equal(t, "end_turn", result["stop_reason"])
			}

			// Verify ID format
			id := result["id"].(string)
			assert.True(t, strings.HasPrefix(id, "msg_"), "ID should have msg_ prefix")
		})
	}
}
