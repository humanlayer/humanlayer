package rpc

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/session"
)

// ApprovalHandlers provides RPC handlers for approval management
type ApprovalHandlers struct {
	approvals approval.Manager
	sessions  *session.Manager
}

// NewApprovalHandlers creates new approval RPC handlers
func NewApprovalHandlers(approvals approval.Manager, sessions *session.Manager) *ApprovalHandlers {
	return &ApprovalHandlers{
		approvals: approvals,
		sessions:  sessions,
	}
}

// FetchApprovalsRequest is the request for fetching approvals
type FetchApprovalsRequest struct {
	SessionID string `json:"session_id,omitempty"` // Optional filter by session
}

// FetchApprovalsResponse is the response for fetching approvals
type FetchApprovalsResponse struct {
	Approvals []approval.PendingApproval `json:"approvals"`
}

// HandleFetchApprovals handles the FetchApprovals RPC method
func (h *ApprovalHandlers) HandleFetchApprovals(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req FetchApprovalsRequest
	if params != nil {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, fmt.Errorf("invalid request: %w", err)
		}
	}

	var approvals []approval.PendingApproval
	var err error

	if req.SessionID != "" {
		// Get the session to find its run_id
		sessionInfo, err := h.sessions.GetSessionInfo(req.SessionID)
		if err != nil {
			return nil, fmt.Errorf("session not found: %w", err)
		}
		
		// Get approvals by run_id
		approvals, err = h.approvals.GetPendingApprovalsByRunID(sessionInfo.RunID)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch approvals: %w", err)
		}
	} else {
		// Get all pending approvals
		approvals, err = h.approvals.GetPendingApprovals("")
		if err != nil {
			return nil, fmt.Errorf("failed to fetch approvals: %w", err)
		}
	}

	return &FetchApprovalsResponse{
		Approvals: approvals,
	}, nil
}

// SendDecisionRequest is the request for sending a decision
type SendDecisionRequest struct {
	CallID   string `json:"call_id"`
	Type     string `json:"type"`     // "function_call" or "human_contact"
	Decision string `json:"decision"` // "approve", "deny", or "respond"
	Comment  string `json:"comment,omitempty"`
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
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate required fields
	if req.CallID == "" {
		return nil, fmt.Errorf("call_id is required")
	}
	if req.Type == "" {
		return nil, fmt.Errorf("type is required")
	}
	if req.Decision == "" {
		return nil, fmt.Errorf("decision is required")
	}

	var err error

	switch req.Type {
	case "function_call":
		switch req.Decision {
		case "approve":
			err = h.approvals.ApproveFunctionCall(ctx, req.CallID, req.Comment)
		case "deny":
			if req.Comment == "" {
				return nil, fmt.Errorf("comment is required for denial")
			}
			err = h.approvals.DenyFunctionCall(ctx, req.CallID, req.Comment)
		default:
			return nil, fmt.Errorf("invalid decision for function_call: %s", req.Decision)
		}
	case "human_contact":
		if req.Decision != "respond" {
			return nil, fmt.Errorf("invalid decision for human_contact: %s", req.Decision)
		}
		if req.Comment == "" {
			return nil, fmt.Errorf("comment is required for human contact response")
		}
		err = h.approvals.RespondToHumanContact(ctx, req.CallID, req.Comment)
	default:
		return nil, fmt.Errorf("invalid type: %s", req.Type)
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

// Register registers all approval handlers with the RPC server
func (h *ApprovalHandlers) Register(server *Server) {
	server.Register("fetchApprovals", h.HandleFetchApprovals)
	server.Register("sendDecision", h.HandleSendDecision)
}