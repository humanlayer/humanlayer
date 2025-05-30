package approval

import (
	"fmt"
	"testing"
	"time"

	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
)

func TestMemoryStore_StoreFunctionCall(t *testing.T) {
	store := NewMemoryStore()

	fc := humanlayer.FunctionCall{
		CallID: "test-call-1",
		RunID:  "test-run-1",
		Spec: humanlayer.FunctionCallSpec{
			Fn: "test_function",
		},
	}

	// Store function call
	err := store.StoreFunctionCall(fc)
	if err != nil {
		t.Fatalf("failed to store function call: %v", err)
	}

	// Retrieve it
	retrieved, err := store.GetFunctionCall("test-call-1")
	if err != nil {
		t.Fatalf("failed to get function call: %v", err)
	}

	if retrieved.CallID != fc.CallID {
		t.Errorf("expected call_id %s, got %s", fc.CallID, retrieved.CallID)
	}
	if retrieved.RunID != fc.RunID {
		t.Errorf("expected run_id %s, got %s", fc.RunID, retrieved.RunID)
	}
}

func TestMemoryStore_StoreHumanContact(t *testing.T) {
	store := NewMemoryStore()

	hc := humanlayer.HumanContact{
		CallID: "test-contact-1",
		RunID:  "test-run-1",
		Spec: humanlayer.HumanContactSpec{
			Msg: "Test message",
		},
	}

	// Store human contact
	err := store.StoreHumanContact(hc)
	if err != nil {
		t.Fatalf("failed to store human contact: %v", err)
	}

	// Retrieve it
	retrieved, err := store.GetHumanContact("test-contact-1")
	if err != nil {
		t.Fatalf("failed to get human contact: %v", err)
	}

	if retrieved.CallID != hc.CallID {
		t.Errorf("expected call_id %s, got %s", hc.CallID, retrieved.CallID)
	}
	if retrieved.RunID != hc.RunID {
		t.Errorf("expected run_id %s, got %s", hc.RunID, retrieved.RunID)
	}
}

func TestMemoryStore_GetAllPending(t *testing.T) {
	store := NewMemoryStore()

	// Store some approvals
	fc1 := humanlayer.FunctionCall{
		CallID: "fc-1",
		RunID:  "run-1",
		Spec:   humanlayer.FunctionCallSpec{Fn: "func1"},
	}
	fc2 := humanlayer.FunctionCall{
		CallID: "fc-2",
		RunID:  "run-2",
		Spec:   humanlayer.FunctionCallSpec{Fn: "func2"},
		Status: &humanlayer.FunctionCallStatus{
			RespondedAt: &humanlayer.CustomTime{Time: time.Now()},
		},
	}
	hc1 := humanlayer.HumanContact{
		CallID: "hc-1",
		RunID:  "run-1",
		Spec:   humanlayer.HumanContactSpec{Msg: "msg1"},
	}

	store.StoreFunctionCall(fc1)
	store.StoreFunctionCall(fc2) // This one is responded, should not be included
	store.StoreHumanContact(hc1)

	// Get all pending
	pending, err := store.GetAllPending()
	if err != nil {
		t.Fatalf("failed to get pending: %v", err)
	}

	// Should have 2 pending (fc1 and hc1, not fc2)
	if len(pending) != 2 {
		t.Errorf("expected 2 pending approvals, got %d", len(pending))
	}

	// Verify the right ones are included
	foundFC1 := false
	foundHC1 := false
	for _, p := range pending {
		if p.Type == "function_call" && p.FunctionCall.CallID == "fc-1" {
			foundFC1 = true
		}
		if p.Type == "human_contact" && p.HumanContact.CallID == "hc-1" {
			foundHC1 = true
		}
	}

	if !foundFC1 {
		t.Error("expected to find fc-1 in pending approvals")
	}
	if !foundHC1 {
		t.Error("expected to find hc-1 in pending approvals")
	}
}

func TestMemoryStore_GetPendingByRunID(t *testing.T) {
	store := NewMemoryStore()

	// Store approvals for different runs
	fc1 := humanlayer.FunctionCall{
		CallID: "fc-1",
		RunID:  "run-1",
		Spec:   humanlayer.FunctionCallSpec{Fn: "func1"},
	}
	fc2 := humanlayer.FunctionCall{
		CallID: "fc-2",
		RunID:  "run-2",
		Spec:   humanlayer.FunctionCallSpec{Fn: "func2"},
	}
	hc1 := humanlayer.HumanContact{
		CallID: "hc-1",
		RunID:  "run-1",
		Spec:   humanlayer.HumanContactSpec{Msg: "msg1"},
	}

	store.StoreFunctionCall(fc1)
	store.StoreFunctionCall(fc2)
	store.StoreHumanContact(hc1)

	// Get pending for run-1
	pending, err := store.GetPendingByRunID("run-1")
	if err != nil {
		t.Fatalf("failed to get pending by run_id: %v", err)
	}

	// Should have 2 approvals for run-1
	if len(pending) != 2 {
		t.Errorf("expected 2 pending approvals for run-1, got %d", len(pending))
	}

	// Get pending for run-2
	pending, err = store.GetPendingByRunID("run-2")
	if err != nil {
		t.Fatalf("failed to get pending by run_id: %v", err)
	}

	// Should have 1 approval for run-2
	if len(pending) != 1 {
		t.Errorf("expected 1 pending approval for run-2, got %d", len(pending))
	}

	// Get pending for non-existent run
	pending, err = store.GetPendingByRunID("run-999")
	if err != nil {
		t.Fatalf("failed to get pending by run_id: %v", err)
	}

	// Should have 0 approvals
	if len(pending) != 0 {
		t.Errorf("expected 0 pending approvals for non-existent run, got %d", len(pending))
	}
}

func TestMemoryStore_MarkResponded(t *testing.T) {
	store := NewMemoryStore()

	// Store approvals
	fc := humanlayer.FunctionCall{
		CallID: "fc-1",
		RunID:  "run-1",
		Spec:   humanlayer.FunctionCallSpec{Fn: "func1"},
	}
	hc := humanlayer.HumanContact{
		CallID: "hc-1",
		RunID:  "run-1",
		Spec:   humanlayer.HumanContactSpec{Msg: "msg1"},
	}

	store.StoreFunctionCall(fc)
	store.StoreHumanContact(hc)

	// Mark function call as responded
	err := store.MarkFunctionCallResponded("fc-1")
	if err != nil {
		t.Fatalf("failed to mark function call responded: %v", err)
	}

	// Mark human contact as responded
	err = store.MarkHumanContactResponded("hc-1")
	if err != nil {
		t.Fatalf("failed to mark human contact responded: %v", err)
	}

	// Verify they're no longer pending
	pending, err := store.GetAllPending()
	if err != nil {
		t.Fatalf("failed to get pending: %v", err)
	}

	if len(pending) != 0 {
		t.Errorf("expected 0 pending approvals after marking responded, got %d", len(pending))
	}
}

func TestMemoryStore_ConcurrentAccess(t *testing.T) {
	store := NewMemoryStore()
	done := make(chan bool)

	// Concurrent writes
	go func() {
		for i := 0; i < 100; i++ {
			fc := humanlayer.FunctionCall{
				CallID: fmt.Sprintf("fc-%d", i),
				RunID:  fmt.Sprintf("run-%d", i%10),
				Spec:   humanlayer.FunctionCallSpec{Fn: "func"},
			}
			store.StoreFunctionCall(fc)
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 100; i++ {
			hc := humanlayer.HumanContact{
				CallID: fmt.Sprintf("hc-%d", i),
				RunID:  fmt.Sprintf("run-%d", i%10),
				Spec:   humanlayer.HumanContactSpec{Msg: "msg"},
			}
			store.StoreHumanContact(hc)
		}
		done <- true
	}()

	// Concurrent reads
	go func() {
		for i := 0; i < 100; i++ {
			store.GetAllPending()
			store.GetPendingByRunID(fmt.Sprintf("run-%d", i%10))
		}
		done <- true
	}()

	// Wait for all goroutines
	for i := 0; i < 3; i++ {
		<-done
	}

	// Verify data integrity
	pending, err := store.GetAllPending()
	if err != nil {
		t.Fatalf("failed to get pending: %v", err)
	}

	// Should have 200 approvals (100 function calls + 100 human contacts)
	if len(pending) != 200 {
		t.Errorf("expected 200 pending approvals, got %d", len(pending))
	}
}