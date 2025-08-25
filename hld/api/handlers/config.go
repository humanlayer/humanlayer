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
	status := map[string]interface{}{
		"openrouter": map[string]bool{
			"api_key_configured": os.Getenv("OPENROUTER_API_KEY") != "",
		},
		"baseten": map[string]bool{
			"api_key_configured": os.Getenv("BASETEN_API_KEY") != "",
		},
	}
	c.JSON(200, status)
}
