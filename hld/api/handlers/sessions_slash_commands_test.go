package handlers

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/store"
)

// MockStore is a mock implementation of store.ConversationStore
type MockStore struct {
	mock.Mock
}

func (m *MockStore) CreateSession(ctx context.Context, session *store.Session) error {
	args := m.Called(ctx, session)
	return args.Error(0)
}

func (m *MockStore) UpdateSession(ctx context.Context, sessionID string, updates store.SessionUpdate) error {
	args := m.Called(ctx, sessionID, updates)
	return args.Error(0)
}

func (m *MockStore) GetSession(ctx context.Context, sessionID string) (*store.Session, error) {
	args := m.Called(ctx, sessionID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*store.Session), args.Error(1)
}

func (m *MockStore) GetSessionByRunID(ctx context.Context, runID string) (*store.Session, error) {
	args := m.Called(ctx, runID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*store.Session), args.Error(1)
}

func (m *MockStore) ListSessions(ctx context.Context) ([]*store.Session, error) {
	args := m.Called(ctx)
	return args.Get(0).([]*store.Session), args.Error(1)
}

func (m *MockStore) GetExpiredDangerousPermissionsSessions(ctx context.Context) ([]*store.Session, error) {
	args := m.Called(ctx)
	return args.Get(0).([]*store.Session), args.Error(1)
}

func (m *MockStore) AddConversationEvent(ctx context.Context, event *store.ConversationEvent) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func (m *MockStore) GetConversation(ctx context.Context, claudeSessionID string) ([]*store.ConversationEvent, error) {
	args := m.Called(ctx, claudeSessionID)
	return args.Get(0).([]*store.ConversationEvent), args.Error(1)
}

func (m *MockStore) GetSessionConversation(ctx context.Context, sessionID string) ([]*store.ConversationEvent, error) {
	args := m.Called(ctx, sessionID)
	return args.Get(0).([]*store.ConversationEvent), args.Error(1)
}

func (m *MockStore) GetPendingToolCall(ctx context.Context, sessionID string, toolName string) (*store.ConversationEvent, error) {
	args := m.Called(ctx, sessionID, toolName)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*store.ConversationEvent), args.Error(1)
}

func (m *MockStore) GetUncorrelatedPendingToolCall(ctx context.Context, sessionID string, toolName string) (*store.ConversationEvent, error) {
	args := m.Called(ctx, sessionID, toolName)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*store.ConversationEvent), args.Error(1)
}

func (m *MockStore) GetPendingToolCalls(ctx context.Context, sessionID string) ([]*store.ConversationEvent, error) {
	args := m.Called(ctx, sessionID)
	return args.Get(0).([]*store.ConversationEvent), args.Error(1)
}

func (m *MockStore) GetToolCallByID(ctx context.Context, toolID string) (*store.ConversationEvent, error) {
	args := m.Called(ctx, toolID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*store.ConversationEvent), args.Error(1)
}

func (m *MockStore) MarkToolCallCompleted(ctx context.Context, toolID string, sessionID string) error {
	args := m.Called(ctx, toolID, sessionID)
	return args.Error(0)
}

func (m *MockStore) CorrelateApproval(ctx context.Context, sessionID string, toolName string, approvalID string) error {
	args := m.Called(ctx, sessionID, toolName, approvalID)
	return args.Error(0)
}

func (m *MockStore) LinkConversationEventToApprovalUsingToolID(ctx context.Context, sessionID string, toolID string, approvalID string) error {
	args := m.Called(ctx, sessionID, toolID, approvalID)
	return args.Error(0)
}

func (m *MockStore) UpdateApprovalStatus(ctx context.Context, approvalID string, status string) error {
	args := m.Called(ctx, approvalID, status)
	return args.Error(0)
}

func (m *MockStore) StoreMCPServers(ctx context.Context, sessionID string, servers []store.MCPServer) error {
	args := m.Called(ctx, sessionID, servers)
	return args.Error(0)
}

func (m *MockStore) GetMCPServers(ctx context.Context, sessionID string) ([]store.MCPServer, error) {
	args := m.Called(ctx, sessionID)
	return args.Get(0).([]store.MCPServer), args.Error(1)
}

func (m *MockStore) StoreRawEvent(ctx context.Context, sessionID string, eventJSON string) error {
	args := m.Called(ctx, sessionID, eventJSON)
	return args.Error(0)
}

func (m *MockStore) CreateApproval(ctx context.Context, approval *store.Approval) error {
	args := m.Called(ctx, approval)
	return args.Error(0)
}

func (m *MockStore) GetApproval(ctx context.Context, id string) (*store.Approval, error) {
	args := m.Called(ctx, id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*store.Approval), args.Error(1)
}

func (m *MockStore) GetPendingApprovals(ctx context.Context, sessionID string) ([]*store.Approval, error) {
	args := m.Called(ctx, sessionID)
	return args.Get(0).([]*store.Approval), args.Error(1)
}

func (m *MockStore) UpdateApprovalResponse(ctx context.Context, id string, status store.ApprovalStatus, comment string) error {
	args := m.Called(ctx, id, status, comment)
	return args.Error(0)
}

func (m *MockStore) CreateFileSnapshot(ctx context.Context, snapshot *store.FileSnapshot) error {
	args := m.Called(ctx, snapshot)
	return args.Error(0)
}

func (m *MockStore) GetFileSnapshots(ctx context.Context, sessionID string) ([]store.FileSnapshot, error) {
	args := m.Called(ctx, sessionID)
	return args.Get(0).([]store.FileSnapshot), args.Error(1)
}

func (m *MockStore) GetRecentWorkingDirs(ctx context.Context, limit int) ([]store.RecentPath, error) {
	args := m.Called(ctx, limit)
	return args.Get(0).([]store.RecentPath), args.Error(1)
}

func (m *MockStore) GetUserSettings(ctx context.Context) (*store.UserSettings, error) {
	args := m.Called(ctx)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*store.UserSettings), args.Error(1)
}

func (m *MockStore) UpdateUserSettings(ctx context.Context, settings store.UserSettings) error {
	args := m.Called(ctx, settings)
	return args.Error(0)
}

func (m *MockStore) Close() error {
	args := m.Called()
	return args.Error(0)
}

func TestGetSlashCommands(t *testing.T) {
	ctx := context.Background()

	// Create a temporary directory for test commands
	tempDir := t.TempDir()
	commandsDir := filepath.Join(tempDir, ".claude", "commands")

	// Create directory structure with test commands
	assert.NoError(t, os.MkdirAll(filepath.Join(commandsDir, "hl", "alpha"), 0755))

	// Create test command files
	testCommands := map[string]string{
		"create_plan.md":       "# Create Plan",
		"implement_plan.md":    "# Implement Plan",
		"research_codebase.md": "# Research Codebase",
		"linear.md":            "# Linear",
		"hl/research.md":       "# HL Research",
		"hl/alpha/test.md":     "# HL Alpha Test",
	}

	for path, content := range testCommands {
		fullPath := filepath.Join(commandsDir, path)
		assert.NoError(t, os.WriteFile(fullPath, []byte(content), 0644))
	}

	// Create mock store
	mockStore := new(MockStore)

	// Set up handler with mock store
	handler := &SessionHandlers{
		store: mockStore,
	}

	// Mock GetSession to return a session with our temp directory
	mockSession := &store.Session{
		ID:         "test-session",
		WorkingDir: tempDir,
	}
	mockStore.On("GetSession", ctx, "test-session").Return(mockSession, nil)

	tests := []struct {
		name     string
		query    string
		expected []string
	}{
		{
			name:     "no query returns all commands",
			query:    "",
			expected: []string{"/create_plan", "/implement_plan", "/research_codebase", "/linear", "/hl:research", "/hl:alpha:test"},
		},
		{
			name:     "fuzzy match 'plan'",
			query:    "plan",
			expected: []string{"/create_plan", "/implement_plan"},
		},
		{
			name:     "fuzzy match 'research'",
			query:    "research",
			expected: []string{"/research_codebase", "/hl:research"},
		},
		{
			name:     "fuzzy match 'hl'",
			query:    "hl",
			expected: []string{"/hl:research", "/hl:alpha:test"},
		},
		{
			name:     "fuzzy match 'lin'",
			query:    "lin",
			expected: []string{"/linear"},
		},
		{
			name:     "fuzzy match 'impl'",
			query:    "impl",
			expected: []string{"/implement_plan"},
		},
		{
			name:     "no results for non-matching query",
			query:    "xyz123",
			expected: []string{},
		},
		{
			name:     "just slash returns all commands",
			query:    "/",
			expected: []string{"/create_plan", "/implement_plan", "/research_codebase", "/linear", "/hl:research", "/hl:alpha:test"},
		},
		{
			name:     "fuzzy match 'alpha'",
			query:    "alpha",
			expected: []string{"/hl:alpha:test"},
		},
		{
			name:     "fuzzy match 'test'",
			query:    "test",
			expected: []string{"/hl:alpha:test"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var queryPtr *string
			if tt.query != "" {
				queryPtr = &tt.query
			}

			req := api.GetSlashCommandsRequestObject{
				Params: api.GetSlashCommandsParams{
					SessionId: "test-session",
					Query:     queryPtr,
				},
			}

			resp, err := handler.GetSlashCommands(ctx, req)
			assert.NoError(t, err)

			jsonResp, ok := resp.(api.GetSlashCommands200JSONResponse)
			assert.True(t, ok, "expected 200 response")

			// Extract command names
			var names []string
			for _, cmd := range jsonResp.Data {
				names = append(names, cmd.Name)
			}

			assert.ElementsMatch(t, tt.expected, names, "commands should match expected for query: %s", tt.query)
		})
	}

	// Test with non-existent commands directory
	t.Run("no commands directory returns empty list", func(t *testing.T) {
		emptyDir := t.TempDir()
		mockEmptySession := &store.Session{
			ID:         "empty-session",
			WorkingDir: emptyDir,
		}
		mockStore.On("GetSession", ctx, "empty-session").Return(mockEmptySession, nil)

		req := api.GetSlashCommandsRequestObject{
			Params: api.GetSlashCommandsParams{
				SessionId: "empty-session",
			},
		}

		resp, err := handler.GetSlashCommands(ctx, req)
		assert.NoError(t, err)

		jsonResp, ok := resp.(api.GetSlashCommands200JSONResponse)
		assert.True(t, ok, "expected 200 response")
		assert.Empty(t, jsonResp.Data, "should return empty list when no commands exist")
	})

	// Verify all expected mock calls were made
	mockStore.AssertExpectations(t)
}
