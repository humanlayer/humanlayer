package handlers

import (
	"github.com/humanlayer/humanlayer/hld/api"
)

// ServerImpl combines all handlers to implement StrictServerInterface
type ServerImpl struct {
	*SessionHandlers
	*ApprovalHandlers
	*SSEHandler
}

// NewServerImpl creates a new server implementation
func NewServerImpl(sessions *SessionHandlers, approvals *ApprovalHandlers, sse *SSEHandler) api.StrictServerInterface {
	return &ServerImpl{
		SessionHandlers:  sessions,
		ApprovalHandlers: approvals,
		SSEHandler:       sse,
	}
}

// StreamEvents is handled directly by SSEHandler.StreamEvents, not through StrictServerInterface
// The endpoint is excluded from code generation using the 'sse-manual' tag

// ProxyAnthropicRequest is handled directly by ProxyHandler.ProxyAnthropicRequest, not through StrictServerInterface
// The endpoint is excluded from code generation using the 'proxy-manual' tag
