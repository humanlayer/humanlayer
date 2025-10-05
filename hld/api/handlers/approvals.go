package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/mapper"
	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
	"log/slog"
)

type ApprovalHandlers struct {
	approvalManager approval.Manager
	sessionManager  session.SessionManager
	mapper          *mapper.Mapper
}

func NewApprovalHandlers(approvalManager approval.Manager, sessionManager session.SessionManager) *ApprovalHandlers {
	return &ApprovalHandlers{
		approvalManager: approvalManager,
		sessionManager:  sessionManager,
		mapper:          &mapper.Mapper{},
	}
}

// CreateApproval creates a new approval request
func (h *ApprovalHandlers) CreateApproval(ctx context.Context, req api.CreateApprovalRequestObject) (api.CreateApprovalResponseObject, error) {
	// Convert tool input to json.RawMessage
	toolInputJSON, err := json.Marshal(req.Body.ToolInput)
	if err != nil {
		return api.CreateApproval400JSONResponse{
			BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-3001",
					Message: "invalid tool input format",
				},
			},
		}, nil
	}

	approvalID, err := h.approvalManager.CreateApproval(
		ctx,
		req.Body.RunId,
		req.Body.ToolName,
		toolInputJSON,
	)
	if err != nil {
		slog.Error("Failed to create approval",
			"error", fmt.Sprintf("%v", err),
			"run_id", req.Body.RunId,
			"tool_name", req.Body.ToolName,
			"operation", "CreateApproval",
		)
		return api.CreateApproval500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	resp := api.CreateApprovalResponse{}
	resp.Data.ApprovalId = approvalID
	return api.CreateApproval201JSONResponse(resp), nil
}

// ListApprovals retrieves approval requests with optional filtering
func (h *ApprovalHandlers) ListApprovals(ctx context.Context, req api.ListApprovalsRequestObject) (api.ListApprovalsResponseObject, error) {
	var approvals []*store.Approval
	var err error

	if req.Params.SessionId != nil {
		approvals, err = h.approvalManager.GetPendingApprovals(ctx, *req.Params.SessionId)
	} else {
		// Return empty array when no session filter
		approvals = []*store.Approval{}
	}

	if err != nil {
		slog.Error("Failed to list approvals",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Params.SessionId,
			"operation", "ListApprovals",
		)
		return api.ListApprovals500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	// Convert to non-pointer slice for mapper
	approvalsSlice := make([]store.Approval, len(approvals))
	for i, a := range approvals {
		approvalsSlice[i] = *a
	}

	resp := api.ApprovalsResponse{
		Data: h.mapper.ApprovalsToAPI(approvalsSlice),
	}
	return api.ListApprovals200JSONResponse(resp), nil
}

// GetApproval retrieves details for a specific approval
func (h *ApprovalHandlers) GetApproval(ctx context.Context, req api.GetApprovalRequestObject) (api.GetApprovalResponseObject, error) {
	approval, err := h.approvalManager.GetApproval(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, store.ErrNotFound) {
			return api.GetApproval404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-1002",
						Message: "Approval not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to get approval",
			"error", fmt.Sprintf("%v", err),
			"approval_id", req.Id,
			"operation", "GetApproval",
		)
		return api.GetApproval500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	resp := api.ApprovalResponse{
		Data: h.mapper.ApprovalToAPI(*approval),
	}
	return api.GetApproval200JSONResponse(resp), nil
}

// DecideApproval approves or denies an approval request
func (h *ApprovalHandlers) DecideApproval(ctx context.Context, req api.DecideApprovalRequestObject) (api.DecideApprovalResponseObject, error) {
	// Validate comment requirement for deny
	if req.Body.Decision == api.Deny && (req.Body.Comment == nil || *req.Body.Comment == "") {
		return api.DecideApproval400JSONResponse{
			Error: api.ErrorDetail{
				Code:    "HLD-3001",
				Message: "comment is required when denying",
			},
		}, nil
	}

	comment := ""
	if req.Body.Comment != nil {
		comment = *req.Body.Comment
	}

	var err error
	switch req.Body.Decision {
	case api.Approve:
		err = h.approvalManager.ApproveToolCall(ctx, string(req.Id), comment)
	case api.Deny:
		err = h.approvalManager.DenyToolCall(ctx, string(req.Id), comment)
	default:
		return api.DecideApproval400JSONResponse{
			Error: api.ErrorDetail{
				Code:    "HLD-3001",
				Message: "invalid decision",
			},
		}, nil
	}

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return api.DecideApproval404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-1002",
						Message: "Approval not found",
					},
				},
			}, nil
		}
		if errors.Is(err, store.ErrAlreadyDecided) {
			return api.DecideApproval400JSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-3002",
					Message: err.Error(),
				},
			}, nil
		}
		slog.Error("Failed to decide approval",
			"error", fmt.Sprintf("%v", err),
			"approval_id", req.Id,
			"decision", req.Body.Decision,
			"operation", "DecideApproval",
		)
		return api.DecideApproval500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	resp := api.DecideApprovalResponse{}
	resp.Data.Success = true
	return api.DecideApproval200JSONResponse(resp), nil
}
