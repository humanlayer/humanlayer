package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// Transform request from Anthropic format to OpenAI format
func (h *ProxyHandler) transformAnthropicToOpenAI(anthropicReq map[string]interface{}, session map[string]interface{}) map[string]interface{} {
	openAIReq := make(map[string]interface{})

	slog.Debug("transforming Anthropic to OpenAI format",
		"session_id", session["id"],
		"has_messages", anthropicReq["messages"] != nil,
		"has_tools", anthropicReq["tools"] != nil)

	// Transform messages
	if messages, ok := anthropicReq["messages"].([]interface{}); ok {
		var openAIMessages []interface{}

		// Add system messages first
		if system, ok := anthropicReq["system"].(string); ok {
			openAIMessages = append(openAIMessages, map[string]interface{}{
				"role":    "system",
				"content": system,
			})
		} else if system, ok := anthropicReq["system"].([]interface{}); ok {
			for _, sys := range system {
				openAIMessages = append(openAIMessages, map[string]interface{}{
					"role":    "system",
					"content": normalizeContent(sys),
				})
			}
		}

		// Transform user/assistant messages
		for _, msg := range messages {
			if anthropicMsg, ok := msg.(map[string]interface{}); ok {
				openAIMsg := transformSingleMessage(anthropicMsg)
				openAIMessages = append(openAIMessages, openAIMsg)
			}
		}

		openAIReq["messages"] = openAIMessages
	}

	// Transform tools to OpenAI tools format (not deprecated functions)
	if tools, ok := anthropicReq["tools"].([]interface{}); ok {
		var openAITools []interface{}
		for _, tool := range tools {
			if t, ok := tool.(map[string]interface{}); ok {
				// Filter out BatchTool
				if name, ok := t["name"].(string); ok && name != "BatchTool" {
					inputSchema := t["input_schema"].(map[string]interface{})
					openAITools = append(openAITools, map[string]interface{}{
						"type": "function",
						"function": map[string]interface{}{
							"name":        t["name"],
							"description": t["description"],
							"parameters":  removeURIFormat(inputSchema),
						},
					})
				}
			}
		}
		// OpenAI uses "tools" field with new structure
		if len(openAITools) > 0 {
			openAIReq["tools"] = openAITools
			// Default to auto tool choice if not specified
			if anthropicReq["tool_choice"] == nil {
				openAIReq["tool_choice"] = "auto"
			}
		}
	}

	// Handle tool_choice if specified
	if toolChoice, ok := anthropicReq["tool_choice"].(map[string]interface{}); ok {
		switch toolChoice["type"] {
		case "tool":
			// Transform specific tool choice
			if name, ok := toolChoice["name"].(string); ok {
				openAIReq["tool_choice"] = map[string]interface{}{
					"type": "function",
					"function": map[string]interface{}{
						"name": name,
					},
				}
			}
		case "any":
			openAIReq["tool_choice"] = "auto"
		case "none":
			openAIReq["tool_choice"] = "none"
		}
	}

	// Copy other fields
	// Use ProxyModelOverride if set, otherwise use default OpenRouter model
	if modelOverride, ok := session["proxy_model_override"].(string); ok && modelOverride != "" {
		openAIReq["model"] = modelOverride
		slog.Debug("using proxy model override",
			"session_id", session["id"],
			"model", modelOverride)
	} else {
		// Default to anthropic/claude-sonnet-4 for OpenRouter
		openAIReq["model"] = "openai/gpt-oss-120b"
		slog.Debug("using default OpenRouter model",
			"session_id", session["id"],
			"model", "openai/gpt-oss-120b")
	}

	// Copy standard parameters
	if stream, ok := anthropicReq["stream"].(bool); ok {
		openAIReq["stream"] = stream
	}
	if temp, ok := anthropicReq["temperature"]; ok {
		openAIReq["temperature"] = temp
	}
	if maxTokens, ok := anthropicReq["max_tokens"]; ok {
		openAIReq["max_tokens"] = maxTokens
	}

	messageCount := 0
	if msgs, ok := openAIReq["messages"].([]interface{}); ok {
		messageCount = len(msgs)
	}

	slog.Debug("transformation complete",
		"session_id", session["id"],
		"message_count", messageCount,
		"has_tools", openAIReq["tools"] != nil,
		"tool_choice", openAIReq["tool_choice"])

	return openAIReq
}

// Transform a single message from Anthropic to OpenAI format
func transformSingleMessage(anthropicMsg map[string]interface{}) map[string]interface{} {
	openAIMsg := map[string]interface{}{
		"role": anthropicMsg["role"],
	}

	// Handle content - could be string or array
	switch content := anthropicMsg["content"].(type) {
	case string:
		openAIMsg["content"] = content
	case []interface{}:
		var texts []string
		var toolCalls []interface{}

		for _, item := range content {
			if block, ok := item.(map[string]interface{}); ok {
				switch block["type"] {
				case "text":
					if text, ok := block["text"].(string); ok {
						texts = append(texts, text)
					}
				case "tool_use":
					// Convert to OpenAI tool call
					toolCall := map[string]interface{}{
						"id":   block["id"],
						"type": "function",
						"function": map[string]interface{}{
							"name":      block["name"],
							"arguments": mustMarshalJSON(block["input"]),
						},
					}
					toolCalls = append(toolCalls, toolCall)
				case "tool_result":
					// Handle tool results (convert to tool response)
					openAIMsg["role"] = "tool"
					if toolUseID, ok := block["tool_use_id"].(string); ok {
						openAIMsg["tool_call_id"] = toolUseID
					}
					if output, ok := block["content"].(string); ok {
						openAIMsg["content"] = output
					} else if output, ok := block["content"].([]interface{}); ok {
						// Handle structured content in tool results
						openAIMsg["content"] = normalizeContent(output)
					}
				}
			}
		}

		// Set content and tool calls
		if len(texts) > 0 {
			openAIMsg["content"] = strings.Join(texts, " ")
		}
		if len(toolCalls) > 0 {
			openAIMsg["tool_calls"] = toolCalls
		}
	}

	return openAIMsg
}

// Transform OpenAI response back to Anthropic format
func transformOpenAIToAnthropic(message map[string]interface{}, finishReason string, usage map[string]interface{}) map[string]interface{} {
	// Map stop reasons
	anthropicStopReason := mapStopReason(finishReason)

	// Build content array
	var content []interface{}

	// Add text content if present
	if msgContent, ok := message["content"].(string); ok && msgContent != "" {
		content = append(content, map[string]interface{}{
			"type": "text",
			"text": msgContent,
		})
	}

	// Add tool calls if present
	if toolCalls, ok := message["tool_calls"].([]interface{}); ok {
		for _, tc := range toolCalls {
			if toolCall, ok := tc.(map[string]interface{}); ok {
				if function, ok := toolCall["function"].(map[string]interface{}); ok {
					var input map[string]interface{}
					if args, ok := function["arguments"].(string); ok {
						_ = json.Unmarshal([]byte(args), &input)
					}

					content = append(content, map[string]interface{}{
						"type":  "tool_use",
						"id":    toolCall["id"],
						"name":  function["name"],
						"input": input,
					})
				}
			}
		}
	}

	// Default to empty text if no content
	if len(content) == 0 {
		content = append(content, map[string]interface{}{
			"type": "text",
			"text": "",
		})
	}

	// Extract actual token usage from OpenAI response
	anthropicUsage := map[string]interface{}{
		"input_tokens":  0,
		"output_tokens": 0,
	}

	if usage != nil {
		// Map OpenAI token fields to Anthropic format
		// OpenRouter/OpenAI uses "prompt_tokens" and "completion_tokens"
		if promptTokens, ok := usage["prompt_tokens"].(float64); ok {
			anthropicUsage["input_tokens"] = int(promptTokens)
		}
		if completionTokens, ok := usage["completion_tokens"].(float64); ok {
			anthropicUsage["output_tokens"] = int(completionTokens)
		}
		// Some OpenAI models may report total_tokens, but we don't need it

		// Log token extraction for debugging
		slog.Debug("extracted token usage from OpenAI response",
			"input_tokens", anthropicUsage["input_tokens"],
			"output_tokens", anthropicUsage["output_tokens"],
			"raw_usage", usage)
	} else {
		// Fallback to estimates if no usage data available
		slog.Warn("no usage data in OpenAI response, using estimates")
		anthropicUsage["input_tokens"] = 100
		anthropicUsage["output_tokens"] = 50
	}

	return map[string]interface{}{
		"id":          fmt.Sprintf("msg_%d", time.Now().UnixNano()),
		"type":        "message",
		"role":        "assistant",
		"content":     content,
		"stop_reason": anthropicStopReason,
		"usage":       anthropicUsage,
	}
}

// Map OpenAI stop reason to Anthropic format
func mapStopReason(openaiReason string) string {
	switch openaiReason {
	case "tool_calls":
		return "tool_use"
	case "stop":
		return "end_turn"
	case "length":
		return "max_tokens"
	default:
		return "end_turn"
	}
}

// Remove format: "uri" from JSON schemas (OpenRouter compatibility)
func removeURIFormat(schema map[string]interface{}) map[string]interface{} {
	// Remove format: "uri" from string types
	if schema["type"] == "string" && schema["format"] == "uri" {
		delete(schema, "format")
	}

	// Recursively process properties
	if props, ok := schema["properties"].(map[string]interface{}); ok {
		for key, value := range props {
			if propSchema, ok := value.(map[string]interface{}); ok {
				props[key] = removeURIFormat(propSchema)
			}
		}
	}

	// Process items for arrays
	if items, ok := schema["items"].(map[string]interface{}); ok {
		schema["items"] = removeURIFormat(items)
	}

	// Process anyOf, allOf, oneOf
	for _, key := range []string{"anyOf", "allOf", "oneOf"} {
		if schemas, ok := schema[key].([]interface{}); ok {
			for i, s := range schemas {
				if subSchema, ok := s.(map[string]interface{}); ok {
					schemas[i] = removeURIFormat(subSchema)
				}
			}
		}
	}

	return schema
}

// Helper function to normalize content (string or array)
func normalizeContent(content interface{}) string {
	switch c := content.(type) {
	case string:
		return c
	case []interface{}:
		var texts []string
		for _, item := range c {
			if block, ok := item.(map[string]interface{}); ok {
				if block["type"] == "text" {
					if text, ok := block["text"].(string); ok {
						texts = append(texts, text)
					}
				}
			}
		}
		return strings.Join(texts, " ")
	default:
		return ""
	}
}

// Helper to marshal JSON or return empty string
func mustMarshalJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}
