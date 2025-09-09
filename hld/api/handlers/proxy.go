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

func init() {
	// Initialize registry with provider-specific transform functions
	InitializeRegistry()
}

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

// setAuthHeaders sets the appropriate authentication headers based on the provider config
func (h *ProxyHandler) setAuthHeaders(c *gin.Context, req *http.Request, provider ProviderConfig, session *store.Session) error {
	// Get API key from session or environment
	apiKey := session.ProxyAPIKey
	if apiKey == "" {
		apiKey = os.Getenv(provider.EnvVarKey)
	}

	if apiKey == "" {
		c.JSON(500, gin.H{"error": fmt.Sprintf("%s not configured", provider.EnvVarKey)})
		return fmt.Errorf("%s not configured", provider.EnvVarKey)
	}

	// Set authentication header based on provider's auth method
	switch provider.AuthMethod {
	case AuthMethodAPIKey:
		req.Header.Set("x-api-key", apiKey)
		// Special handling for Anthropic
		if provider.Name == "anthropic" {
			req.Header.Set("anthropic-version", c.GetHeader("anthropic-version"))
		}
	case AuthMethodBearer:
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	}

	return nil
}

func (h *ProxyHandler) ProxyAnthropicRequest(c *gin.Context) {
	startTime := time.Now()
	sessionID := c.Param("session_id")

	slog.Info("🟢 PROXY REQUEST RECEIVED",
		"session_id", sessionID,
		"method", c.Request.Method,
		"path", c.Request.URL.Path,
		"remote_addr", c.Request.RemoteAddr,
		"user_agent", c.Request.UserAgent(),
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

	// Use provider from session, fall back to detection if not set
	providerName := session.Provider
	if providerName == "" && session.ProxyEnabled {
		// Try to detect provider from proxy model override
		if session.ProxyModelOverride != "" {
			// Check for known model patterns
			modelLower := strings.ToLower(session.ProxyModelOverride)
			if strings.Contains(modelLower, "openai/") || strings.Contains(modelLower, "gpt") {
				providerName = "openrouter"
				slog.Debug("detected OpenRouter from model", "model", session.ProxyModelOverride)
			} else if strings.Contains(modelLower, "glm") || strings.Contains(modelLower, "z-ai") {
				providerName = "z_ai"
				slog.Debug("detected Z-AI from model", "model", session.ProxyModelOverride)
			} else if strings.Contains(modelLower, "deepseek") {
				providerName = "baseten"
				slog.Debug("detected Baseten from model", "model", session.ProxyModelOverride)
			}
		}
	}

	if providerName == "" {
		// For backward compatibility, default to anthropic
		providerName = "anthropic"
	}

	slog.Debug("provider selection",
		"session_id", sessionID,
		"provider_from_session", session.Provider,
		"proxy_enabled", session.ProxyEnabled,
		"proxy_model", session.ProxyModelOverride,
		"selected_provider", providerName)

	// Get provider configuration from registry
	provider, ok := defaultRegistry.GetProvider(providerName)
	if !ok {
		// Fall back to detecting provider
		var err error
		provider, err = defaultRegistry.DetectProvider("", session.ProxyEnabled)
		if err != nil {
			slog.Error("no provider available", "session_id", sessionID, "error", err)
			c.JSON(500, gin.H{"error": "No provider available"})
			return
		}
	}

	// Determine target URL and whether transformation is needed
	targetURL := provider.GetTargetURL()
	needsTransform := provider.NeedsLocalTransform()

	slog.Info("routing request via provider",
		"session_id", sessionID,
		"provider", provider.Name,
		"mode", provider.Mode.String(),
		"target_url", targetURL,
		"needs_transform", needsTransform)

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

		// Use provider-specific transform if available
		if provider.TransformRequest != nil {
			requestBody = provider.TransformRequest(requestBody, sessionMap)
		} else {
			// Fallback to generic OpenAI transformation
			requestBody = h.transformAnthropicToOpenAI(requestBody, sessionMap)
		}
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
		h.handleStreamingProxy(c, sessionID, targetURL, forwardBytes, provider)
	} else {
		h.handleNonStreamingProxy(c, sessionID, targetURL, forwardBytes, provider)
	}

	slog.Info("proxy request completed",
		"session_id", sessionID,
		"total_duration_ms", time.Since(startTime).Milliseconds())
}

func (h *ProxyHandler) handleNonStreamingProxy(c *gin.Context, sessionID string, url string, body []byte, provider ProviderConfig) {
	handlerStart := time.Now()
	slog.Debug("starting non-streaming proxy",
		"session_id", sessionID,
		"url", url,
		"body_size", len(body),
		"provider", provider.Name,
		"mode", provider.Mode.String())

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

	// Set authentication headers based on provider
	if err := h.setAuthHeaders(c, req, provider, session); err != nil {
		return
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

	// Transform response if needed (for local proxies)
	if provider.Mode == ProxyModeLocal && resp.StatusCode == 200 {
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
					"provider", provider.Name,
					"transform_duration_ms", time.Since(transformStart).Milliseconds())
			}
		} else {
			slog.Warn("failed to parse OpenAI response for transformation",
				"session_id", sessionID,
				"provider", provider.Name,
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

func (h *ProxyHandler) handleStreamingProxy(c *gin.Context, sessionID string, url string, body []byte, provider ProviderConfig) {
	handlerStart := time.Now()
	slog.Debug("starting streaming proxy",
		"session_id", sessionID,
		"url", url,
		"body_size", len(body),
		"provider", provider.Name,
		"mode", provider.Mode.String())

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

	// Set authentication headers based on provider
	if err := h.setAuthHeaders(c, req, provider, session); err != nil {
		return
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
