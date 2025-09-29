package claudecode

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
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
// It can be either a stdio-based server (with command/args/env) or an HTTP server (with type/url/headers)
type MCPServer struct {
	// For stdio-based servers
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`

	// For HTTP servers
	Type    string            `json:"type,omitempty"`    // "http" for HTTP servers
	URL     string            `json:"url,omitempty"`     // The HTTP endpoint URL
	Headers map[string]string `json:"headers,omitempty"` // HTTP headers to include
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
	Model                 Model
	OutputFormat          OutputFormat
	MCPConfig             *MCPConfig
	PermissionPromptTool  string
	WorkingDir            string
	MaxTurns              int
	SystemPrompt          string
	AppendSystemPrompt    string
	AllowedTools          []string
	DisallowedTools       []string
	AdditionalDirectories []string
	CustomInstructions    string
	Verbose               bool
	Env                   map[string]string // Environment variables to set for the Claude process
}

// StreamEvent represents a single event from the streaming JSON output
type StreamEvent struct {
	Type       string      `json:"type"`
	Subtype    string      `json:"subtype,omitempty"`
	SessionID  string      `json:"session_id,omitempty"`
	Message    *Message    `json:"message,omitempty"`
	Tools      []string    `json:"tools,omitempty"`
	MCPServers []MCPStatus `json:"mcp_servers,omitempty"`

	// Parent tracking for sub-tasks
	ParentToolUseID string `json:"parent_tool_use_id,omitempty"`

	// System event fields (when type="system" and subtype="init")
	CWD            string `json:"cwd,omitempty"`
	Model          string `json:"model,omitempty"`
	PermissionMode string `json:"permissionMode,omitempty"`
	APIKeySource   string `json:"apiKeySource,omitempty"`

	// Result event fields (when type="result")
	CostUSD           float64                     `json:"total_cost_usd,omitempty"`
	IsError           bool                        `json:"is_error,omitempty"`
	DurationMS        int                         `json:"duration_ms,omitempty"`
	DurationAPI       int                         `json:"duration_api_ms,omitempty"`
	NumTurns          int                         `json:"num_turns,omitempty"`
	Result            string                      `json:"result,omitempty"`
	Usage             *Usage                      `json:"usage,omitempty"`
	ModelUsage        map[string]ModelUsageDetail `json:"modelUsage,omitempty"`
	Error             string                      `json:"error,omitempty"`
	PermissionDenials *PermissionDenials          `json:"permission_denials,omitempty"`
	UUID              string                      `json:"uuid,omitempty"`
}

// MCPStatus represents the status of an MCP server
type MCPStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// Message represents an assistant or user message
type Message struct {
	ID      string    `json:"id"`
	Type    string    `json:"type"`
	Role    string    `json:"role"`
	Model   string    `json:"model,omitempty"`
	Content []Content `json:"content"`
	Usage   *Usage    `json:"usage,omitempty"`
}

// ContentField handles both string and array content formats
type ContentField struct {
	Value string
}

// UnmarshalJSON implements custom unmarshaling to handle both string and array formats
func (c *ContentField) UnmarshalJSON(data []byte) error {
	// First try to unmarshal as string
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		c.Value = str
		return nil
	}

	// If that fails, try array format
	var arr []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(data, &arr); err == nil {
		// Concatenate all text elements
		var texts []string
		for _, item := range arr {
			if item.Type == "text" && item.Text != "" {
				texts = append(texts, item.Text)
			}
		}
		c.Value = strings.Join(texts, "\n")
		return nil
	}

	return fmt.Errorf("content field is neither string nor array format")
}

// MarshalJSON implements custom marshaling to always output as string
func (c ContentField) MarshalJSON() ([]byte, error) {
	return json.Marshal(c.Value)
}

// Content can be text or tool use
type Content struct {
	Type      string                 `json:"type"`
	Text      string                 `json:"text,omitempty"`
	Thinking  string                 `json:"thinking,omitempty"`
	ID        string                 `json:"id,omitempty"`
	Name      string                 `json:"name,omitempty"`
	Input     map[string]interface{} `json:"input,omitempty"`
	ToolUseID string                 `json:"tool_use_id,omitempty"`
	Content   ContentField           `json:"content,omitempty"`
}

// ServerToolUse tracks server-side tool usage
type ServerToolUse struct {
	WebSearchRequests int `json:"web_search_requests,omitempty"`
}

// CacheCreation tracks cache creation metrics
type CacheCreation struct {
	Ephemeral1HInputTokens int `json:"ephemeral_1h_input_tokens,omitempty"`
	Ephemeral5MInputTokens int `json:"ephemeral_5m_input_tokens,omitempty"`
}

// Usage tracks token usage
type Usage struct {
	InputTokens              int            `json:"input_tokens"`
	OutputTokens             int            `json:"output_tokens"`
	CacheCreationInputTokens int            `json:"cache_creation_input_tokens,omitempty"`
	CacheReadInputTokens     int            `json:"cache_read_input_tokens,omitempty"`
	ServiceTier              string         `json:"service_tier,omitempty"`
	ServerToolUse            *ServerToolUse `json:"server_tool_use,omitempty"`
	CacheCreation            *CacheCreation `json:"cache_creation,omitempty"`
}

// PermissionDenial represents a single permission denial from Claude
type PermissionDenial struct {
	ToolName  string                 `json:"tool_name"`
	ToolUseID string                 `json:"tool_use_id"`
	ToolInput map[string]interface{} `json:"tool_input,omitempty"`
}

// PermissionDenials handles flexible permission denial formats
type PermissionDenials struct {
	Denials []PermissionDenial
}

// UnmarshalJSON implements custom unmarshaling to handle both object and string array formats
func (p *PermissionDenials) UnmarshalJSON(data []byte) error {
	// Handle null
	if string(data) == "null" {
		p.Denials = nil
		return nil
	}

	// Try as array of objects first (current API format)
	var denials []PermissionDenial
	if err := json.Unmarshal(data, &denials); err == nil {
		p.Denials = denials
		return nil
	}

	// Fall back to array of strings (legacy/simple format)
	var legacyStrings []string
	if err := json.Unmarshal(data, &legacyStrings); err == nil {
		p.Denials = make([]PermissionDenial, len(legacyStrings))
		for i, s := range legacyStrings {
			p.Denials[i] = PermissionDenial{ToolName: s}
		}
		return nil
	}

	return fmt.Errorf("permission_denials is neither object array nor string array format")
}

// MarshalJSON implements custom marshaling
func (p PermissionDenials) MarshalJSON() ([]byte, error) {
	return json.Marshal(p.Denials)
}

// ToStrings converts denials to string array for backward compatibility
func (p PermissionDenials) ToStrings() []string {
	if p.Denials == nil {
		return nil
	}
	result := make([]string, len(p.Denials))
	for i, d := range p.Denials {
		result[i] = d.ToolName
	}
	return result
}

// ModelUsageDetail represents usage details for a specific model
type ModelUsageDetail struct {
	InputTokens              int     `json:"inputTokens"`
	OutputTokens             int     `json:"outputTokens"`
	CacheReadInputTokens     int     `json:"cacheReadInputTokens"`
	CacheCreationInputTokens int     `json:"cacheCreationInputTokens"`
	WebSearchRequests        int     `json:"webSearchRequests"`
	CostUSD                  float64 `json:"costUSD"`
	ContextWindow            int     `json:"contextWindow,omitempty"`
}

// Result represents the final result of a Claude session
type Result struct {
	Type              string                      `json:"type"`
	Subtype           string                      `json:"subtype"`
	CostUSD           float64                     `json:"total_cost_usd"`
	IsError           bool                        `json:"is_error"`
	DurationMS        int                         `json:"duration_ms"`
	DurationAPI       int                         `json:"duration_api_ms"`
	NumTurns          int                         `json:"num_turns"`
	Result            string                      `json:"result"`
	SessionID         string                      `json:"session_id"`
	Usage             *Usage                      `json:"usage,omitempty"`
	ModelUsage        map[string]ModelUsageDetail `json:"modelUsage,omitempty"`
	Error             string                      `json:"error,omitempty"`
	PermissionDenials *PermissionDenials          `json:"permission_denials,omitempty"`
	UUID              string                      `json:"uuid,omitempty"`
}

// Session represents an active Claude session
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
