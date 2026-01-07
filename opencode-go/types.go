package opencode

import (
	"encoding/json"
	"os/exec"
	"sync"
	"time"
)

// Model represents the model identifier in provider/model format
type Model string

// OutputFormat specifies the output format for OpenCode CLI
type OutputFormat string

const (
	OutputDefault OutputFormat = "default"
	OutputJSON    OutputFormat = "json"
)

// SessionConfig contains all configuration for launching an OpenCode session
type SessionConfig struct {
	// Required
	Query string

	// Session management
	SessionID    string // If set, continues this session
	ContinueLast bool   // If true, continues the last session
	Title        string // Session title

	// Model selection (format: provider/model, e.g., "anthropic/claude-sonnet-4-20250514")
	Model Model

	// Output format
	OutputFormat OutputFormat

	// Working directory
	WorkingDir string

	// Files to attach
	Files []string

	// Agent to use
	Agent string

	// Attach to existing server
	AttachURL string

	// Local server port
	Port int

	// Environment variables
	Env map[string]string
}

// StreamEvent represents a single event from the streaming JSON output
type StreamEvent struct {
	Type      string          `json:"type"`
	Timestamp int64           `json:"timestamp"`
	SessionID string          `json:"sessionID"`
	Part      json.RawMessage `json:"part"`

	// Parsed part fields (populated after parsing)
	PartData *EventPart `json:"-"`
}

// EventPart represents the parsed "part" field of a StreamEvent
type EventPart struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionID"`
	MessageID string `json:"messageID"`
	Type      string `json:"type"`

	// For text events
	Text string `json:"text,omitempty"`

	// For tool_use events
	CallID string     `json:"callID,omitempty"`
	Tool   string     `json:"tool,omitempty"`
	State  *ToolState `json:"state,omitempty"`
	Title  string     `json:"title,omitempty"`

	// For step_finish events
	Reason string      `json:"reason,omitempty"`
	Cost   float64     `json:"cost,omitempty"`
	Tokens *TokenUsage `json:"tokens,omitempty"`

	// Timing info
	Time *TimeInfo `json:"time,omitempty"`

	// Metadata
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// ToolState represents the state of a tool call
type ToolState struct {
	Status string                 `json:"status"`
	Input  map[string]interface{} `json:"input,omitempty"`
	Output string                 `json:"output,omitempty"`
}

// TokenUsage represents token usage information
type TokenUsage struct {
	Input     int         `json:"input"`
	Output    int         `json:"output"`
	Reasoning int         `json:"reasoning"`
	Cache     *CacheUsage `json:"cache,omitempty"`
}

// CacheUsage represents cache token usage
type CacheUsage struct {
	Read  int `json:"read"`
	Write int `json:"write"`
}

// TimeInfo represents timing information
type TimeInfo struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

// Result represents the final result of an OpenCode session
type Result struct {
	SessionID  string  `json:"session_id"`
	Result     string  `json:"result"`
	IsError    bool    `json:"is_error"`
	TotalCost  float64 `json:"total_cost"`
	DurationMS int64   `json:"duration_ms"`
	NumTurns   int     `json:"num_turns"`

	// Aggregated token usage
	TotalInputTokens  int `json:"total_input_tokens"`
	TotalOutputTokens int `json:"total_output_tokens"`

	// Error info
	Error string `json:"error,omitempty"`
}

// Session represents an active OpenCode session
type Session struct {
	ID        string
	Config    SessionConfig
	StartTime time.Time

	// For streaming
	Events chan StreamEvent

	// Process management
	cmd    *exec.Cmd
	done   chan struct{}
	result *Result

	// Thread-safe error handling
	mu  sync.RWMutex
	err error

	// Aggregated data during streaming
	textBuffer        string
	totalInputTokens  int
	totalOutputTokens int
	totalCost         float64
	numTurns          int
}

// SetError safely sets the error
func (s *Session) SetError(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err == nil {
		s.err = err
	}
}

// Error safely gets the error
func (s *Session) Error() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}
