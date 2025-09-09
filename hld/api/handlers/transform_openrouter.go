package handlers

// OpenRouter-specific transformation logic
func transformAnthropicToOpenRouter(anthropicReq map[string]interface{}, session map[string]interface{}) map[string]interface{} {
	// Use base OpenAI transformation
	h := &ProxyHandler{}
	openAIReq := h.transformAnthropicToOpenAI(anthropicReq, session)

	// OpenRouter-specific adjustments
	if _, hasModel := openAIReq["model"]; !hasModel {
		openAIReq["model"] = "openai/gpt-oss-120b" // OpenRouter default
	}

	// OpenRouter-specific headers could be added here
	openAIReq["route"] = "fallback" // Example: OpenRouter routing preference

	return openAIReq
}
