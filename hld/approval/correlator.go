package approval

import (
	"fmt"
	"sync"
	"time"

	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
)

// MemoryStore is an in-memory implementation of Store
type MemoryStore struct {
	mu            sync.RWMutex
	functionCalls map[string]*humanlayer.FunctionCall // indexed by call_id
	humanContacts map[string]*humanlayer.HumanContact // indexed by call_id
	byRunID       map[string][]string                 // run_id -> []call_id
}

// NewMemoryStore creates a new in-memory store
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		functionCalls: make(map[string]*humanlayer.FunctionCall),
		humanContacts: make(map[string]*humanlayer.HumanContact),
		byRunID:       make(map[string][]string),
	}
}

// StoreFunctionCall stores a function call approval request
func (s *MemoryStore) StoreFunctionCall(fc humanlayer.FunctionCall) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Store by call_id
	s.functionCalls[fc.CallID] = &fc

	// Index by run_id if present
	if fc.RunID != "" {
		s.addToRunIndex(fc.RunID, fc.CallID)
	}

	return nil
}

// StoreHumanContact stores a human contact request
func (s *MemoryStore) StoreHumanContact(hc humanlayer.HumanContact) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Store by call_id
	s.humanContacts[hc.CallID] = &hc

	// Index by run_id if present
	if hc.RunID != "" {
		s.addToRunIndex(hc.RunID, hc.CallID)
	}

	return nil
}

// GetFunctionCall retrieves a function call by ID
func (s *MemoryStore) GetFunctionCall(callID string) (*humanlayer.FunctionCall, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	fc, ok := s.functionCalls[callID]
	if !ok {
		return nil, fmt.Errorf("function call not found: %s", callID)
	}
	return fc, nil
}

// GetHumanContact retrieves a human contact by ID
func (s *MemoryStore) GetHumanContact(callID string) (*humanlayer.HumanContact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	hc, ok := s.humanContacts[callID]
	if !ok {
		return nil, fmt.Errorf("human contact not found: %s", callID)
	}
	return hc, nil
}

// GetAllPending returns all pending approvals
func (s *MemoryStore) GetAllPending() ([]PendingApproval, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var approvals []PendingApproval

	// Add function calls
	for _, fc := range s.functionCalls {
		// Only include if not yet responded
		if fc.Status == nil || fc.Status.RespondedAt == nil {
			approvals = append(approvals, PendingApproval{
				Type:         "function_call",
				FunctionCall: fc,
			})
		}
	}

	// Add human contacts
	for _, hc := range s.humanContacts {
		// Only include if not yet responded
		if hc.Status == nil || hc.Status.RespondedAt == nil {
			approvals = append(approvals, PendingApproval{
				Type:         "human_contact",
				HumanContact: hc,
			})
		}
	}

	return approvals, nil
}

// GetPendingByRunID returns pending approvals for a specific run_id
func (s *MemoryStore) GetPendingByRunID(runID string) ([]PendingApproval, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	callIDs, ok := s.byRunID[runID]
	if !ok {
		return []PendingApproval{}, nil
	}

	var approvals []PendingApproval
	for _, callID := range callIDs {
		// Check function calls
		if fc, ok := s.functionCalls[callID]; ok {
			if fc.Status == nil || fc.Status.RespondedAt == nil {
				approvals = append(approvals, PendingApproval{
					Type:         "function_call",
					FunctionCall: fc,
				})
			}
		}

		// Check human contacts
		if hc, ok := s.humanContacts[callID]; ok {
			if hc.Status == nil || hc.Status.RespondedAt == nil {
				approvals = append(approvals, PendingApproval{
					Type:         "human_contact",
					HumanContact: hc,
				})
			}
		}
	}

	return approvals, nil
}

// MarkFunctionCallResponded marks a function call as responded
func (s *MemoryStore) MarkFunctionCallResponded(callID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	fc, ok := s.functionCalls[callID]
	if !ok {
		return fmt.Errorf("function call not found: %s", callID)
	}

	// Update status to mark as responded
	if fc.Status == nil {
		fc.Status = &humanlayer.FunctionCallStatus{}
	}
	now := humanlayer.CustomTime{Time: time.Now()}
	fc.Status.RespondedAt = &now

	return nil
}

// MarkHumanContactResponded marks a human contact as responded
func (s *MemoryStore) MarkHumanContactResponded(callID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	hc, ok := s.humanContacts[callID]
	if !ok {
		return fmt.Errorf("human contact not found: %s", callID)
	}

	// Update status to mark as responded
	if hc.Status == nil {
		hc.Status = &humanlayer.HumanContactStatus{}
	}
	now := humanlayer.CustomTime{Time: time.Now()}
	hc.Status.RespondedAt = &now

	return nil
}

// addToRunIndex adds a call_id to the run_id index
func (s *MemoryStore) addToRunIndex(runID, callID string) {
	if _, exists := s.byRunID[runID]; !exists {
		s.byRunID[runID] = []string{}
	}

	// Check if callID already exists to avoid duplicates
	for _, id := range s.byRunID[runID] {
		if id == callID {
			return
		}
	}

	s.byRunID[runID] = append(s.byRunID[runID], callID)
}
