package main

import (
	"encoding/json"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
)

// Helper functions

func truncate(s string, max int) string {
	// Replace newlines and other whitespace with spaces first
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\t", " ")

	if len(s) <= max {
		return s
	}
	if max > 3 {
		return s[:max-3] + "..."
	}
	return s[:max]
}

// preprocessError converts common API errors into user-friendly messages
func preprocessError(errMsg string) string {
	// Handle "call already has a response" errors
	if strings.Contains(errMsg, "call already has a response") {
		// Extract just the key part of the error
		if strings.Contains(errMsg, "400 Bad Request") {
			return "Approval already responded to"
		}
		return "Call already has a response"
	}

	// Handle other common API errors
	if strings.Contains(errMsg, "409 Conflict") {
		return "Conflict: Resource already exists"
	}

	if strings.Contains(errMsg, "404 Not Found") {
		return "Resource not found"
	}

	if strings.Contains(errMsg, "500 Internal Server Error") {
		return "Server error occurred"
	}

	// Remove excessive technical details like stack traces
	if idx := strings.Index(errMsg, "\n"); idx > 0 {
		errMsg = errMsg[:idx]
	}

	return errMsg
}

// API command messages

type fetchRequestsMsg struct {
	requests []Request
	err      error
}

type fetchSessionsMsg struct {
	sessions []session.Info
	err      error
}

type launchSessionMsg struct {
	sessionID string
	runID     string
	err       error
}

type fetchSessionApprovalsMsg struct {
	approvals []Request
	err       error
}

type approvalSentMsg struct {
	requestID string
	approved  bool
	err       error
}

type humanResponseSentMsg struct {
	requestID string
	err       error
}

type subscriptionMsg struct {
	eventChannel <-chan rpc.EventNotification
	err          error
}

type eventNotificationMsg struct {
	event rpc.EventNotification
}

// API command functions

func fetchRequests(daemonClient client.Client) tea.Cmd {
	return func() tea.Msg {
		var allRequests []Request

		// Fetch all pending approvals from daemon
		approvals, err := daemonClient.FetchApprovals("")
		if err != nil {
			return fetchRequestsMsg{err: err}
		}

		// Fetch all sessions to enrich approvals with session context
		sessionsResp, err := daemonClient.ListSessions()
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
			// For local approvals, we always have tool calls
			// Build a message from the tool name and input
			message := fmt.Sprintf("Call %s", approval.ToolName)

			// Parse tool input to extract parameters
			var toolParams map[string]interface{}
			if len(approval.ToolInput) > 0 {
				// Try to parse as JSON to get parameters
				if err := json.Unmarshal(approval.ToolInput, &toolParams); err == nil && len(toolParams) > 0 {
					// Add first few parameters to message
					params := []string{}
					for k, v := range toolParams {
						params = append(params, fmt.Sprintf("%s=%v", k, v))
						if len(params) >= 2 {
							break
						}
					}
					message += fmt.Sprintf(" with %s", strings.Join(params, ", "))
				}
			}

			req := Request{
				ID:         approval.ID,
				CallID:     approval.ID, // Use approval ID as call ID
				RunID:      approval.RunID,
				Type:       ApprovalRequest,
				Message:    message,
				Tool:       approval.ToolName,
				Parameters: toolParams,
				CreatedAt:  approval.CreatedAt,
			}

			// Enrich with session info if available
			if sess, ok := sessionsByRunID[approval.RunID]; ok {
				req.SessionID = sess.ID
				req.SessionQuery = truncate(sess.Query, 50)
				req.SessionModel = sess.Model
				if req.SessionModel == "" {
					req.SessionModel = "default"
				}
			}

			allRequests = append(allRequests, req)
		}

		return fetchRequestsMsg{requests: allRequests}
	}
}

func fetchSessions(daemonClient client.Client) tea.Cmd {
	return func() tea.Msg {
		// Fetch all sessions from daemon
		resp, err := daemonClient.ListSessions()
		if err != nil {
			return fetchSessionsMsg{err: err}
		}

		return fetchSessionsMsg{sessions: resp.Sessions}
	}
}

func fetchSessionApprovals(daemonClient client.Client, sessionID string) tea.Cmd {
	return func() tea.Msg {
		// Fetch approvals for specific session
		approvals, err := daemonClient.FetchApprovals(sessionID)
		if err != nil {
			return fetchSessionApprovalsMsg{err: err}
		}

		// Get session info to enrich approvals
		sessionsResp, err := daemonClient.ListSessions()
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
		var requests []Request
		for _, approval := range approvals {
			// For local approvals, we always have tool calls
			message := fmt.Sprintf("Call %s", approval.ToolName)

			// Parse tool input to extract parameters
			var toolParams map[string]interface{}
			if len(approval.ToolInput) > 0 {
				// Try to parse as JSON to get parameters
				if err := json.Unmarshal(approval.ToolInput, &toolParams); err == nil && len(toolParams) > 0 {
					// Add first few parameters to message
					params := []string{}
					for k, v := range toolParams {
						params = append(params, fmt.Sprintf("%s=%v", k, v))
						if len(params) >= 2 {
							break
						}
					}
					message += fmt.Sprintf(" with %s", strings.Join(params, ", "))
				}
			}

			req := Request{
				ID:         approval.ID,
				CallID:     approval.ID, // Use approval ID as call ID
				RunID:      approval.RunID,
				Type:       ApprovalRequest,
				Message:    message,
				Tool:       approval.ToolName,
				Parameters: toolParams,
				CreatedAt:  approval.CreatedAt,
			}

			// Add session info if available
			if sessionInfo != nil {
				req.SessionID = sessionInfo.ID
				req.SessionQuery = truncate(sessionInfo.Query, 50)
				req.SessionModel = sessionInfo.Model
				if req.SessionModel == "" {
					req.SessionModel = "default"
				}
			}

			requests = append(requests, req)
		}

		return fetchSessionApprovalsMsg{approvals: requests}
	}
}

func subscribeToEvents(client client.Client) tea.Cmd {
	return func() tea.Msg {
		// Subscribe to all event types
		eventChannel, err := client.Subscribe(rpc.SubscribeRequest{
			EventTypes: []string{"approval_requested", "approval_responded", "session_updated"},
		})
		if err != nil {
			return subscriptionMsg{err: err}
		}

		return subscriptionMsg{eventChannel: eventChannel}
	}
}

func listenForEvents(eventChan <-chan rpc.EventNotification) tea.Cmd {
	return func() tea.Msg {
		// This blocks until an event is received
		event, ok := <-eventChan
		if !ok {
			// Channel closed, subscription ended
			return nil
		}
		return eventNotificationMsg{event: event}
	}
}

func launchSession(daemonClient client.Client, query, model, workingDir string) tea.Cmd {
	return func() tea.Msg {
		// Build MCP config for approvals (matching hlyr/src/commands/launch.ts)
		mcpConfig := &claudecode.MCPConfig{
			MCPServers: map[string]claudecode.MCPServer{
				"approvals": {
					Command: "npx",
					Args:    []string{"humanlayer", "mcp", "claude_approvals"},
				},
			},
		}

		req := rpc.LaunchSessionRequest{
			Query:                query,
			Model:                model,
			WorkingDir:           workingDir,
			MCPConfig:            mcpConfig,
			PermissionPromptTool: "mcp__approvals__request_permission",
		}

		resp, err := daemonClient.LaunchSession(req)
		if err != nil {
			return launchSessionMsg{err: err}
		}

		return launchSessionMsg{
			sessionID: resp.SessionID,
			runID:     resp.RunID,
		}
	}
}

func sendApproval(daemonClient client.Client, callID string, approved bool, comment string) tea.Cmd {
	return func() tea.Msg {
		var err error
		if approved {
			err = daemonClient.ApproveToolCall(callID, comment)
		} else {
			err = daemonClient.DenyToolCall(callID, comment)
		}

		if err != nil {
			return approvalSentMsg{err: err}
		}

		return approvalSentMsg{requestID: callID, approved: approved}
	}
}

func sendHumanResponse(daemonClient client.Client, requestID string, response string) tea.Cmd {
	return func() tea.Msg {
		// Human contact is no longer supported in local approvals
		err := fmt.Errorf("human contact approvals are no longer supported")
		return humanResponseSentMsg{err: err}
	}
}
