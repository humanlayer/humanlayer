package rpc

import (
	"context"
	"encoding/json"

	"github.com/humanlayer/humanlayer/hld/approval"
	hlderrors "github.com/humanlayer/humanlayer/hld/errors"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

// ApprovalHandlers provides RPC handlers for local approval management
type ApprovalHandlers struct {
	approvals approval.Manager
	sessions  session.SessionManager
}

// NewApprovalHandlers creates new local approval RPC handlers
func NewApprovalHandlers(approvals approval.Manager, sessions session.SessionManager) *ApprovalHandlers {
	return &ApprovalHandlers{
		approvals: approvals,
		sessions:  sessions,
	}
}

// CreateApprovalRequest is the request for creating a local approval
type CreateApprovalRequest struct {
	RunID     string          `json:"run_id"`
	ToolName  string          `json:"tool_name"`
	ToolInput json.RawMessage `json:"tool_input"`
}

// CreateApprovalResponse is the response for creating a local approval
type CreateApprovalResponse struct {
	ApprovalID string `json:"approval_id"`
}

// HandleCreateApproval handles the CreateApproval RPC method
func (h *ApprovalHandlers) HandleCreateApproval(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req CreateApprovalRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, hlderrors.NewValidationError("params", "invalid JSON")
	}

	// Validate required fields
	if req.RunID == "" {
		return nil, hlderrors.NewValidationError("run_id", "required field")
	}
	if req.ToolName == "" {
		return nil, hlderrors.NewValidationError("tool_name", "required field")
	}
	if req.ToolInput == nil {
		return nil, hlderrors.NewValidationError("tool_input", "required field")
	}

	// Create the approval
	approvalID, err := h.approvals.CreateApproval(ctx, req.RunID, req.ToolName, req.ToolInput)
	if err != nil {
		return nil, hlderrors.NewApprovalError("create", "", err)
	}

	return &CreateApprovalResponse{
		ApprovalID: approvalID,
	}, nil
}

// FetchApprovalsRequest is the request for fetching approvals
type FetchApprovalsRequest struct {
	SessionID string `json:"session_id,omitempty"` // Optional filter by session
}

// FetchApprovalsResponse is the response for fetching approvals
type FetchApprovalsResponse struct {
	Approvals []*store.Approval `json:"approvals"`
}

// HandleFetchApprovals handles the FetchApprovals RPC method
func (h *ApprovalHandlers) HandleFetchApprovals(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req FetchApprovalsRequest
	if params != nil {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, hlderrors.NewValidationError("params", "invalid JSON")
		}
	}

	// If no session ID provided, return empty list
	if req.SessionID == "" {
		return &FetchApprovalsResponse{
			Approvals: []*store.Approval{},
		}, nil
	}

	// Get approvals for the session
	approvals, err := h.approvals.GetPendingApprovals(ctx, req.SessionID)
	if err != nil {
		return nil, hlderrors.NewStoreError("get_pending_approvals", "approvals", err)
	}

	return &FetchApprovalsResponse{
		Approvals: approvals,
	}, nil
}

// SendDecisionRequest is the request for sending a decision
type SendDecisionRequest struct {
	ApprovalID string `json:"approval_id"`
	Decision   string `json:"decision"`
	Comment    string `json:"comment,omitempty"`
}

// SendDecisionResponse is the response for sending a decision
type SendDecisionResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// HandleSendDecision handles the SendDecision RPC method
func (h *ApprovalHandlers) HandleSendDecision(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req SendDecisionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, hlderrors.NewValidationError("params", "invalid JSON")
	}

	// Validate required fields
	if req.ApprovalID == "" {
		return nil, hlderrors.NewValidationError("approval_id", "required field")
	}
	if req.Decision == "" {
		return nil, hlderrors.NewValidationError("decision", "required field")
	}

	var err error

	switch req.Decision {
	case "approve":
		err = h.approvals.ApproveToolCall(ctx, req.ApprovalID, req.Comment)
	case "deny":
		if req.Comment == "" {
			return nil, hlderrors.NewValidationError("comment", "required for denial")
		}
		err = h.approvals.DenyToolCall(ctx, req.ApprovalID, req.Comment)
	default:
		return nil, &hlderrors.ValidationError{
			Field:   "decision",
			Value:   req.Decision,
			Message: "must be 'approve' or 'deny'",
		}
	}

	if err != nil {
		return &SendDecisionResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	return &SendDecisionResponse{
		Success: true,
	}, nil
}

// GetApprovalRequest is the request for getting a specific approval
type GetApprovalRequest struct {
	ApprovalID string `json:"approval_id"`
}

// GetApprovalResponse is the response for getting a specific approval
type GetApprovalResponse struct {
	Approval *store.Approval `json:"approval"`
}

// HandleGetApproval handles the GetApproval RPC method
func (h *ApprovalHandlers) HandleGetApproval(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req GetApprovalRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, hlderrors.NewValidationError("params", "invalid JSON")
	}

	// Validate required fields
	if req.ApprovalID == "" {
		return nil, hlderrors.NewValidationError("approval_id", "required field")
	}

	// Get the approval
	approval, err := h.approvals.GetApproval(ctx, req.ApprovalID)
	if err != nil {
		return nil, hlderrors.NewApprovalError("get", req.ApprovalID, err)
	}

	return &GetApprovalResponse{
		Approval: approval,
	}, nil
}

// Register registers all local approval handlers with the RPC server
func (h *ApprovalHandlers) Register(server *Server) {
	server.Register("createApproval", h.HandleCreateApproval)
	server.Register("fetchApprovals", h.HandleFetchApprovals)
	server.Register("getApproval", h.HandleGetApproval)
	server.Register("sendDecision", h.HandleSendDecision)
}
