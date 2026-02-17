package toolutil

import "strings"

// IsAskUserQuestionTool checks if a tool name is the AskUserQuestion tool
// (built-in or MCP-namespaced variant).
func IsAskUserQuestionTool(toolName string) bool {
	return toolName == "ask_user_question" ||
		toolName == "AskUserQuestion" ||
		strings.HasSuffix(toolName, "__ask_user_question")
}
