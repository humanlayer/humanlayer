package handlers

import (
	"github.com/humanlayer/humanlayer/hld/api"
)

// ServerImpl combines all handlers to implement StrictServerInterface
type ServerImpl struct {
	*SessionHandlers
	*ApprovalHandlers
	*FileHandlers
	*SSEHandler
	*SettingsHandlers
	*AgentHandlers
}

// NewServerImpl creates a new server implementation
func NewServerImpl(sessions *SessionHandlers, approvals *ApprovalHandlers, files *FileHandlers, sse *SSEHandler, settings *SettingsHandlers, agents *AgentHandlers) api.StrictServerInterface {
	return &ServerImpl{
		SessionHandlers:  sessions,
		ApprovalHandlers: approvals,
		FileHandlers:     files,
		SSEHandler:       sse,
		SettingsHandlers: settings,
		AgentHandlers:    agents,
	}
}

// StreamEvents is handled directly by SSEHandler.StreamEvents, not through StrictServerInterface
// The endpoint is excluded from code generation using the 'sse-manual' tag

// ProxyAnthropicRequest is handled directly by ProxyHandler.ProxyAnthropicRequest, not through StrictServerInterface
// The endpoint is excluded from code generation using the 'proxy-manual' tag
