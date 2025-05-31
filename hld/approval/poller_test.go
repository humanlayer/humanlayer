package approval

import (
	"context"
	"errors"
	"testing"
	"time"

	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
	"go.uber.org/mock/gomock"
)

func TestPoller_Poll(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Create mock client with test data
	mockClient := NewMockAPIClient(ctrl)
	mockStore := NewMockStore(ctrl)

	testFunctionCalls := []humanlayer.FunctionCall{
		{CallID: "fc-1", RunID: "run-1"},
		{CallID: "fc-2", RunID: "run-2"},
	}
	testHumanContacts := []humanlayer.HumanContact{
		{CallID: "hc-1", RunID: "run-1"},
	}

	// Set expectations
	mockClient.EXPECT().GetPendingFunctionCalls(gomock.Any()).Return(testFunctionCalls, nil)
	mockClient.EXPECT().GetPendingHumanContacts(gomock.Any()).Return(testHumanContacts, nil)

	// Expect checks for existing approvals
	mockStore.EXPECT().GetFunctionCall("fc-1").Return(nil, errors.New("not found"))
	mockStore.EXPECT().GetFunctionCall("fc-2").Return(nil, errors.New("not found"))
	mockStore.EXPECT().GetHumanContact("hc-1").Return(nil, errors.New("not found"))

	mockStore.EXPECT().StoreFunctionCall(testFunctionCalls[0]).Return(nil)
	mockStore.EXPECT().StoreFunctionCall(testFunctionCalls[1]).Return(nil)
	mockStore.EXPECT().StoreHumanContact(testHumanContacts[0]).Return(nil)

	// Create poller with short interval for testing
	poller := &Poller{
		client:        mockClient,
		store:         mockStore,
		interval:      10 * time.Millisecond,
		maxBackoff:    100 * time.Millisecond,
		backoffFactor: 2.0,
	}

	// Poll once
	ctx := context.Background()
	poller.poll(ctx)

	// Verify no failure count
	if poller.failureCount != 0 {
		t.Errorf("expected failure count 0, got %d", poller.failureCount)
	}
}

func TestPoller_Backoff(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := NewMockAPIClient(ctrl)
	mockStore := NewMockStore(ctrl)

	apiErr := errors.New("API error")

	// First two calls fail
	mockClient.EXPECT().GetPendingFunctionCalls(gomock.Any()).Return(nil, apiErr).Times(2)
	mockClient.EXPECT().GetPendingHumanContacts(gomock.Any()).Return(nil, apiErr).Times(2)

	// Third call succeeds
	mockClient.EXPECT().GetPendingFunctionCalls(gomock.Any()).Return([]humanlayer.FunctionCall{}, nil)
	mockClient.EXPECT().GetPendingHumanContacts(gomock.Any()).Return([]humanlayer.HumanContact{}, nil)

	poller := &Poller{
		client:        mockClient,
		store:         mockStore,
		interval:      10 * time.Millisecond,
		maxBackoff:    100 * time.Millisecond,
		backoffFactor: 2.0,
	}

	ctx := context.Background()

	// First poll should fail and increment failure count
	poller.poll(ctx)
	if poller.failureCount != 1 {
		t.Errorf("expected failure count 1, got %d", poller.failureCount)
	}

	// Calculate expected interval (10ms * 2^1 = 20ms)
	interval := poller.calculateInterval()
	if interval != 20*time.Millisecond {
		t.Errorf("expected interval 20ms, got %v", interval)
	}

	// Second poll should fail and increment again
	poller.poll(ctx)
	if poller.failureCount != 2 {
		t.Errorf("expected failure count 2, got %d", poller.failureCount)
	}

	// Calculate expected interval (10ms * 2^2 = 40ms)
	interval = poller.calculateInterval()
	if interval != 40*time.Millisecond {
		t.Errorf("expected interval 40ms, got %v", interval)
	}

	// Test max backoff
	poller.failureCount = 10
	interval = poller.calculateInterval()
	if interval != poller.maxBackoff {
		t.Errorf("expected max backoff %v, got %v", poller.maxBackoff, interval)
	}

	// Test reset on success
	poller.poll(ctx)
	if poller.failureCount != 0 {
		t.Errorf("expected failure count reset to 0, got %d", poller.failureCount)
	}
}

func TestPoller_StartStop(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := NewMockAPIClient(ctrl)
	mockStore := NewMockStore(ctrl)

	// Expect at least 2 polls during the test duration
	mockClient.EXPECT().GetPendingFunctionCalls(gomock.Any()).Return([]humanlayer.FunctionCall{}, nil).MinTimes(2)
	mockClient.EXPECT().GetPendingHumanContacts(gomock.Any()).Return([]humanlayer.HumanContact{}, nil).MinTimes(2)

	poller := NewPoller(mockClient, mockStore, 50*time.Millisecond, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start poller
	err := poller.Start(ctx)
	if err != nil {
		t.Fatalf("failed to start poller: %v", err)
	}

	// Wait for a few polls
	time.Sleep(120 * time.Millisecond)

	// Try to start again while running should fail
	err = poller.Start(ctx)
	if err == nil {
		t.Error("expected error starting poller twice")
	}

	// Stop poller
	poller.Stop()

	// Verify it's stopped
	if poller.IsRunning() {
		t.Error("expected poller to be stopped")
	}
}
