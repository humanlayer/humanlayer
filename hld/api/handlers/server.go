package handlers

import (
	"context"
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

// StreamEvents implements the SSE endpoint for StrictServerInterface
func (s *ServerImpl) StreamEvents(ctx context.Context, req api.StreamEventsRequestObject) (api.StreamEventsResponseObject, error) {
	// This is handled directly by the gin handler, not through strict interface
	// Return a custom response that indicates SSE handling
	return nil, nil
}