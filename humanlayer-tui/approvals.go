package main

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/tui/components/approvals"
)

// approvalModel is a wrapper that embeds the approvals component
type approvalModel struct {
	approvals.Model
}

// newApprovalModel creates a new approval model with default state
func newApprovalModel() approvalModel {
	return approvalModel{
		Model: approvals.New(),
	}
}

// updateSize updates the viewport dimensions
func (am *approvalModel) updateSize(width, height int) {
	am.UpdateSize(width, height)
}

// Update handles messages for the approvals tab
func (am *approvalModel) Update(msg tea.Msg, m *model) tea.Cmd {
	// Create dependencies for the component
	deps := approvals.UpdateDependencies{
		APIClient:            m.apiClient,
		OpenConversationView: m.openConversationView,
		UpdateAllViewSizes:   m.updateAllViewSizes,
	}

	// Create key bindings for the component
	keyBindings := approvals.KeyBindings{
		Up:      keys.Up,
		Down:    keys.Down,
		Enter:   keys.Enter,
		Back:    keys.Back,
		Approve: keys.Approve,
		Deny:    keys.Deny,
		Refresh: keys.Refresh,
	}

	// Delegate to the component's Update method
	cmd, err, fullErr := am.Model.Update(msg, deps, keyBindings)

	// Handle errors
	if err != nil {
		m.err = err
		m.fullError = fullErr
	}

	// Update pending approval count
	m.pendingApprovalCount = len(am.GetRequests())

	return cmd
}

// View renders the approvals tab
func (am *approvalModel) View(m *model) string {
	return am.Model.View()
}

// getViewState returns the current view state
func (am *approvalModel) getViewState() domain.ViewState {
	return am.GetViewState()
}

// setViewState sets the view state
func (am *approvalModel) setViewState(state domain.ViewState) {
	am.SetViewState(state)
}

// hasRequests returns whether there are any requests
func (am *approvalModel) hasRequests() bool {
	return am.HasRequests()
}
