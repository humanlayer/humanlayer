package handlers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

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
	startTime := time.Now()
	sessionID := c.Param("session_id")

	slog.Info("proxy request started",
		"session_id", sessionID,
		"method", c.Request.Method,
		"path", c.Request.URL.Path,
		"start_time", startTime)

	// Get session with proxy config
	session, err := h.store.GetSession(c.Request.Context(), sessionID)
	if err != nil {
		slog.Error("session not found", "session_id", sessionID, "error", err)
		c.JSON(404, gin.H{"error": "Session not found"})
		return
	}

	slog.Debug("session loaded",
		"session_id", sessionID,
		"proxy_enabled", session.ProxyEnabled,
		"proxy_base_url", session.ProxyBaseURL,
		"proxy_model_override", session.ProxyModelOverride,
		"has_proxy_api_key", session.ProxyAPIKey != "")

	// Read request body
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		slog.Error("failed to read request body", "error", err)
		c.JSON(400, gin.H{"error": "Failed to read request body"})
		return
	}

	slog.Debug("request body read",
		"session_id", sessionID,
		"body_size", len(bodyBytes),
		"elapsed_ms", time.Since(startTime).Milliseconds())

	// Parse to check if streaming is requested
	var requestBody map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &requestBody); err != nil {
		slog.Error("invalid JSON in request", "error", err)
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
		slog.Info("using session proxy configuration",
			"session_id", sessionID,
			"target_url", targetURL)
	} else if os.Getenv("OPENROUTER_API_KEY") != "" {
		// If OpenRouter API key is set, use OpenRouter
		targetURL = "https://openrouter.ai/api/v1/chat/completions"
		needsTransform = true
		slog.Info("using OpenRouter proxy",
			"session_id", sessionID,
			"target_url", targetURL)
	} else {
		// Default passthrough to Anthropic
		targetURL = "https://api.anthropic.com/v1/messages"
		needsTransform = false
		slog.Info("using direct Anthropic API",
			"session_id", sessionID,
			"target_url", targetURL)
	}

	// Apply transformations if needed
	if needsTransform {
		transformStart := time.Now()
		// Convert session to map for transform functions
		sessionMap := map[string]interface{}{
			"id":                   session.ID,
			"proxy_enabled":        session.ProxyEnabled,
			"proxy_base_url":       session.ProxyBaseURL,
			"proxy_model_override": session.ProxyModelOverride,
			"proxy_api_key":        session.ProxyAPIKey,
		}
		requestBody = h.transformAnthropicToOpenAI(requestBody, sessionMap)
		slog.Debug("request transformed",
			"session_id", sessionID,
			"transform_duration_ms", time.Since(transformStart).Milliseconds(),
			"model", requestBody["model"])
	}

	// Marshal back to bytes for forwarding
	forwardBytes := bodyBytes
	if needsTransform {
		forwardBytes, _ = json.Marshal(requestBody)
	}

	// Check if streaming
	stream, _ := requestBody["stream"].(bool)

	slog.Info("routing request",
		"session_id", sessionID,
		"streaming", stream,
		"target_url", targetURL,
		"needs_transform", needsTransform,
		"request_size", len(forwardBytes),
		"elapsed_ms", time.Since(startTime).Milliseconds())

	if stream {
		h.handleStreamingProxy(c, sessionID, targetURL, forwardBytes, needsTransform)
	} else {
		h.handleNonStreamingProxy(c, sessionID, targetURL, forwardBytes, needsTransform)
	}

	slog.Info("proxy request completed",
		"session_id", sessionID,
		"total_duration_ms", time.Since(startTime).Milliseconds())
}

func (h *ProxyHandler) handleNonStreamingProxy(c *gin.Context, sessionID string, url string, body []byte, needsTransform bool) {
	handlerStart := time.Now()
	slog.Debug("starting non-streaming proxy",
		"session_id", sessionID,
		"url", url,
		"body_size", len(body))

	// Get session for auth details
	session, _ := h.store.GetSession(c.Request.Context(), sessionID)

	// Create request to upstream provider
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		slog.Error("failed to create upstream request",
			"session_id", sessionID,
			"error", err)
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
	requestStart := time.Now()
	slog.Info("sending upstream request",
		"session_id", sessionID,
		"url", url,
		"has_auth", req.Header.Get("Authorization") != "" || req.Header.Get("x-api-key") != "",
		"elapsed_since_handler_start_ms", time.Since(handlerStart).Milliseconds())

	resp, err := h.httpClient.Do(req)
	if err != nil {
		slog.Error("upstream request failed",
			"session_id", sessionID,
			"url", url,
			"error", err,
			"duration_ms", time.Since(requestStart).Milliseconds())
		c.JSON(500, gin.H{"error": "Upstream request failed"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	slog.Info("upstream response received",
		"session_id", sessionID,
		"status_code", resp.StatusCode,
		"duration_ms", time.Since(requestStart).Milliseconds(),
		"content_length", resp.ContentLength)

	// Read response
	readStart := time.Now()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Error("failed to read response body",
			"session_id", sessionID,
			"error", err)
		c.JSON(500, gin.H{"error": "Failed to read response"})
		return
	}

	slog.Debug("response body read",
		"session_id", sessionID,
		"body_size", len(respBody),
		"read_duration_ms", time.Since(readStart).Milliseconds())

	// Transform response if needed
	if needsTransform && resp.StatusCode == 200 {
		transformStart := time.Now()
		var openAIResp map[string]interface{}
		if err := json.Unmarshal(respBody, &openAIResp); err == nil {
			// Extract message, finish_reason, and usage from OpenAI response
			if choices, ok := openAIResp["choices"].([]interface{}); ok && len(choices) > 0 {
				choice := choices[0].(map[string]interface{})
				message, _ := choice["message"].(map[string]interface{})
				finishReason, _ := choice["finish_reason"].(string)
				usage, _ := openAIResp["usage"].(map[string]interface{})

				anthResp := transformOpenAIToAnthropic(message, finishReason, usage)
				respBody, _ = json.Marshal(anthResp)

				slog.Debug("response transformed",
					"session_id", sessionID,
					"transform_duration_ms", time.Since(transformStart).Milliseconds())
			}
		} else {
			slog.Warn("failed to parse OpenAI response for transformation",
				"session_id", sessionID,
				"error", err)
		}
	}

	// Forward response
	c.Data(resp.StatusCode, "application/json", respBody)

	slog.Info("non-streaming proxy completed",
		"session_id", sessionID,
		"total_duration_ms", time.Since(handlerStart).Milliseconds(),
		"response_size", len(respBody))
}

func (h *ProxyHandler) handleStreamingProxy(c *gin.Context, sessionID string, url string, body []byte, needsTransform bool) {
	handlerStart := time.Now()
	slog.Debug("starting streaming proxy",
		"session_id", sessionID,
		"url", url,
		"body_size", len(body))

	// Get session for auth details
	session, _ := h.store.GetSession(c.Request.Context(), sessionID)

	// Create request to upstream provider
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		slog.Error("failed to create streaming upstream request",
			"session_id", sessionID,
			"error", err)
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
	requestStart := time.Now()
	slog.Info("sending streaming upstream request",
		"session_id", sessionID,
		"url", url,
		"has_auth", req.Header.Get("Authorization") != "" || req.Header.Get("x-api-key") != "")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		slog.Error("streaming upstream request failed",
			"session_id", sessionID,
			"url", url,
			"error", err,
			"duration_ms", time.Since(requestStart).Milliseconds())
		c.JSON(500, gin.H{"error": "Upstream request failed"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	slog.Info("streaming response started",
		"session_id", sessionID,
		"status_code", resp.StatusCode,
		"initial_response_ms", time.Since(requestStart).Milliseconds())

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
	chunkCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		chunkCount++

		if chunkCount == 1 {
			slog.Debug("first streaming chunk received",
				"session_id", sessionID,
				"time_to_first_chunk_ms", time.Since(requestStart).Milliseconds())
		}

		// TODO: For transformed responses, we'd need to buffer and transform
		// SSE events from OpenAI format to Anthropic format.
		// For MVP, we disable streaming for transformed requests.
		// Future enhancement: Parse SSE events and transform on the fly.

		_, _ = fmt.Fprintf(c.Writer, "%s\n", line)
		flusher.Flush()
	}

	if err := scanner.Err(); err != nil {
		slog.Error("streaming scanner error",
			"session_id", sessionID,
			"error", err)
		_, _ = fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", err.Error())
		flusher.Flush()
	}

	slog.Info("streaming proxy completed",
		"session_id", sessionID,
		"total_duration_ms", time.Since(handlerStart).Milliseconds(),
		"chunk_count", chunkCount)
}
