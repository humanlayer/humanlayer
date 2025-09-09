package handlers

// Baseten-specific transformation logic
func transformAnthropicToBaseten(anthropicReq map[string]interface{}, session map[string]interface{}) map[string]interface{} {
	// Use base OpenAI transformation
	h := &ProxyHandler{}
	openAIReq := h.transformAnthropicToOpenAI(anthropicReq, session)

	// Baseten-specific adjustments
	if _, hasModel := openAIReq["model"]; !hasModel {
		openAIReq["model"] = "deepseek-ai/DeepSeek-V3.1" // Baseten default
	}

	// Baseten may have specific requirements for certain models
	// Add any provider-specific modifications here

	return openAIReq
}
