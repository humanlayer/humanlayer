package claudecode

import (
	"os/exec"
	"time"
)

// Model represents the available Claude models
type Model string

const (
	ModelOpus   Model = "opus"
	ModelSonnet Model = "sonnet"
)

// OutputFormat specifies the output format for Claude CLI
type OutputFormat string

const (
	OutputText       OutputFormat = "text"
	OutputJSON       OutputFormat = "json"
	OutputStreamJSON OutputFormat = "stream-json"
)

// MCPServer represents a single MCP server configuration
type MCPServer struct {
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// MCPConfig represents the MCP configuration structure
type MCPConfig struct {
	MCPServers map[string]MCPServer `json:"mcpServers"`
}

// SessionConfig contains all configuration for launching a Claude session
type SessionConfig struct {
	// Required
	Query string

	// Session management
	SessionID string // If set, resumes this session

	// Optional
	Model                Model
	OutputFormat         OutputFormat
	MCPConfig            *MCPConfig
	PermissionPromptTool string
	WorkingDir           string
	MaxTurns             int
	SystemPrompt         string
	AppendSystemPrompt   string
	AllowedTools         []string
	DisallowedTools      []string
	CustomInstructions   string
	Verbose              bool
}

// StreamEvent represents a single event from the streaming JSON output
type StreamEvent struct {
	Type      string       `json:"type"`
	Subtype   string       `json:"subtype,omitempty"`
	SessionID string       `json:"session_id,omitempty"`
	Message   *Message     `json:"message,omitempty"`
	Tools     []string     `json:"tools,omitempty"`
	MCPServers []MCPStatus `json:"mcp_servers,omitempty"`

	// Result event fields (when type="result")
	CostUSD     float64   `json:"cost_usd,omitempty"`
	IsError     bool      `json:"is_error,omitempty"`
	DurationMS  int       `json:"duration_ms,omitempty"`
	DurationAPI int       `json:"duration_api_ms,omitempty"`
	NumTurns    int       `json:"num_turns,omitempty"`
	Result      string    `json:"result,omitempty"`
	TotalCost   float64   `json:"total_cost,omitempty"`
	Error       string    `json:"error,omitempty"`
}

// MCPStatus represents the status of an MCP server
type MCPStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// Message represents an assistant or user message
type Message struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Role     string         `json:"role"`
	Model    string         `json:"model,omitempty"`
	Content  []Content      `json:"content"`
	Usage    *Usage         `json:"usage,omitempty"`
}

// Content can be text or tool use
type Content struct {
	Type        string                 `json:"type"`
	Text        string                 `json:"text,omitempty"`
	ID          string                 `json:"id,omitempty"`
	Name        string                 `json:"name,omitempty"`
	Input       map[string]interface{} `json:"input,omitempty"`
	ToolUseID   string                 `json:"tool_use_id,omitempty"`
	Content     string                 `json:"content,omitempty"`
}

// Usage tracks token usage
type Usage struct {
	InputTokens               int `json:"input_tokens"`
	OutputTokens              int `json:"output_tokens"`
	CacheCreationInputTokens  int `json:"cache_creation_input_tokens,omitempty"`
	CacheReadInputTokens      int `json:"cache_read_input_tokens,omitempty"`
}

// Result represents the final result of a Claude session
type Result struct {
	Type        string    `json:"type"`
	Subtype     string    `json:"subtype"`
	CostUSD     float64   `json:"cost_usd"`
	IsError     bool      `json:"is_error"`
	DurationMS  int       `json:"duration_ms"`
	DurationAPI int       `json:"duration_api_ms"`
	NumTurns    int       `json:"num_turns"`
	Result      string    `json:"result"`
	TotalCost   float64   `json:"total_cost"`
	SessionID   string    `json:"session_id"`
	Error       string    `json:"error,omitempty"`
}

// Session represents an active Claude session
type Session struct {
	ID        string
	Config    SessionConfig
	StartTime time.Time

	// For streaming
	Events    chan StreamEvent

	// Process management
	cmd       *exec.Cmd
	done      chan struct{}
	result    *Result
	err       error
}
