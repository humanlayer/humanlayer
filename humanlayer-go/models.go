package humanlayer

import "time"

// ApprovalRequest represents a pending approval request
type ApprovalRequest struct {
	ID         string                 `json:"id"`
	CallID     string                 `json:"call_id"`
	RunID      string                 `json:"run_id"`
	Tool       string                 `json:"tool"`
	ToolArgs   map[string]interface{} `json:"tool_args"`
	AgentName  string                 `json:"agent_name"`
	Message    string                 `json:"message"`
	CreatedAt  time.Time              `json:"created_at"`
	Status     string                 `json:"status"`
}

// HumanContactRequest represents a pending human contact request
type HumanContactRequest struct {
	ID        string    `json:"id"`
	CallID    string    `json:"call_id"`
	RunID     string    `json:"run_id"`
	Message   string    `json:"message"`
	AgentName string    `json:"agent_name"`
	CreatedAt time.Time `json:"created_at"`
	Status    string    `json:"status"`
}

// ApprovalResponse represents a response to an approval request
type ApprovalResponse struct {
	Approved bool   `json:"approved"`
	Comment  string `json:"comment,omitempty"`
}

// HumanContactResponse represents a response to a human contact
type HumanContactResponse struct {
	Response string `json:"response"`
}