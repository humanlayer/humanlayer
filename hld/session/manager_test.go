package session

import (
	"fmt"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	"go.uber.org/mock/gomock"
)

func TestNewManager(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Create mock store
	mockStore := store.NewMockConversationStore(ctrl)

	var eventBus bus.EventBus = nil // no bus for this test
	manager, err := NewManager(eventBus, mockStore)

	if err != nil {
		t.Fatalf("Failed to create manager: %v", err)
	}

	if manager == nil {
		t.Fatal("Manager should not be nil")
	}

	// Manager is successfully created with store
}

func TestNewManager_RequiresStore(t *testing.T) {
	var eventBus bus.EventBus = nil
	_, err := NewManager(eventBus, nil)

	if err == nil {
		t.Fatal("Expected error when store is nil")
	}

	if err.Error() != "store is required" {
		t.Errorf("Expected 'store is required' error, got: %v", err)
	}
}

func TestListSessions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore)

	// Test empty list
	mockStore.EXPECT().ListSessions(gomock.Any()).Return([]*store.Session{}, nil)

	sessions := manager.ListSessions()
	if len(sessions) != 0 {
		t.Errorf("Expected 0 sessions, got %d", len(sessions))
	}

	// Test with sessions
	dbSessions := []*store.Session{
		{
			ID:        "test-1",
			RunID:     "run-1",
			Status:    "running",
			Query:     "test query",
			CreatedAt: time.Now(),
		},
	}
	mockStore.EXPECT().ListSessions(gomock.Any()).Return(dbSessions, nil)

	sessions = manager.ListSessions()
	if len(sessions) != 1 {
		t.Errorf("Expected 1 session, got %d", len(sessions))
	}
}

func TestGetSessionInfo(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore)

	// Test not found
	mockStore.EXPECT().GetSession(gomock.Any(), "not-found").Return(nil, fmt.Errorf("not found"))

	_, err := manager.GetSessionInfo("not-found")
	if err == nil {
		t.Error("Expected error for non-existent session")
	}

	// Test found
	dbSession := &store.Session{
		ID:        "test-1",
		RunID:     "run-1",
		Status:    "running",
		Query:     "test query",
		CreatedAt: time.Now(),
	}
	mockStore.EXPECT().GetSession(gomock.Any(), "test-1").Return(dbSession, nil)

	info, err := manager.GetSessionInfo("test-1")
	if err != nil {
		t.Fatalf("Failed to get session info: %v", err)
	}
	if info.ID != "test-1" {
		t.Errorf("Expected ID test-1, got %s", info.ID)
	}
}

// Note: Most of the old tests were removed because they tested internal implementation
// details (in-memory maps) that no longer exist. The real functionality is now
// tested by the integration tests which use actual SQLite database.
