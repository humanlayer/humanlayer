package handlers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

type ProxyHandler struct {
	sessionManager session.SessionManager
	store          store.ConversationStore
	httpClient     *http.Client
}

func NewProxyHandler(sessionManager session.SessionManager, store store.ConversationStore) *ProxyHandler {
	return &ProxyHandler{
		sessionManager: sessionManager,
		store:          store,
		httpClient:     &http.Client{},
	}
}

func (h *ProxyHandler) ProxyAnthropicRequest(c *gin.Context) {
	sessionID := c.Param("session_id")

	// Get session with proxy config
	session, err := h.store.GetSession(c.Request.Context(), sessionID)
	if err != nil {
		c.JSON(404, gin.H{"error": "Session not found"})
		return
	}

	// Read request body
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"error": "Failed to read request body"})
		return
	}

	// Parse to check if streaming is requested
	var requestBody map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &requestBody); err != nil {
		c.JSON(400, gin.H{"error": "Invalid JSON"})
		return
	}

	// Determine target URL based on session config
	var targetURL string
	var needsTransform bool

	// Check session proxy configuration
	if session.ProxyEnabled && session.ProxyBaseURL != "" {
		// Use configured proxy (e.g., custom proxy server)
		targetURL = session.ProxyBaseURL + "/v1/chat/completions"
		needsTransform = true
	} else if os.Getenv("OPENROUTER_API_KEY") != "" {
		// If OpenRouter API key is set, use OpenRouter
		targetURL = "https://openrouter.ai/api/v1/chat/completions"
		needsTransform = true
	} else {
		// Default passthrough to Anthropic
		targetURL = "https://api.anthropic.com/v1/messages"
		needsTransform = false
	}

	// Apply transformations if needed
	if needsTransform {
		// Convert session to map for transform functions
		sessionMap := map[string]interface{}{
			"id":                   session.ID,
			"proxy_enabled":        session.ProxyEnabled,
			"proxy_base_url":       session.ProxyBaseURL,
			"proxy_model_override": session.ProxyModelOverride,
			"proxy_api_key":        session.ProxyAPIKey,
		}
		requestBody = h.transformAnthropicToOpenAI(requestBody, sessionMap)
	}

	// Marshal back to bytes for forwarding
	forwardBytes := bodyBytes
	if needsTransform {
		forwardBytes, _ = json.Marshal(requestBody)
	}

	// Check if streaming
	stream, _ := requestBody["stream"].(bool)

	if stream {
		h.handleStreamingProxy(c, sessionID, targetURL, forwardBytes, needsTransform)
	} else {
		h.handleNonStreamingProxy(c, sessionID, targetURL, forwardBytes, needsTransform)
	}
}

func (h *ProxyHandler) handleNonStreamingProxy(c *gin.Context, sessionID string, url string, body []byte, needsTransform bool) {
	// Get session for auth details
	session, _ := h.store.GetSession(c.Request.Context(), sessionID)

	// Create request to upstream provider
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to create request"})
		return
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")

	// Set authentication based on provider
	if strings.Contains(url, "api.anthropic.com") {
		req.Header.Set("anthropic-version", c.GetHeader("anthropic-version"))
		apiKey := os.Getenv("ANTHROPIC_API_KEY")
		if apiKey == "" {
			c.JSON(500, gin.H{"error": "ANTHROPIC_API_KEY not configured"})
			return
		}
		req.Header.Set("x-api-key", apiKey)
	} else if strings.Contains(url, "openrouter.ai") || session.ProxyEnabled {
		// OpenRouter uses Bearer token
		// First try session-specific API key, then fall back to env var
		apiKey := session.ProxyAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("OPENROUTER_API_KEY")
		}
		if apiKey == "" {
			c.JSON(500, gin.H{"error": "No API key configured for proxy"})
			return
		}
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	}

	// Make request
	resp, err := h.httpClient.Do(req)
	if err != nil {
		c.JSON(500, gin.H{"error": "Upstream request failed"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// Read response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to read response"})
		return
	}

	// Transform response if needed
	if needsTransform && resp.StatusCode == 200 {
		var openAIResp map[string]interface{}
		if err := json.Unmarshal(respBody, &openAIResp); err == nil {
			// Extract message and finish_reason from OpenAI response
			if choices, ok := openAIResp["choices"].([]interface{}); ok && len(choices) > 0 {
				choice := choices[0].(map[string]interface{})
				message, _ := choice["message"].(map[string]interface{})
				finishReason, _ := choice["finish_reason"].(string)

				anthResp := transformOpenAIToAnthropic(message, finishReason)
				respBody, _ = json.Marshal(anthResp)
			}
		}
	}

	// Forward response
	c.Data(resp.StatusCode, "application/json", respBody)
}

func (h *ProxyHandler) handleStreamingProxy(c *gin.Context, sessionID string, url string, body []byte, needsTransform bool) {
	// Get session for auth details
	session, _ := h.store.GetSession(c.Request.Context(), sessionID)

	// Create request to upstream provider
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to create request"})
		return
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")

	// Set authentication based on provider
	if strings.Contains(url, "api.anthropic.com") {
		req.Header.Set("anthropic-version", c.GetHeader("anthropic-version"))
		apiKey := os.Getenv("ANTHROPIC_API_KEY")
		if apiKey == "" {
			c.JSON(500, gin.H{"error": "ANTHROPIC_API_KEY not configured"})
			return
		}
		req.Header.Set("x-api-key", apiKey)
	} else if strings.Contains(url, "openrouter.ai") || session.ProxyEnabled {
		// OpenRouter uses Bearer token
		// First try session-specific API key, then fall back to env var
		apiKey := session.ProxyAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("OPENROUTER_API_KEY")
		}
		if apiKey == "" {
			c.JSON(500, gin.H{"error": "No API key configured for proxy"})
			return
		}
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	}

	// Make request
	resp, err := h.httpClient.Do(req)
	if err != nil {
		c.JSON(500, gin.H{"error": "Upstream request failed"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	// Get flusher
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(500, gin.H{"error": "Streaming not supported"})
		return
	}

	// Stream response
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()

		// TODO: For transformed responses, we'd need to buffer and transform
		// SSE events from OpenAI format to Anthropic format.
		// For MVP, we disable streaming for transformed requests.
		// Future enhancement: Parse SSE events and transform on the fly.

		_, _ = fmt.Fprintf(c.Writer, "%s\n", line)
		flusher.Flush()
	}

	if err := scanner.Err(); err != nil {
		_, _ = fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", err.Error())
		flusher.Flush()
	}
}
