package session

import (
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
)

// ClaudeSession is an interface that wraps claudecode.Session for testability
//
//go:generate mockgen -source=claudecode_wrapper.go -destination=mock_claudecode.go -package=session ClaudeSession
type ClaudeSession interface {
	// Interrupt sends a SIGINT signal to the session process
	Interrupt() error

	// Kill forcefully terminates the session process
	Kill() error

	// GetID returns the session ID
	GetID() string

	// Wait blocks until the session completes and returns the result
	Wait() (*claudecode.Result, error)

	// GetEvents returns the events channel for streaming
	GetEvents() <-chan claudecode.StreamEvent
}

// ClaudeSessionWrapper wraps a real claudecode.Session
type ClaudeSessionWrapper struct {
	session *claudecode.Session
}

// NewClaudeSessionWrapper creates a new wrapper around a claudecode.Session
func NewClaudeSessionWrapper(session *claudecode.Session) ClaudeSession {
	return &ClaudeSessionWrapper{session: session}
}

// Interrupt implements the ClaudeSession interface
func (w *ClaudeSessionWrapper) Interrupt() error {
	return w.session.Interrupt()
}

// Kill implements the ClaudeSession interface
func (w *ClaudeSessionWrapper) Kill() error {
	return w.session.Kill()
}

// GetID implements the ClaudeSession interface
func (w *ClaudeSessionWrapper) GetID() string {
	return w.session.ID
}

// Wait implements the ClaudeSession interface
func (w *ClaudeSessionWrapper) Wait() (*claudecode.Result, error) {
	return w.session.Wait()
}

// GetEvents implements the ClaudeSession interface
func (w *ClaudeSessionWrapper) GetEvents() <-chan claudecode.StreamEvent {
	return w.session.Events
}

// Ensure ClaudeSessionWrapper implements ClaudeSession
var _ ClaudeSession = (*ClaudeSessionWrapper)(nil)
