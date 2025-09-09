package handlers

import (
	"fmt"
	"os"
)

type ProxyMode int

const (
	ProxyModeRemote ProxyMode = iota // Remote handles any needed transformation
	ProxyModeLocal                   // We handle transformation locally
)

type AuthMethod string

const (
	AuthMethodAPIKey AuthMethod = "x-api-key"
	AuthMethodBearer AuthMethod = "bearer"
)

// TransformFunc defines how we transform requests for local proxies
type TransformFunc func(anthropicReq map[string]interface{}, session map[string]interface{}) map[string]interface{}

type ProviderConfig struct {
	Name        string
	DisplayName string
	Mode        ProxyMode
	BaseURL     string
	AuthMethod  AuthMethod
	EnvVarKey   string

	// For remote proxies (no local transformation)
	RemoteEndpoint string // e.g., "/v1/messages" for Anthropic-compatible

	// For local proxies (we transform)
	LocalEndpoint    string        // e.g., "/v1/chat/completions" for OpenAI format
	DefaultModel     string        // Default model for transformation
	TransformRequest TransformFunc // How to transform Anthropic → target format
	// TransformResponse would be added here for response transformation
}

type ProviderRegistry struct {
	providers map[string]ProviderConfig
}

// Initialize with existing providers
var defaultRegistry = &ProviderRegistry{
	providers: map[string]ProviderConfig{
		// REMOTE PROXIES - No local transformation needed
		"anthropic": {
			Name:           "anthropic",
			DisplayName:    "Anthropic",
			Mode:           ProxyModeRemote,
			BaseURL:        "https://api.anthropic.com",
			AuthMethod:     AuthMethodAPIKey,
			EnvVarKey:      "ANTHROPIC_API_KEY",
			RemoteEndpoint: "/v1/messages",
		},
		"z_ai": {
			Name:           "z_ai",
			DisplayName:    "Z-AI",
			Mode:           ProxyModeRemote,
			BaseURL:        "https://api.z.ai/api/anthropic",
			AuthMethod:     AuthMethodBearer,
			EnvVarKey:      "Z_AI_API_KEY",
			RemoteEndpoint: "/v1/messages",
		},

		// LOCAL PROXIES - We handle transformation
		"openrouter": {
			Name:             "openrouter",
			DisplayName:      "OpenRouter",
			Mode:             ProxyModeLocal,
			BaseURL:          "https://openrouter.ai/api/v1",
			AuthMethod:       AuthMethodBearer,
			EnvVarKey:        "OPENROUTER_API_KEY",
			LocalEndpoint:    "/chat/completions",
			DefaultModel:     "openai/gpt-oss-120b",
			TransformRequest: nil, // Will be set to transformAnthropicToOpenAI
		},
		"baseten": {
			Name:             "baseten",
			DisplayName:      "Baseten",
			Mode:             ProxyModeLocal,
			BaseURL:          "https://inference.baseten.co/v1",
			AuthMethod:       AuthMethodBearer,
			EnvVarKey:        "BASETEN_API_KEY",
			LocalEndpoint:    "/chat/completions",
			DefaultModel:     "deepseek-ai/DeepSeek-V3.1",
			TransformRequest: nil, // Will be set to transformAnthropicToOpenAI
		},
	},
}

// GetTargetURL constructs the appropriate URL based on proxy mode
func (p ProviderConfig) GetTargetURL() string {
	switch p.Mode {
	case ProxyModeRemote:
		return p.BaseURL + p.RemoteEndpoint
	case ProxyModeLocal:
		return p.BaseURL + p.LocalEndpoint
	default:
		return p.BaseURL + "/v1/messages" // fallback
	}
}

// NeedsLocalTransform returns true if we handle transformation
func (p ProviderConfig) NeedsLocalTransform() bool {
	return p.Mode == ProxyModeLocal
}

// GetProvider retrieves a provider by name
func (r *ProviderRegistry) GetProvider(name string) (ProviderConfig, bool) {
	provider, ok := r.providers[name]
	return provider, ok
}

// RegisterProvider adds or updates a provider in the registry
func (r *ProviderRegistry) RegisterProvider(config ProviderConfig) {
	r.providers[config.Name] = config
}

// DetectProvider determines which provider to use based on session and environment
func (r *ProviderRegistry) DetectProvider(sessionProviderName string, sessionProxyEnabled bool) (ProviderConfig, error) {
	// Priority 1: Explicit session provider
	if sessionProxyEnabled && sessionProviderName != "" {
		if provider, ok := r.GetProvider(sessionProviderName); ok {
			return provider, nil
		}
	}

	// Priority 2: First available non-Anthropic provider (check Z-AI, OpenRouter, Baseten)
	priorityOrder := []string{"z_ai", "openrouter", "baseten"}
	for _, name := range priorityOrder {
		if provider, ok := r.GetProvider(name); ok {
			if os.Getenv(provider.EnvVarKey) != "" {
				return provider, nil
			}
		}
	}

	// Priority 3: Default to Anthropic
	if provider, ok := r.GetProvider("anthropic"); ok {
		return provider, nil
	}

	return ProviderConfig{}, fmt.Errorf("no provider available")
}

// GetAvailableProviders returns all providers (UI will handle API key input)
func (r *ProviderRegistry) GetAvailableProviders() []ProviderConfig {
	var available []ProviderConfig
	for _, provider := range r.providers {
		// Return all providers - the UI has input fields for API keys
		available = append(available, provider)
	}
	return available
}

// String returns a string representation of the ProxyMode
func (m ProxyMode) String() string {
	switch m {
	case ProxyModeRemote:
		return "remote"
	case ProxyModeLocal:
		return "local"
	default:
		return "unknown"
	}
}

// InitializeRegistry sets up the transform functions for local proxies
// This is called from init() in proxy.go to avoid circular dependencies
func InitializeRegistry() {
	// Set transform functions for local proxies
	if provider, ok := defaultRegistry.providers["openrouter"]; ok {
		provider.TransformRequest = transformAnthropicToOpenRouter
		defaultRegistry.providers["openrouter"] = provider
	}
	if provider, ok := defaultRegistry.providers["baseten"]; ok {
		provider.TransformRequest = transformAnthropicToBaseten
		defaultRegistry.providers["baseten"] = provider
	}
}
