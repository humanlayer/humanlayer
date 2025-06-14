// Package api provides thin wrappers around daemon RPC communication.
package api

import (
	"context"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// Default timeouts for various operations
const (
	DefaultOperationTimeout = 30 * time.Second
	DefaultFetchTimeout     = 10 * time.Second
	DefaultLaunchTimeout    = 60 * time.Second
)

// TimeoutConfig holds timeout configuration for API operations
type TimeoutConfig struct {
	FetchTimeout     time.Duration
	LaunchTimeout    time.Duration
	OperationTimeout time.Duration
}

// DefaultTimeoutConfig returns the default timeout configuration
func DefaultTimeoutConfig() TimeoutConfig {
	return TimeoutConfig{
		FetchTimeout:     DefaultFetchTimeout,
		LaunchTimeout:    DefaultLaunchTimeout,
		OperationTimeout: DefaultOperationTimeout,
	}
}

// withTimeout wraps a tea.Cmd with a timeout
func withTimeout(cmd tea.Cmd, timeout time.Duration, operationName string) tea.Cmd {
	return func() tea.Msg {
		// Create channels for result and timeout
		resultCh := make(chan tea.Msg, 1)

		// Run the original command in a goroutine
		go func() {
			resultCh <- cmd()
		}()

		// Wait for either result or timeout
		select {
		case result := <-resultCh:
			return result
		case <-time.After(timeout):
			return domain.TimeoutMsg{
				Operation: operationName,
				Duration:  timeout,
			}
		}
	}
}

// clientWithTimeout wraps the client implementation with timeout support
type clientWithTimeout struct {
	*clientImpl
	config TimeoutConfig
}

// NewClientWithTimeout creates a new API client with timeout support
func NewClientWithTimeout(daemonClient client.Client, config TimeoutConfig) Client {
	impl := &clientImpl{
		daemonClient: daemonClient,
	}

	return &clientWithTimeout{
		clientImpl: impl,
		config:     config,
	}
}

// FetchRequests with timeout
func (c *clientWithTimeout) FetchRequests() tea.Cmd {
	return withTimeout(c.clientImpl.FetchRequests(), c.config.FetchTimeout, "FetchRequests")
}

// FetchSessions with timeout
func (c *clientWithTimeout) FetchSessions() tea.Cmd {
	return withTimeout(c.clientImpl.FetchSessions(), c.config.FetchTimeout, "FetchSessions")
}

// FetchSessionApprovals with timeout
func (c *clientWithTimeout) FetchSessionApprovals(sessionID string) tea.Cmd {
	return withTimeout(c.clientImpl.FetchSessionApprovals(sessionID), c.config.FetchTimeout, "FetchSessionApprovals")
}

// LaunchSession with timeout (longer timeout for launch operations)
func (c *clientWithTimeout) LaunchSession(query, model, workingDir string) tea.Cmd {
	return withTimeout(c.clientImpl.LaunchSession(query, model, workingDir), c.config.LaunchTimeout, "LaunchSession")
}

// SendApproval with timeout
func (c *clientWithTimeout) SendApproval(callID string, approved bool, comment string) tea.Cmd {
	return withTimeout(c.clientImpl.SendApproval(callID, approved, comment), c.config.OperationTimeout, "SendApproval")
}

// SendHumanResponse with timeout
func (c *clientWithTimeout) SendHumanResponse(requestID string, response string) tea.Cmd {
	return withTimeout(c.clientImpl.SendHumanResponse(requestID, response), c.config.OperationTimeout, "SendHumanResponse")
}

// FetchConversation with timeout
func (c *clientWithTimeout) FetchConversation(sessionID string) tea.Cmd {
	return withTimeout(c.clientImpl.FetchConversation(sessionID), c.config.FetchTimeout, "FetchConversation")
}

// FetchConversationSilent with timeout
func (c *clientWithTimeout) FetchConversationSilent(sessionID string) tea.Cmd {
	return withTimeout(c.clientImpl.FetchConversationSilent(sessionID), c.config.FetchTimeout, "FetchConversationSilent")
}

// ContinueSession with timeout
func (c *clientWithTimeout) ContinueSession(sessionID, query string) tea.Cmd {
	return withTimeout(c.clientImpl.ContinueSession(sessionID, query), c.config.LaunchTimeout, "ContinueSession")
}

// SubscribeToEvents doesn't timeout (long-lived connection)
func (c *clientWithTimeout) SubscribeToEvents() tea.Cmd {
	return c.clientImpl.SubscribeToEvents()
}

// ListenForEvents doesn't timeout (waits for events)
func (c *clientWithTimeout) ListenForEvents(eventChan <-chan rpc.EventNotification) tea.Cmd {
	return c.clientImpl.ListenForEvents(eventChan)
}

// ConnectionHealthChecker provides methods to check connection health
type ConnectionHealthChecker interface {
	// CheckHealth returns nil if the connection is healthy
	CheckHealth(ctx context.Context) error
	// IsHealthy returns true if the last health check was successful
	IsHealthy() bool
}

// connectionHealthChecker implements health checking for the daemon connection
type connectionHealthChecker struct {
	client      Client
	lastCheckOK bool
	lastCheckAt time.Time
}

// NewConnectionHealthChecker creates a new health checker
func NewConnectionHealthChecker(client Client) ConnectionHealthChecker {
	return &connectionHealthChecker{
		client: client,
	}
}

// CheckHealth performs a health check by attempting a lightweight operation
func (h *connectionHealthChecker) CheckHealth(ctx context.Context) error {
	// Use FetchSessions as a lightweight health check
	cmd := h.client.FetchSessions()

	// Run the command with context
	resultCh := make(chan tea.Msg, 1)
	go func() {
		resultCh <- cmd()
	}()

	select {
	case result := <-resultCh:
		h.lastCheckAt = time.Now()
		if msg, ok := result.(domain.FetchSessionsMsg); ok {
			h.lastCheckOK = msg.Err == nil
			return msg.Err
		}
		h.lastCheckOK = false
		return domain.ErrUnexpectedResponse
	case <-ctx.Done():
		h.lastCheckOK = false
		return ctx.Err()
	}
}

// IsHealthy returns true if the last health check was successful
func (h *connectionHealthChecker) IsHealthy() bool {
	// Consider unhealthy if never checked or last check failed
	if h.lastCheckAt.IsZero() {
		return false
	}
	// Consider unhealthy if last check was too long ago
	if time.Since(h.lastCheckAt) > time.Minute {
		return false
	}
	return h.lastCheckOK
}
