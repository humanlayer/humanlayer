package approvals

import (
	"errors"
	"testing"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestUpdate_FetchRequestsMsg(t *testing.T) {
	tests := []struct {
		name          string
		msg           domain.FetchRequestsMsg
		expectedError bool
		expectedCount int
	}{
		{
			name: "Success with requests",
			msg: domain.FetchRequestsMsg{
				Requests: []domain.Request{
					{
						ID:        "req-1",
						Type:      domain.ApprovalRequest,
						Message:   "Test approval",
						CreatedAt: time.Now(),
					},
					{
						ID:        "req-2",
						Type:      domain.HumanContactRequest,
						Message:   "Test human contact",
						CreatedAt: time.Now(),
					},
				},
				Err: nil,
			},
			expectedError: false,
			expectedCount: 2,
		},
		{
			name: "Error case",
			msg: domain.FetchRequestsMsg{
				Requests: nil,
				Err:      errors.New("fetch failed"),
			},
			expectedError: true,
			expectedCount: 0,
		},
		{
			name: "Empty requests",
			msg: domain.FetchRequestsMsg{
				Requests: []domain.Request{},
				Err:      nil,
			},
			expectedError: false,
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockClient := api.NewMockClient(ctrl)
			model := New()
			deps := UpdateDependencies{
				APIClient:            mockClient,
				OpenConversationView: func(sessionID string) tea.Cmd { return nil },
				UpdateAllViewSizes:   func() {},
			}
			keys := createTestKeyBindings()

			cmd, err, fullErr := model.Update(tt.msg, deps, keys)

			if tt.expectedError {
				assert.Error(t, err)
				assert.Error(t, fullErr)
			} else {
				assert.NoError(t, err)
				assert.NoError(t, fullErr)
			}
			assert.Nil(t, cmd)
			assert.Equal(t, tt.expectedCount, len(model.GetRequests()))
		})
	}
}

func TestUpdate_ApprovalSentMsg(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New()

	// Setup: Add some requests
	model.SetRequests([]domain.Request{
		{ID: "req-1", Type: domain.ApprovalRequest},
		{ID: "req-2", Type: domain.ApprovalRequest},
		{ID: "req-3", Type: domain.HumanContactRequest},
	})
	model.SetViewState(domain.DetailView)
	model.SetSelectedRequest(&domain.Request{ID: "req-2"})

	// Test: Successful approval
	mockClient.EXPECT().FetchRequests().Return(func() tea.Msg { return nil })

	deps := UpdateDependencies{
		APIClient:            mockClient,
		OpenConversationView: func(sessionID string) tea.Cmd { return nil },
		UpdateAllViewSizes:   func() {},
	}
	keys := createTestKeyBindings()

	msg := domain.ApprovalSentMsg{
		RequestID: "req-2",
		Approved:  true,
		Err:       nil,
	}

	cmd, err, fullErr := model.Update(msg, deps, keys)

	assert.NoError(t, err)
	assert.NoError(t, fullErr)
	assert.NotNil(t, cmd)
	assert.Equal(t, 2, len(model.GetRequests()))
	assert.Equal(t, domain.ListView, model.GetViewState())
	assert.Nil(t, model.GetSelectedRequest())

	// Verify the correct request was removed
	for _, req := range model.GetRequests() {
		assert.NotEqual(t, "req-2", req.ID)
	}
}

func TestUpdate_HumanResponseSentMsg(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New()

	// Setup: Add some requests
	model.SetRequests([]domain.Request{
		{ID: "req-1", Type: domain.HumanContactRequest},
		{ID: "req-2", Type: domain.HumanContactRequest},
	})

	// Test: Successful human response
	mockClient.EXPECT().FetchRequests().Return(func() tea.Msg { return nil })

	deps := UpdateDependencies{
		APIClient:            mockClient,
		OpenConversationView: func(sessionID string) tea.Cmd { return nil },
		UpdateAllViewSizes:   func() {},
	}
	keys := createTestKeyBindings()

	msg := domain.HumanResponseSentMsg{
		RequestID: "req-1",
		Err:       nil,
	}

	cmd, err, fullErr := model.Update(msg, deps, keys)

	assert.NoError(t, err)
	assert.NoError(t, fullErr)
	assert.NotNil(t, cmd)
	assert.Equal(t, 1, len(model.GetRequests()))
	assert.Equal(t, "req-2", model.GetRequests()[0].ID)
}

func TestUpdate_KeyboardNavigation(t *testing.T) {
	tests := []struct {
		name           string
		key            tea.KeyMsg
		initialCursor  int
		expectedCursor int
		requestCount   int
	}{
		{
			name:           "Move up from middle",
			key:            tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("k")},
			initialCursor:  1,
			expectedCursor: 0,
			requestCount:   3,
		},
		{
			name:           "Move up from top (no change)",
			key:            tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("k")},
			initialCursor:  0,
			expectedCursor: 0,
			requestCount:   3,
		},
		{
			name:           "Move down from middle",
			key:            tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("j")},
			initialCursor:  1,
			expectedCursor: 2,
			requestCount:   3,
		},
		{
			name:           "Move down from bottom (no change)",
			key:            tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("j")},
			initialCursor:  2,
			expectedCursor: 2,
			requestCount:   3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			model := New()

			// Setup requests
			var requests []domain.Request
			for i := 0; i < tt.requestCount; i++ {
				requests = append(requests, domain.Request{
					ID:   string(rune('a' + i)),
					Type: domain.ApprovalRequest,
				})
			}
			model.SetRequests(requests)
			model.SetCursor(tt.initialCursor)
			model.SetViewState(domain.ListView)

			deps := UpdateDependencies{
				APIClient:            api.NewMockClient(ctrl),
				OpenConversationView: func(sessionID string) tea.Cmd { return nil },
				UpdateAllViewSizes:   func() {},
			}

			// Create key bindings with proper key matching
			keys := createTestKeyBindings()
			if tt.key.String() == "k" {
				keys.Up = key.NewBinding(key.WithKeys("k", "up"))
			} else if tt.key.String() == "j" {
				keys.Down = key.NewBinding(key.WithKeys("j", "down"))
			}

			cmd, err, fullErr := model.Update(tt.key, deps, keys)

			assert.NoError(t, err)
			assert.NoError(t, fullErr)
			assert.Nil(t, cmd)
			assert.Equal(t, tt.expectedCursor, model.GetCursor())
		})
	}
}

func TestUpdate_EnterKey(t *testing.T) {
	tests := []struct {
		name               string
		request            domain.Request
		expectedViewState  domain.ViewState
		expectConversation bool
	}{
		{
			name: "Enter on approval with session opens conversation",
			request: domain.Request{
				ID:        "req-1",
				SessionID: "sess-123",
				Type:      domain.ApprovalRequest,
			},
			expectedViewState:  domain.ListView, // Stays in list view
			expectConversation: true,
		},
		{
			name: "Enter on approval without session opens detail",
			request: domain.Request{
				ID:   "req-1",
				Type: domain.ApprovalRequest,
			},
			expectedViewState:  domain.DetailView,
			expectConversation: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			model := New()
			model.SetRequests([]domain.Request{tt.request})
			model.SetCursor(0)

			conversationOpened := false
			deps := UpdateDependencies{
				APIClient: api.NewMockClient(ctrl),
				OpenConversationView: func(sessionID string) tea.Cmd {
					conversationOpened = true
					assert.Equal(t, tt.request.SessionID, sessionID)
					return func() tea.Msg { return nil }
				},
				UpdateAllViewSizes: func() {},
			}
			keys := createTestKeyBindings()
			keys.Enter = key.NewBinding(key.WithKeys("enter"))

			enterKey := tea.KeyMsg{Type: tea.KeyEnter}
			cmd, err, fullErr := model.Update(enterKey, deps, keys)

			assert.NoError(t, err)
			assert.NoError(t, fullErr)
			assert.Equal(t, tt.expectConversation, conversationOpened)
			assert.Equal(t, tt.expectedViewState, model.GetViewState())

			if tt.expectConversation {
				assert.NotNil(t, cmd)
			} else {
				assert.Nil(t, cmd)
				assert.NotNil(t, model.GetSelectedRequest())
			}
		})
	}
}

func TestUpdate_QuickApprove(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New()

	// Setup: Add approval request
	approvalReq := domain.Request{
		ID:     "req-1",
		CallID: "call-123",
		Type:   domain.ApprovalRequest,
	}
	model.SetRequests([]domain.Request{approvalReq})
	model.SetCursor(0)

	// Expect approval to be sent
	mockClient.EXPECT().SendApproval("call-123", true, "").Return(func() tea.Msg { return nil })

	deps := UpdateDependencies{
		APIClient:            mockClient,
		OpenConversationView: func(sessionID string) tea.Cmd { return nil },
		UpdateAllViewSizes:   func() {},
	}
	keys := createTestKeyBindings()
	keys.Approve = key.NewBinding(key.WithKeys("y"))

	approveKey := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")}
	cmd, err, fullErr := model.Update(approveKey, deps, keys)

	assert.NoError(t, err)
	assert.NoError(t, fullErr)
	assert.NotNil(t, cmd)
}

func TestUpdate_DenyOpenseFeedback(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	model := New()

	// Setup: Add request
	req := domain.Request{
		ID:   "req-1",
		Type: domain.ApprovalRequest,
	}
	model.SetRequests([]domain.Request{req})
	model.SetCursor(0)

	updateSizesCalled := false
	deps := UpdateDependencies{
		APIClient:            api.NewMockClient(ctrl),
		OpenConversationView: func(sessionID string) tea.Cmd { return nil },
		UpdateAllViewSizes:   func() { updateSizesCalled = true },
	}
	keys := createTestKeyBindings()
	keys.Deny = key.NewBinding(key.WithKeys("n"))

	denyKey := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("n")}
	cmd, err, fullErr := model.Update(denyKey, deps, keys)

	assert.NoError(t, err)
	assert.NoError(t, fullErr)
	assert.Nil(t, cmd)
	assert.Equal(t, domain.FeedbackView, model.GetViewState())
	assert.Equal(t, &req, model.GetFeedbackFor())
	assert.False(t, model.IsApproving())
	assert.True(t, updateSizesCalled)
	assert.True(t, model.GetFeedbackInput().Focused())
}

func TestUpdate_ViewStateTransitions(t *testing.T) {
	tests := []struct {
		name             string
		initialState     domain.ViewState
		key              tea.KeyMsg
		expectedState    domain.ViewState
		setupSelectedReq bool
	}{
		{
			name:             "Detail to List on Back",
			initialState:     domain.DetailView,
			key:              tea.KeyMsg{Type: tea.KeyEsc},
			expectedState:    domain.ListView,
			setupSelectedReq: true,
		},
		{
			name:             "Feedback to Detail on Back with selected",
			initialState:     domain.FeedbackView,
			key:              tea.KeyMsg{Type: tea.KeyEsc},
			expectedState:    domain.DetailView,
			setupSelectedReq: true,
		},
		{
			name:             "Feedback to List on Back without selected",
			initialState:     domain.FeedbackView,
			key:              tea.KeyMsg{Type: tea.KeyEsc},
			expectedState:    domain.ListView,
			setupSelectedReq: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			model := New()
			model.SetViewState(tt.initialState)

			if tt.setupSelectedReq {
				model.SetSelectedRequest(&domain.Request{ID: "req-1"})
			}

			updateSizesCalled := false
			deps := UpdateDependencies{
				APIClient:            api.NewMockClient(ctrl),
				OpenConversationView: func(sessionID string) tea.Cmd { return nil },
				UpdateAllViewSizes:   func() { updateSizesCalled = true },
			}
			keys := createTestKeyBindings()
			keys.Back = key.NewBinding(key.WithKeys("esc"))

			cmd, err, fullErr := model.Update(tt.key, deps, keys)

			assert.NoError(t, err)
			assert.NoError(t, fullErr)
			assert.Nil(t, cmd)
			assert.Equal(t, tt.expectedState, model.GetViewState())

			// UpdateAllViewSizes should be called on state transitions
			if tt.initialState != tt.expectedState {
				assert.True(t, updateSizesCalled)
			}
		})
	}
}

func TestUpdate_FeedbackSubmission(t *testing.T) {
	tests := []struct {
		name         string
		requestType  domain.RequestType
		feedback     string
		isApproving  bool
		expectMethod string
	}{
		{
			name:         "Submit approval with comment",
			requestType:  domain.ApprovalRequest,
			feedback:     "Looks good",
			isApproving:  true,
			expectMethod: "approval",
		},
		{
			name:         "Submit denial with comment",
			requestType:  domain.ApprovalRequest,
			feedback:     "Not safe",
			isApproving:  false,
			expectMethod: "approval",
		},
		{
			name:         "Submit human response",
			requestType:  domain.HumanContactRequest,
			feedback:     "Here's my response",
			isApproving:  false,
			expectMethod: "human",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockClient := api.NewMockClient(ctrl)
			model := New()

			// Setup feedback state
			req := domain.Request{
				ID:     "req-1",
				CallID: "call-123",
				Type:   tt.requestType,
			}
			model.SetViewState(domain.FeedbackView)
			model.SetFeedbackFor(&req)
			model.SetIsApproving(tt.isApproving)
			input := model.GetFeedbackInput()
			input.SetValue(tt.feedback)
			model.SetFeedbackInput(input)

			// Set expectations
			if tt.expectMethod == "approval" {
				mockClient.EXPECT().SendApproval("call-123", tt.isApproving, tt.feedback).Return(func() tea.Msg { return nil })
			} else {
				mockClient.EXPECT().SendHumanResponse("req-1", tt.feedback).Return(func() tea.Msg { return nil })
			}

			deps := UpdateDependencies{
				APIClient:            mockClient,
				OpenConversationView: func(sessionID string) tea.Cmd { return nil },
				UpdateAllViewSizes:   func() {},
			}
			keys := createTestKeyBindings()
			keys.Enter = key.NewBinding(key.WithKeys("enter"))

			enterKey := tea.KeyMsg{Type: tea.KeyEnter}
			cmd, err, fullErr := model.Update(enterKey, deps, keys)

			assert.NoError(t, err)
			assert.NoError(t, fullErr)
			assert.NotNil(t, cmd)
		})
	}
}

func TestUpdate_ErrorHandling(t *testing.T) {
	tests := []struct {
		name          string
		msg           tea.Msg
		expectedError string
	}{
		{
			name: "FetchRequestsMsg error",
			msg: domain.FetchRequestsMsg{
				Err: errors.New("network error"),
			},
			expectedError: "network error",
		},
		{
			name: "ApprovalSentMsg error",
			msg: domain.ApprovalSentMsg{
				RequestID: "req-1",
				Err:       errors.New("approval failed"),
			},
			expectedError: "approval failed",
		},
		{
			name: "HumanResponseSentMsg error",
			msg: domain.HumanResponseSentMsg{
				RequestID: "req-1",
				Err:       errors.New("response failed"),
			},
			expectedError: "response failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			model := New()
			deps := UpdateDependencies{
				APIClient:            api.NewMockClient(ctrl),
				OpenConversationView: func(sessionID string) tea.Cmd { return nil },
				UpdateAllViewSizes:   func() {},
			}
			keys := createTestKeyBindings()

			cmd, err, fullErr := model.Update(tt.msg, deps, keys)

			assert.Error(t, err)
			assert.Error(t, fullErr)
			assert.Nil(t, cmd)
			assert.Contains(t, err.Error(), tt.expectedError)
		})
	}
}

// Helper function to create test key bindings
func createTestKeyBindings() KeyBindings {
	return KeyBindings{
		Up:      key.NewBinding(key.WithKeys("up", "k")),
		Down:    key.NewBinding(key.WithKeys("down", "j")),
		Enter:   key.NewBinding(key.WithKeys("enter")),
		Back:    key.NewBinding(key.WithKeys("esc")),
		Approve: key.NewBinding(key.WithKeys("y")),
		Deny:    key.NewBinding(key.WithKeys("n")),
		Refresh: key.NewBinding(key.WithKeys("r")),
	}
}
