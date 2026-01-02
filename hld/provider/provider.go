// Package provider defines interfaces for AI coding tool providers (Claude Code, OpenCode, etc.)
//
// This package provides a provider-agnostic abstraction layer that normalizes events
// from different AI coding tools into a common format.
//
// Usage:
//
//	provider, err := claude.NewProvider()
//	session, err := provider.Launch(ctx, Config{Query: "Write hello world"})
//
//	for event := range session.Events() {
//	    // Process normalized events
//	}
package provider

import (
	"context"
	"time"
)

// Provider represents an AI coding tool that can launch sessions
type Provider interface {
	// Name returns the provider identifier (e.g., "claude", "opencode")
	Name() string

	// IsAvailable checks if the provider's binary/service is accessible
	IsAvailable() bool

	// GetPath returns the path to the provider's binary (if applicable)
	GetPath() string

	// GetVersion returns the provider's version string
	GetVersion() (string, error)

	// Launch starts a new session with the given configuration
	Launch(ctx context.Context, config Config) (Session, error)
}

// Session represents an active coding assistant session
type Session interface {
	// GetID returns the session ID assigned by the provider
	GetID() string

	// Events returns a channel of streaming events
	Events() <-chan Event

	// Wait blocks until the session completes and returns the result
	Wait() (*Result, error)

	// Interrupt sends an interrupt signal to the session
	Interrupt() error

	// Kill forcefully terminates the session
	Kill() error
}

// Config contains configuration for launching a provider session
type Config struct {
	// Query is the initial prompt/task
	Query string

	// SessionID is used to resume an existing session (provider-specific)
	SessionID string

	// ForkSession creates a fork instead of resuming
	ForkSession bool

	// Model specifies the model to use
	Model string

	// WorkingDir is the working directory for the session
	WorkingDir string

	// MaxTurns limits the number of conversation turns
	MaxTurns int

	// SystemPrompt overrides the default system prompt
	SystemPrompt string

	// AppendSystemPrompt appends to the system prompt
	AppendSystemPrompt string

	// AllowedTools lists tools that are allowed
	AllowedTools []string

	// DisallowedTools lists tools that are disallowed
	DisallowedTools []string

	// AdditionalDirectories are extra directories the assistant can access
	AdditionalDirectories []string

	// CustomInstructions are additional instructions for the assistant
	CustomInstructions string

	// Env contains environment variables for the session process
	Env map[string]string

	// MCPServers configures MCP server connections
	MCPServers map[string]MCPServer

	// PermissionPromptTool specifies the MCP tool for permission requests
	PermissionPromptTool string

	// Verbose enables verbose output
	Verbose bool

	// Title is an optional session title
	Title string

	// Files to attach to the session (OpenCode)
	Files []string

	// Agent to use (OpenCode)
	Agent string
}

// MCPServer represents an MCP server configuration
type MCPServer struct {
	// For stdio-based servers
	Command string
	Args    []string
	Env     map[string]string

	// For HTTP servers
	Type    string // "http" for HTTP servers
	URL     string
	Headers map[string]string
}

// EventType identifies the type of streaming event
type EventType string

const (
	EventTypeStepStart  EventType = "step_start"
	EventTypeText       EventType = "text"
	EventTypeToolUse    EventType = "tool_use"
	EventTypeToolResult EventType = "tool_result"
	EventTypeThinking   EventType = "thinking"
	EventTypeStepFinish EventType = "step_finish"
	EventTypeSystem     EventType = "system"
	EventTypeResult     EventType = "result"
)

// Event is a normalized streaming event from any provider
type Event struct {
	// Type identifies the event type
	Type EventType

	// Subtype provides additional classification
	Subtype string

	// SessionID is the provider's session identifier
	SessionID string

	// MessageID identifies the message this event belongs to
	MessageID string

	// Timestamp when the event occurred
	Timestamp time.Time

	// Role is the message role (user, assistant, system)
	Role string

	// Text content for text events
	Text string

	// Tool information for tool_use events
	Tool *ToolCall

	// ToolResult for tool_result events
	ToolResult *ToolResultData

	// Thinking content for thinking events
	Thinking string

	// Finish information for step_finish events
	Finish *FinishInfo

	// System information for system events
	System *SystemInfo

	// Result information for result events
	Result *ResultInfo

	// ParentToolUseID links subagent events to their parent
	ParentToolUseID string

	// Raw contains the original event data for debugging
	Raw interface{}
}

// ToolCall represents a tool invocation
type ToolCall struct {
	ID     string
	Name   string
	Input  map[string]interface{}
	Status string // "pending", "running", "completed", "failed"
	Output string
}

// ToolResultData represents the result of a tool call
type ToolResultData struct {
	ToolUseID string
	Content   string
	IsError   bool
}

// FinishInfo contains information about why a step finished
type FinishInfo struct {
	Reason string  // "stop", "tool-calls", etc.
	Cost   float64 // Cost in USD for this step
	Tokens *TokenUsage
}

// TokenUsage tracks token consumption
type TokenUsage struct {
	Input      int
	Output     int
	Reasoning  int
	CacheRead  int
	CacheWrite int
}

// SystemInfo contains system event information
type SystemInfo struct {
	Model          string
	CWD            string
	PermissionMode string
	Tools          []string
	MCPServers     []MCPServerStatus
}

// MCPServerStatus tracks MCP server connection status
type MCPServerStatus struct {
	Name   string
	Status string
}

// ResultInfo contains session completion information
type ResultInfo struct {
	IsError    bool
	Error      string
	Result     string
	Cost       float64
	DurationMS int
	NumTurns   int
}

// Result represents the final result of a provider session
type Result struct {
	// SessionID assigned by the provider
	SessionID string

	// Result is the final text result
	Result string

	// IsError indicates if the session failed
	IsError bool

	// Error message if IsError is true
	Error string

	// Cost in USD
	Cost float64

	// DurationMS is the session duration in milliseconds
	DurationMS int

	// NumTurns is the number of conversation turns
	NumTurns int

	// Token usage
	InputTokens      int
	OutputTokens     int
	CacheReadTokens  int
	CacheWriteTokens int
}
