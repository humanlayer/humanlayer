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

	// Override HOME to avoid picking up real global commands
	tempHomeDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	assert.NoError(t, os.Setenv("HOME", tempHomeDir))
	defer func() {
		_ = os.Setenv("HOME", originalHome)
	}()

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

			// Extract command names and verify they all have 'local' source
			var names []string
			for _, cmd := range jsonResp.Data {
				names = append(names, cmd.Name)
				// Since we only have local commands in this test, all should be 'local'
				assert.Equal(t, api.Local, cmd.Source,
					"command %s should have source 'local'", cmd.Name)
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

func TestGetSlashCommandsWithGlobalCommands(t *testing.T) {
	ctx := context.Background()

	// Create temporary directories for local and global commands
	tempDir := t.TempDir()
	localCommandsDir := filepath.Join(tempDir, ".claude", "commands")

	// Create a temp home directory for global commands
	tempHomeDir := t.TempDir()
	globalCommandsDir := filepath.Join(tempHomeDir, ".claude", "commands")

	// Set HOME env var temporarily for this test
	originalHome := os.Getenv("HOME")
	assert.NoError(t, os.Setenv("HOME", tempHomeDir))
	defer func() {
		_ = os.Setenv("HOME", originalHome)
	}()

	// Create directory structures
	assert.NoError(t, os.MkdirAll(localCommandsDir, 0755))
	assert.NoError(t, os.MkdirAll(globalCommandsDir, 0755))

	// Create test command files - some overlap between local and global
	localCommands := map[string]string{
		"create_plan.md":    "# Local Create Plan",
		"local_only.md":     "# Local Only Command",
		"shared_command.md": "# Local Shared Command",
	}

	globalCommands := map[string]string{
		"create_plan.md":    "# Global Create Plan", // Duplicate - global should win
		"global_only.md":    "# Global Only Command",
		"shared_command.md": "# Global Shared Command", // Duplicate - global should win
		"implement_plan.md": "# Global Implement Plan",
	}

	// Write local commands
	for path, content := range localCommands {
		fullPath := filepath.Join(localCommandsDir, path)
		assert.NoError(t, os.WriteFile(fullPath, []byte(content), 0644))
	}

	// Write global commands
	for path, content := range globalCommands {
		fullPath := filepath.Join(globalCommandsDir, path)
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
		name            string
		query           string
		expectedNames   []string
		expectedSources map[string]api.SlashCommandSource
	}{
		{
			name:  "no query returns all commands with proper deduplication",
			query: "",
			expectedNames: []string{
				"/create_plan",    // Global version should be returned
				"/local_only",     // Local only
				"/shared_command", // Global version should be returned
				"/global_only",    // Global only
				"/implement_plan", // Global only
			},
			expectedSources: map[string]api.SlashCommandSource{
				"/create_plan":    api.Global,
				"/local_only":     api.Local,
				"/shared_command": api.Global,
				"/global_only":    api.Global,
				"/implement_plan": api.Global,
			},
		},
		{
			name:          "fuzzy match 'plan' includes commands from both sources",
			query:         "plan",
			expectedNames: []string{"/create_plan", "/implement_plan"},
			expectedSources: map[string]api.SlashCommandSource{
				"/create_plan":    api.Global, // Global version
				"/implement_plan": api.Global,
			},
		},
		{
			name:          "fuzzy match 'local' finds local_only command",
			query:         "local",
			expectedNames: []string{"/local_only"},
			expectedSources: map[string]api.SlashCommandSource{
				"/local_only": api.Local,
			},
		},
		{
			name:          "fuzzy match 'global' finds global_only command",
			query:         "global",
			expectedNames: []string{"/global_only"},
			expectedSources: map[string]api.SlashCommandSource{
				"/global_only": api.Global,
			},
		},
		{
			name:          "fuzzy match 'shared' returns global version",
			query:         "shared",
			expectedNames: []string{"/shared_command"},
			expectedSources: map[string]api.SlashCommandSource{
				"/shared_command": api.Global,
			},
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

			// Extract command names and verify sources
			var names []string
			for _, cmd := range jsonResp.Data {
				names = append(names, cmd.Name)

				// Verify source if specified in expected
				if expectedSource, exists := tt.expectedSources[cmd.Name]; exists {
					assert.Equal(t, expectedSource, cmd.Source,
						"command %s should have source %s", cmd.Name, expectedSource)
				}
			}

			assert.ElementsMatch(t, tt.expectedNames, names,
				"commands should match expected for query: %s", tt.query)
		})
	}

	// Verify all expected mock calls were made
	mockStore.AssertExpectations(t)
}

func TestGetSlashCommandsGlobalOverridesLocal(t *testing.T) {
	ctx := context.Background()

	// Create temporary directories for local and global commands
	tempDir := t.TempDir()
	localCommandsDir := filepath.Join(tempDir, ".claude", "commands")

	// Create a temp home directory for global commands
	tempHomeDir := t.TempDir()
	globalCommandsDir := filepath.Join(tempHomeDir, ".claude", "commands")

	// Set HOME env var temporarily for this test
	originalHome := os.Getenv("HOME")
	assert.NoError(t, os.Setenv("HOME", tempHomeDir))
	defer func() {
		_ = os.Setenv("HOME", originalHome)
	}()

	// Create directory structures with nested folders
	assert.NoError(t, os.MkdirAll(filepath.Join(localCommandsDir, "nested"), 0755))
	assert.NoError(t, os.MkdirAll(filepath.Join(globalCommandsDir, "nested"), 0755))

	// Create overlapping commands in both directories
	// All these commands exist in both local and global
	duplicateCommands := []string{
		"duplicate1.md",
		"duplicate2.md",
		"nested/duplicate3.md",
	}

	// Write the same commands to both directories
	for _, path := range duplicateCommands {
		localPath := filepath.Join(localCommandsDir, path)
		globalPath := filepath.Join(globalCommandsDir, path)

		assert.NoError(t, os.WriteFile(localPath, []byte("Local version"), 0644))
		assert.NoError(t, os.WriteFile(globalPath, []byte("Global version"), 0644))
	}

	// Create mock store
	mockStore := new(MockStore)
	handler := &SessionHandlers{
		store: mockStore,
	}

	mockSession := &store.Session{
		ID:         "test-session",
		WorkingDir: tempDir,
	}
	mockStore.On("GetSession", ctx, "test-session").Return(mockSession, nil)

	req := api.GetSlashCommandsRequestObject{
		Params: api.GetSlashCommandsParams{
			SessionId: "test-session",
		},
	}

	resp, err := handler.GetSlashCommands(ctx, req)
	assert.NoError(t, err)

	jsonResp, ok := resp.(api.GetSlashCommands200JSONResponse)
	assert.True(t, ok, "expected 200 response")

	// All commands should be present, but all should be from global source
	expectedCommands := map[string]api.SlashCommandSource{
		"/duplicate1":        api.Global,
		"/duplicate2":        api.Global,
		"/nested:duplicate3": api.Global,
	}

	assert.Len(t, jsonResp.Data, len(expectedCommands),
		"should have exactly %d commands (no duplicates)", len(expectedCommands))

	for _, cmd := range jsonResp.Data {
		expectedSource, exists := expectedCommands[cmd.Name]
		assert.True(t, exists, "unexpected command: %s", cmd.Name)
		assert.Equal(t, expectedSource, cmd.Source,
			"command %s should be from global source", cmd.Name)
	}

	mockStore.AssertExpectations(t)
}

func TestExpandTilde(t *testing.T) {
	homeDir, err := os.UserHomeDir()
	assert.NoError(t, err)

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "tilde with path",
			input:    "~/projects/myapp",
			expected: filepath.Join(homeDir, "projects", "myapp"),
		},
		{
			name:     "just tilde",
			input:    "~",
			expected: homeDir,
		},
		{
			name:     "tilde with slash",
			input:    "~/",
			expected: homeDir,
		},
		{
			name:     "no tilde",
			input:    "/absolute/path",
			expected: "/absolute/path",
		},
		{
			name:     "relative path",
			input:    "relative/path",
			expected: "relative/path",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := expandTilde(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}
