package api

import (
	"context"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestWithTimeout_Success(t *testing.T) {
	// Create a command that completes quickly
	cmd := func() tea.Msg {
		time.Sleep(10 * time.Millisecond)
		return domain.FetchRequestsMsg{Requests: []domain.Request{}}
	}

	// Wrap with timeout
	wrappedCmd := withTimeout(cmd, 100*time.Millisecond, "test-operation")

	// Execute
	msg := wrappedCmd()

	// Should get the original message
	if _, ok := msg.(domain.FetchRequestsMsg); !ok {
		t.Errorf("expected FetchRequestsMsg, got %T", msg)
	}
}

func TestWithTimeout_Timeout(t *testing.T) {
	// Create a command that takes too long
	cmd := func() tea.Msg {
		time.Sleep(200 * time.Millisecond)
		return domain.FetchRequestsMsg{Requests: []domain.Request{}}
	}

	// Wrap with short timeout
	wrappedCmd := withTimeout(cmd, 50*time.Millisecond, "test-operation")

	// Execute
	msg := wrappedCmd()

	// Should get timeout message
	timeoutMsg, ok := msg.(domain.TimeoutMsg)
	if !ok {
		t.Fatalf("expected TimeoutMsg, got %T", msg)
	}

	if timeoutMsg.Operation != "test-operation" {
		t.Errorf("expected operation 'test-operation', got %s", timeoutMsg.Operation)
	}

	if timeoutMsg.Duration != 50*time.Millisecond {
		t.Errorf("expected duration 50ms, got %v", timeoutMsg.Duration)
	}
}

func TestTimeoutConfig_Defaults(t *testing.T) {
	config := DefaultTimeoutConfig()

	if config.FetchTimeout != DefaultFetchTimeout {
		t.Errorf("expected fetch timeout %v, got %v", DefaultFetchTimeout, config.FetchTimeout)
	}

	if config.LaunchTimeout != DefaultLaunchTimeout {
		t.Errorf("expected launch timeout %v, got %v", DefaultLaunchTimeout, config.LaunchTimeout)
	}

	if config.OperationTimeout != DefaultOperationTimeout {
		t.Errorf("expected operation timeout %v, got %v", DefaultOperationTimeout, config.OperationTimeout)
	}
}

func TestConnectionHealthChecker_Healthy(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	// Create health checker
	checker := NewConnectionHealthChecker(apiClient)

	// Initially should be unhealthy (never checked)
	if checker.IsHealthy() {
		t.Error("expected unhealthy before first check")
	}

	// Mock successful health check
	mockClient.EXPECT().ListSessions().Return(&rpc.ListSessionsResponse{Sessions: []session.Info{}}, nil)

	// Perform health check
	ctx := context.Background()
	err := checker.CheckHealth(ctx)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	// Should now be healthy
	if !checker.IsHealthy() {
		t.Error("expected healthy after successful check")
	}
}

func TestConnectionHealthChecker_Unhealthy(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	// Create health checker
	checker := NewConnectionHealthChecker(apiClient)

	// Mock failed health check
	mockClient.EXPECT().ListSessions().Return(nil, domain.ErrConnectionFailed)

	// Perform health check
	ctx := context.Background()
	err := checker.CheckHealth(ctx)
	if err == nil {
		t.Error("expected error from failed health check")
	}

	// Should be unhealthy
	if checker.IsHealthy() {
		t.Error("expected unhealthy after failed check")
	}
}

func TestConnectionHealthChecker_Timeout(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	// Create health checker
	checker := NewConnectionHealthChecker(apiClient)

	// Mock slow health check
	mockClient.EXPECT().ListSessions().DoAndReturn(func() (*rpc.ListSessionsResponse, error) {
		time.Sleep(200 * time.Millisecond)
		return &rpc.ListSessionsResponse{Sessions: []session.Info{}}, nil
	})

	// Perform health check with short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := checker.CheckHealth(ctx)
	if err == nil {
		t.Error("expected timeout error")
	}

	// Should be unhealthy
	if checker.IsHealthy() {
		t.Error("expected unhealthy after timeout")
	}
}
