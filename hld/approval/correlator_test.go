package approval

import (
	"fmt"
	"testing"
	"time"

	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMemoryStore_StoreFunctionCall(t *testing.T) {
	req := require.New(t)
	assert := assert.New(t)
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
	req.NoError(err, "failed to store function call")

	// Retrieve it
	retrieved, err := store.GetFunctionCall("test-call-1")
	req.NoError(err, "failed to get function call")

	assert.Equal(fc.CallID, retrieved.CallID, "call_id mismatch")
	assert.Equal(fc.RunID, retrieved.RunID, "run_id mismatch")
}

func TestMemoryStore_StoreHumanContact(t *testing.T) {
	req := require.New(t)
	assert := assert.New(t)
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
	req.NoError(err, "failed to store human contact")

	// Retrieve it
	retrieved, err := store.GetHumanContact("test-contact-1")
	req.NoError(err, "failed to get human contact")

	assert.Equal(hc.CallID, retrieved.CallID, "call_id mismatch")
	assert.Equal(hc.RunID, retrieved.RunID, "run_id mismatch")
}

func TestMemoryStore_GetAllPending(t *testing.T) {
	req := require.New(t)
	assert := assert.New(t)
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

	req.NoError(store.StoreFunctionCall(fc1), "failed to store function call fc1")
	req.NoError(store.StoreFunctionCall(fc2), "failed to store function call fc2")
	req.NoError(store.StoreHumanContact(hc1), "failed to store human contact hc1")

	// Get all pending
	pending, err := store.GetAllPending()
	req.NoError(err, "failed to get pending")

	// Should have 2 pending (fc1 and hc1, not fc2)
	assert.Len(pending, 2, "expected 2 pending approvals")

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

	assert.True(foundFC1, "expected to find fc-1 in pending approvals")
	assert.True(foundHC1, "expected to find hc-1 in pending approvals")
}

func TestMemoryStore_GetPendingByRunID(t *testing.T) {
	req := require.New(t)
	assert := assert.New(t)
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

	req.NoError(store.StoreFunctionCall(fc1), "failed to store function call fc1")
	req.NoError(store.StoreFunctionCall(fc2), "failed to store function call fc2")
	req.NoError(store.StoreHumanContact(hc1), "failed to store human contact hc1")

	// Get pending for run-1
	pending, err := store.GetPendingByRunID("run-1")
	req.NoError(err, "failed to get pending by run_id")
	assert.Len(pending, 2, "expected 2 pending approvals for run-1")

	// Get pending for run-2
	pending, err = store.GetPendingByRunID("run-2")
	req.NoError(err, "failed to get pending by run_id")
	assert.Len(pending, 1, "expected 1 pending approval for run-2")

	// Get pending for non-existent run
	pending, err = store.GetPendingByRunID("run-999")
	req.NoError(err, "failed to get pending by run_id")
	assert.Empty(pending, "expected 0 pending approvals for non-existent run")
}

func TestMemoryStore_MarkResponded(t *testing.T) {
	req := require.New(t)
	assert := assert.New(t)
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

	req.NoError(store.StoreFunctionCall(fc), "failed to store function call")
	req.NoError(store.StoreHumanContact(hc), "failed to store human contact")

	// Mark function call as responded
	req.NoError(store.MarkFunctionCallResponded("fc-1"), "failed to mark function call responded")

	// Mark human contact as responded
	req.NoError(store.MarkHumanContactResponded("hc-1"), "failed to mark human contact responded")

	// Verify they're no longer pending
	pending, err := store.GetAllPending()
	req.NoError(err, "failed to get pending")
	assert.Empty(pending, "expected 0 pending approvals after marking responded")
}

func TestMemoryStore_ConcurrentAccess(t *testing.T) {
	req := require.New(t)
	assert := assert.New(t)
	store := NewMemoryStore()
	done := make(chan bool)

	// Concurrent writes
	go func() {
		var errors []error
		for i := 0; i < 100; i++ {
			fc := humanlayer.FunctionCall{
				CallID: fmt.Sprintf("fc-%d", i),
				RunID:  fmt.Sprintf("run-%d", i%10),
				Spec:   humanlayer.FunctionCallSpec{Fn: "func"},
			}
			if err := store.StoreFunctionCall(fc); err != nil {
				errors = append(errors, err)
			}
		}
		assert.Empty(errors, "StoreFunctionCall errors during concurrent access")
		done <- true
	}()

	go func() {
		var errors []error
		for i := 0; i < 100; i++ {
			hc := humanlayer.HumanContact{
				CallID: fmt.Sprintf("hc-%d", i),
				RunID:  fmt.Sprintf("run-%d", i%10),
				Spec:   humanlayer.HumanContactSpec{Msg: "msg"},
			}
			if err := store.StoreHumanContact(hc); err != nil {
				errors = append(errors, err)
			}
		}
		assert.Empty(errors, "StoreHumanContact errors during concurrent access")
		done <- true
	}()

	// Concurrent reads
	go func() {
		for i := 0; i < 100; i++ {
			_, _ = store.GetAllPending()
			_, _ = store.GetPendingByRunID(fmt.Sprintf("run-%d", i%10))
		}
		done <- true
	}()

	// Wait for all goroutines
	for i := 0; i < 3; i++ {
		<-done
	}

	// Verify data integrity
	pending, err := store.GetAllPending()
	req.NoError(err, "failed to get pending")
	assert.Len(pending, 200, "expected 200 pending approvals (100 function calls + 100 human contacts)")
}
