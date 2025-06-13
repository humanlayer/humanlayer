// Package api provides thin wrappers around daemon RPC communication.
package api

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/util"
)

// FetchRequests fetches all pending requests (approvals and human contacts)
func (c *clientImpl) FetchRequests() tea.Cmd {
	return func() tea.Msg {
		var allRequests []domain.Request

		// Fetch all pending approvals from daemon
		approvals, err := c.daemonClient.FetchApprovals("")
		if err != nil {
			return domain.FetchRequestsMsg{Err: err}
		}

		// Fetch all sessions to enrich approvals with session context
		sessionsResp, err := c.daemonClient.ListSessions()
		if err != nil {
			// Continue without session info if fetch fails
			sessionsResp = &rpc.ListSessionsResponse{Sessions: []session.Info{}}
		}

		// Create a map of RunID to Session for quick lookup
		sessionsByRunID := make(map[string]session.Info)
		for _, sess := range sessionsResp.Sessions {
			sessionsByRunID[sess.RunID] = sess
		}

		// Convert approvals to our Request type
		for _, approval := range approvals {
			if approval.Type == "function_call" && approval.FunctionCall != nil {
				fc := approval.FunctionCall
				// Build a message from the function name and kwargs
				message := fmt.Sprintf("Call %s", fc.Spec.Fn)
				if len(fc.Spec.Kwargs) > 0 {
					// Add first few parameters to message
					params := []string{}
					for k, v := range fc.Spec.Kwargs {
						params = append(params, fmt.Sprintf("%s=%v", k, v))
						if len(params) >= 2 {
							break
						}
					}
					message += fmt.Sprintf(" with %s", strings.Join(params, ", "))
				}

				createdAt := time.Now() // Default to now if not available
				if fc.Status != nil && fc.Status.RequestedAt != nil {
					createdAt = fc.Status.RequestedAt.Time
				}

				req := domain.Request{
					ID:         fc.CallID,
					CallID:     fc.CallID,
					RunID:      fc.RunID,
					Type:       domain.ApprovalRequest,
					Message:    message,
					Tool:       fc.Spec.Fn,
					Parameters: fc.Spec.Kwargs,
					CreatedAt:  createdAt,
				}

				// Enrich with session info if available
				if sess, ok := sessionsByRunID[fc.RunID]; ok {
					req.SessionID = sess.ID
					req.SessionQuery = util.Truncate(sess.Query, 50)
					req.SessionModel = sess.Model
					if req.SessionModel == "" {
						req.SessionModel = "default"
					}
				}

				allRequests = append(allRequests, req)
			} else if approval.Type == "human_contact" && approval.HumanContact != nil {
				hc := approval.HumanContact
				createdAt := time.Now() // Default to now if not available
				if hc.Status != nil && hc.Status.RequestedAt != nil {
					createdAt = hc.Status.RequestedAt.Time
				}

				req := domain.Request{
					ID:        hc.CallID,
					CallID:    hc.CallID,
					RunID:     hc.RunID,
					Type:      domain.HumanContactRequest,
					Message:   hc.Spec.Msg,
					CreatedAt: createdAt,
				}

				// Enrich with session info if available
				if sess, ok := sessionsByRunID[hc.RunID]; ok {
					req.SessionID = sess.ID
					req.SessionQuery = util.Truncate(sess.Query, 50)
					req.SessionModel = sess.Model
					if req.SessionModel == "" {
						req.SessionModel = "default"
					}
				}

				allRequests = append(allRequests, req)
			}
		}

		return domain.FetchRequestsMsg{Requests: allRequests}
	}
}

// FetchSessionApprovals fetches approvals for a specific session
func (c *clientImpl) FetchSessionApprovals(sessionID string) tea.Cmd {
	return func() tea.Msg {
		// Fetch approvals for specific session
		approvals, err := c.daemonClient.FetchApprovals(sessionID)
		if err != nil {
			return domain.FetchSessionApprovalsMsg{Err: err}
		}

		// Get session info to enrich approvals
		sessionsResp, err := c.daemonClient.ListSessions()
		if err != nil {
			// Continue without session info if fetch fails
			sessionsResp = &rpc.ListSessionsResponse{Sessions: []session.Info{}}
		}

		// Find the specific session
		var sessionInfo *session.Info
		for _, sess := range sessionsResp.Sessions {
			if sess.ID == sessionID {
				sessionInfo = &sess
				break
			}
		}

		// Convert to Request type
		var requests []domain.Request
		for _, approval := range approvals {
			if approval.Type == "function_call" && approval.FunctionCall != nil {
				fc := approval.FunctionCall
				message := fmt.Sprintf("Call %s", fc.Spec.Fn)

				// Add parameters to message
				if len(fc.Spec.Kwargs) > 0 {
					params := []string{}
					for k, v := range fc.Spec.Kwargs {
						params = append(params, fmt.Sprintf("%s=%v", k, v))
						if len(params) >= 2 {
							break
						}
					}
					message += fmt.Sprintf(" with %s", strings.Join(params, ", "))
				}

				createdAt := time.Now()
				if fc.Status != nil && fc.Status.RequestedAt != nil {
					createdAt = fc.Status.RequestedAt.Time
				}

				req := domain.Request{
					ID:         fc.CallID,
					CallID:     fc.CallID,
					RunID:      fc.RunID,
					Type:       domain.ApprovalRequest,
					Message:    message,
					Tool:       fc.Spec.Fn,
					Parameters: fc.Spec.Kwargs,
					CreatedAt:  createdAt,
				}

				// Add session info if available
				if sessionInfo != nil {
					req.SessionID = sessionInfo.ID
					req.SessionQuery = util.Truncate(sessionInfo.Query, 50)
					req.SessionModel = sessionInfo.Model
					if req.SessionModel == "" {
						req.SessionModel = "default"
					}
				}

				requests = append(requests, req)
			} else if approval.Type == "human_contact" && approval.HumanContact != nil {
				hc := approval.HumanContact
				createdAt := time.Now()
				if hc.Status != nil && hc.Status.RequestedAt != nil {
					createdAt = hc.Status.RequestedAt.Time
				}

				req := domain.Request{
					ID:        hc.CallID,
					CallID:    hc.CallID,
					RunID:     hc.RunID,
					Type:      domain.HumanContactRequest,
					Message:   hc.Spec.Msg,
					CreatedAt: createdAt,
				}

				// Add session info if available
				if sessionInfo != nil {
					req.SessionID = sessionInfo.ID
					req.SessionQuery = util.Truncate(sessionInfo.Query, 50)
					req.SessionModel = sessionInfo.Model
					if req.SessionModel == "" {
						req.SessionModel = "default"
					}
				}

				requests = append(requests, req)
			}
		}

		return domain.FetchSessionApprovalsMsg{Approvals: requests}
	}
}

// SendApproval sends an approval decision for a function call
func (c *clientImpl) SendApproval(callID string, approved bool, comment string) tea.Cmd {
	return func() tea.Msg {
		var err error
		if approved {
			err = c.daemonClient.ApproveFunctionCall(callID, comment)
		} else {
			err = c.daemonClient.DenyFunctionCall(callID, comment)
		}

		if err != nil {
			return domain.ApprovalSentMsg{Err: err}
		}

		return domain.ApprovalSentMsg{RequestID: callID, Approved: approved}
	}
}

// SendHumanResponse sends a response to a human contact request
func (c *clientImpl) SendHumanResponse(requestID string, response string) tea.Cmd {
	return func() tea.Msg {
		err := c.daemonClient.RespondToHumanContact(requestID, response)
		if err != nil {
			return domain.HumanResponseSentMsg{Err: err}
		}

		return domain.HumanResponseSentMsg{RequestID: requestID}
	}
}
