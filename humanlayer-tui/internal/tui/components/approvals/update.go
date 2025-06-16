package approvals

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// UpdateDependencies contains external dependencies needed for update operations
type UpdateDependencies struct {
	APIClient            api.Client
	OpenConversationView func(sessionID string) tea.Cmd
	UpdateAllViewSizes   func()
}

// KeyBindings contains key bindings used by the approvals component
type KeyBindings struct {
	Up      key.Binding
	Down    key.Binding
	Enter   key.Binding
	Back    key.Binding
	Approve key.Binding
	Deny    key.Binding
	Refresh key.Binding
}

// Update handles messages for the approvals component
func (m *Model) Update(msg tea.Msg, deps UpdateDependencies, keys KeyBindings) (tea.Cmd, error, error) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch m.viewState {
		case domain.ListView:
			return m.updateListView(msg, deps, keys)
		case domain.DetailView:
			return m.updateDetailView(msg, deps, keys)
		case domain.FeedbackView:
			return m.updateFeedbackView(msg, deps, keys)
		}

	case domain.FetchRequestsMsg:
		if msg.Err != nil {
			return nil, msg.Err, msg.Err
		}
		m.SetRequests(msg.Requests)
		return nil, nil, nil

	case domain.ApprovalSentMsg:
		if msg.Err != nil {
			return nil, msg.Err, msg.Err
		}
		// Remove the approved/denied request from the list
		m.RemoveRequest(msg.RequestID)
		// Go back to list view
		m.SetViewState(domain.ListView)
		m.SetSelectedRequest(nil)
		// Trigger layout update when returning to list view
		deps.UpdateAllViewSizes()
		return deps.APIClient.FetchRequests(), nil, nil

	case domain.HumanResponseSentMsg:
		if msg.Err != nil {
			return nil, msg.Err, msg.Err
		}
		// Remove the responded request from the list
		m.RemoveRequest(msg.RequestID)
		// Go back to list view
		m.SetViewState(domain.ListView)
		m.SetSelectedRequest(nil)
		// Trigger layout update when returning to list view
		deps.UpdateAllViewSizes()
		return deps.APIClient.FetchRequests(), nil, nil
	}

	return nil, nil, nil
}

// updateListView handles key events in the list view
func (m *Model) updateListView(msg tea.KeyMsg, deps UpdateDependencies, keys KeyBindings) (tea.Cmd, error, error) {
	switch {
	case key.Matches(msg, keys.Up):
		m.MoveCursorUp()

	case key.Matches(msg, keys.Down):
		m.MoveCursorDown()

	case key.Matches(msg, keys.Enter):
		req := m.GetRequestAtCursor()
		if req != nil {
			// If the approval is tied to a session, open conversation view
			if req.SessionID != "" {
				return deps.OpenConversationView(req.SessionID), nil, nil
			} else {
				// Fallback to detail view for approvals without session context
				m.SetSelectedRequest(req)
				m.SetViewState(domain.DetailView)
			}
		}

	case key.Matches(msg, keys.Approve):
		// Quick approve without comment
		req := m.GetRequestAtCursor()
		if req != nil && req.Type == domain.ApprovalRequest {
			return deps.APIClient.SendApproval(req.CallID, true, ""), nil, nil
		}

	case key.Matches(msg, keys.Deny):
		// Open feedback view for deny/response
		req := m.GetRequestAtCursor()
		if req != nil {
			m.SetFeedbackFor(req)
			m.SetIsApproving(false)
			m.ResetFeedbackInput()
			m.FocusFeedbackInput()
			m.SetViewState(domain.FeedbackView)
			// Trigger layout update for the new view state
			deps.UpdateAllViewSizes()
		}

	case key.Matches(msg, keys.Refresh):
		return deps.APIClient.FetchRequests(), nil, nil
	}

	return nil, nil, nil
}

// updateDetailView handles key events in the detail view
func (m *Model) updateDetailView(msg tea.KeyMsg, deps UpdateDependencies, keys KeyBindings) (tea.Cmd, error, error) {
	switch {
	case key.Matches(msg, keys.Back):
		m.SetViewState(domain.ListView)
		m.SetSelectedRequest(nil)
		// Trigger layout update when returning to list view
		deps.UpdateAllViewSizes()

	case key.Matches(msg, keys.Approve):
		selectedReq := m.GetSelectedRequest()
		if selectedReq != nil && selectedReq.Type == domain.ApprovalRequest {
			return deps.APIClient.SendApproval(selectedReq.CallID, true, ""), nil, nil
		}

	case key.Matches(msg, keys.Deny):
		selectedReq := m.GetSelectedRequest()
		if selectedReq != nil {
			m.SetFeedbackFor(selectedReq)
			m.SetIsApproving(false)
			m.ResetFeedbackInput()
			m.FocusFeedbackInput()
			m.SetViewState(domain.FeedbackView)
			// Trigger layout update for the new view state
			deps.UpdateAllViewSizes()
		}
	}

	return nil, nil, nil
}

// updateFeedbackView handles key events in the feedback view
func (m *Model) updateFeedbackView(msg tea.KeyMsg, deps UpdateDependencies, keys KeyBindings) (tea.Cmd, error, error) {
	switch {
	case key.Matches(msg, keys.Back):
		m.SetViewState(domain.DetailView)
		if m.GetSelectedRequest() == nil {
			m.SetViewState(domain.ListView)
		}
		// Trigger layout update when changing view states
		deps.UpdateAllViewSizes()

	case key.Matches(msg, keys.Enter):
		// Submit feedback
		feedbackFor := m.GetFeedbackFor()
		if feedbackFor != nil {
			feedback := m.feedbackInput.Value()
			if feedbackFor.Type == domain.ApprovalRequest {
				// For approvals, send with comment
				return deps.APIClient.SendApproval(feedbackFor.CallID, m.IsApproving(), feedback), nil, nil
			} else {
				// For human contact, send response
				return deps.APIClient.SendHumanResponse(feedbackFor.ID, feedback), nil, nil
			}
		}

	default:
		// Handle text input
		var cmd tea.Cmd
		input := m.GetFeedbackInput()
		input, cmd = input.Update(msg)
		m.SetFeedbackInput(input)
		return cmd, nil, nil
	}

	return nil, nil, nil
}
