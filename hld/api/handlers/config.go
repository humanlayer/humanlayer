package handlers

import (
	"os"

	"github.com/gin-gonic/gin"
)

// ConfigHandler handles configuration-related requests
type ConfigHandler struct{}

// NewConfigHandler creates a new config handler
func NewConfigHandler() *ConfigHandler {
	return &ConfigHandler{}
}

// GetConfigStatus returns the configuration status without exposing sensitive data
func (h *ConfigHandler) GetConfigStatus(c *gin.Context) {
	// Use provider registry for dynamic status
	providers := defaultRegistry.GetAvailableProviders()
	status := make(map[string]interface{})

	for _, provider := range providers {
		status[provider.Name] = map[string]interface{}{
			"api_key_configured": os.Getenv(provider.EnvVarKey) != "",
			"display_name":       provider.DisplayName,
			"mode":               provider.Mode.String(),
		}
	}

	c.JSON(200, status)
}

// GetProviders returns the list of available providers
func (h *ConfigHandler) GetProviders(c *gin.Context) {
	providers := []map[string]interface{}{}

	for _, provider := range defaultRegistry.GetAvailableProviders() {
		providers = append(providers, map[string]interface{}{
			"name":        provider.Name,
			"displayName": provider.DisplayName,
			"mode":        provider.Mode.String(),
			"configured":  os.Getenv(provider.EnvVarKey) != "",
		})
	}

	c.JSON(200, gin.H{"providers": providers})
}
