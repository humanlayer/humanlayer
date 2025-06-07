package rpc

// HealthCheckRequest is the request for health check RPC
type HealthCheckRequest struct{}

// HealthCheckResponse is the response for health check RPC
type HealthCheckResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// GetConversationRequest is the request for fetching conversation history
type GetConversationRequest struct {
	SessionID       string `json:"session_id,omitempty"`        // Get by session ID
	ClaudeSessionID string `json:"claude_session_id,omitempty"` // Get by Claude session ID
}

// ConversationEvent represents a single event in the conversation
type ConversationEvent struct {
	ID              int64  `json:"id"`
	SessionID       string `json:"session_id"`
	ClaudeSessionID string `json:"claude_session_id"`
	Sequence        int    `json:"sequence"`
	EventType       string `json:"event_type"` // 'message', 'tool_call', 'tool_result', 'system'
	CreatedAt       string `json:"created_at"` // ISO 8601 timestamp

	// Message fields
	Role    string `json:"role,omitempty"` // user, assistant, system
	Content string `json:"content,omitempty"`

	// Tool call fields
	ToolID        string `json:"tool_id,omitempty"`
	ToolName      string `json:"tool_name,omitempty"`
	ToolInputJSON string `json:"tool_input_json,omitempty"`

	// Tool result fields
	ToolResultForID   string `json:"tool_result_for_id,omitempty"`
	ToolResultContent string `json:"tool_result_content,omitempty"`

	// Approval tracking
	IsCompleted    bool   `json:"is_completed"`
	ApprovalStatus string `json:"approval_status,omitempty"` // NULL, 'pending', 'approved', 'denied'
	ApprovalID     string `json:"approval_id,omitempty"`
}

// GetConversationResponse is the response for fetching conversation history
type GetConversationResponse struct {
	Events []ConversationEvent `json:"events"`
}

// GetSessionStateRequest is the request for fetching session state
type GetSessionStateRequest struct {
	SessionID string `json:"session_id"`
}

// SessionState represents the current state of a session
type SessionState struct {
	ID              string  `json:"id"`
	RunID           string  `json:"run_id"`
	ClaudeSessionID string  `json:"claude_session_id,omitempty"`
	Status          string  `json:"status"` // starting, running, completed, failed, waiting_input
	Query           string  `json:"query"`
	Model           string  `json:"model,omitempty"`
	WorkingDir      string  `json:"working_dir,omitempty"`
	CreatedAt       string  `json:"created_at"`
	LastActivityAt  string  `json:"last_activity_at"`
	CompletedAt     string  `json:"completed_at,omitempty"`
	ErrorMessage    string  `json:"error_message,omitempty"`
	CostUSD         float64 `json:"cost_usd,omitempty"`
	TotalTokens     int     `json:"total_tokens,omitempty"`
	DurationMS      int     `json:"duration_ms,omitempty"`
}

// GetSessionStateResponse is the response for fetching session state
type GetSessionStateResponse struct {
	Session SessionState `json:"session"`
}
