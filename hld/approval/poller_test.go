package approval

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
)

// mockClient is a mock implementation of the HumanLayer client for testing
type mockClient struct {
	functionCalls   []humanlayer.FunctionCall
	humanContacts   []humanlayer.HumanContact
	fcError         error
	hcError         error
	fcCallCount     int
	hcCallCount     int
	mu              sync.Mutex
}

func (m *mockClient) GetPendingFunctionCalls(ctx context.Context) ([]humanlayer.FunctionCall, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fcCallCount++
	if m.fcError != nil {
		return nil, m.fcError
	}
	return m.functionCalls, nil
}

func (m *mockClient) GetPendingHumanContacts(ctx context.Context) ([]humanlayer.HumanContact, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hcCallCount++
	if m.hcError != nil {
		return nil, m.hcError
	}
	return m.humanContacts, nil
}

func (m *mockClient) ApproveFunctionCall(ctx context.Context, callID string, comment string) error {
	return nil
}

func (m *mockClient) DenyFunctionCall(ctx context.Context, callID string, reason string) error {
	return nil
}

func (m *mockClient) RespondToHumanContact(ctx context.Context, callID string, response string) error {
	return nil
}

func (m *mockClient) getFCCallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.fcCallCount
}

func (m *mockClient) getHCCallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.hcCallCount
}

// mockStore is a mock implementation of Store for testing
type mockStore struct {
	functionCalls map[string]*humanlayer.FunctionCall
	humanContacts map[string]*humanlayer.HumanContact
	storeError    error
}

func newMockStore() *mockStore {
	return &mockStore{
		functionCalls: make(map[string]*humanlayer.FunctionCall),
		humanContacts: make(map[string]*humanlayer.HumanContact),
	}
}

func (m *mockStore) StoreFunctionCall(fc humanlayer.FunctionCall) error {
	if m.storeError != nil {
		return m.storeError
	}
	m.functionCalls[fc.CallID] = &fc
	return nil
}

func (m *mockStore) StoreHumanContact(hc humanlayer.HumanContact) error {
	if m.storeError != nil {
		return m.storeError
	}
	m.humanContacts[hc.CallID] = &hc
	return nil
}

func (m *mockStore) GetFunctionCall(callID string) (*humanlayer.FunctionCall, error) {
	fc, ok := m.functionCalls[callID]
	if !ok {
		return nil, errors.New("not found")
	}
	return fc, nil
}

func (m *mockStore) GetHumanContact(callID string) (*humanlayer.HumanContact, error) {
	hc, ok := m.humanContacts[callID]
	if !ok {
		return nil, errors.New("not found")
	}
	return hc, nil
}

func (m *mockStore) GetAllPending() ([]PendingApproval, error) {
	return []PendingApproval{}, nil
}

func (m *mockStore) GetPendingByRunID(runID string) ([]PendingApproval, error) {
	return []PendingApproval{}, nil
}

func (m *mockStore) MarkFunctionCallResponded(callID string) error {
	return nil
}

func (m *mockStore) MarkHumanContactResponded(callID string) error {
	return nil
}

func TestPoller_Poll(t *testing.T) {
	// Create mock client with test data
	client := &mockClient{
		functionCalls: []humanlayer.FunctionCall{
			{CallID: "fc-1", RunID: "run-1"},
			{CallID: "fc-2", RunID: "run-2"},
		},
		humanContacts: []humanlayer.HumanContact{
			{CallID: "hc-1", RunID: "run-1"},
		},
	}

	store := newMockStore()

	// Create poller with short interval for testing
	poller := &Poller{
		client:        client,
		store:         store,
		interval:      10 * time.Millisecond,
		maxBackoff:    100 * time.Millisecond,
		backoffFactor: 2.0,
	}

	// Poll once
	ctx := context.Background()
	poller.poll(ctx)

	// Verify data was stored
	if len(store.functionCalls) != 2 {
		t.Errorf("expected 2 function calls stored, got %d", len(store.functionCalls))
	}
	if len(store.humanContacts) != 1 {
		t.Errorf("expected 1 human contact stored, got %d", len(store.humanContacts))
	}

	// Verify no failure count
	if poller.failureCount != 0 {
		t.Errorf("expected failure count 0, got %d", poller.failureCount)
	}
}

func TestPoller_Backoff(t *testing.T) {
	// Create mock client that returns errors
	client := &mockClient{
		fcError: errors.New("API error"),
		hcError: errors.New("API error"),
	}

	store := newMockStore()

	poller := &Poller{
		client:        client,
		store:         store,
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
	client.fcError = nil
	client.hcError = nil
	poller.poll(ctx)
	if poller.failureCount != 0 {
		t.Errorf("expected failure count reset to 0, got %d", poller.failureCount)
	}
}

func TestPoller_StartStop(t *testing.T) {
	client := &mockClient{}
	store := newMockStore()
	
	poller := NewPoller(client, store, 50*time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start poller
	err := poller.Start(ctx)
	if err != nil {
		t.Fatalf("failed to start poller: %v", err)
	}

	// Wait for a few polls
	time.Sleep(120 * time.Millisecond)

	// Verify it polled multiple times
	fcCount := client.getFCCallCount()
	hcCount := client.getHCCallCount()
	if fcCount < 2 {
		t.Errorf("expected at least 2 function call polls, got %d", fcCount)
	}
	if hcCount < 2 {
		t.Errorf("expected at least 2 human contact polls, got %d", hcCount)
	}

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