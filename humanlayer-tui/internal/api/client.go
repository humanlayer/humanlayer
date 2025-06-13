// Package api provides thin wrappers around daemon RPC communication.
package api

import (
	"github.com/humanlayer/humanlayer/hld/client"
)

// clientImpl is the implementation of the Client interface
type clientImpl struct {
	daemonClient client.Client
}

// NewClient creates a new API client wrapper
func NewClient(daemonClient client.Client) Client {
	return &clientImpl{
		daemonClient: daemonClient,
	}
}

// Ensure clientImpl implements all interfaces
var _ Client = (*clientImpl)(nil)
var _ ApprovalClient = (*clientImpl)(nil)
var _ SessionClient = (*clientImpl)(nil)
var _ ConversationClient = (*clientImpl)(nil)
var _ EventClient = (*clientImpl)(nil)
