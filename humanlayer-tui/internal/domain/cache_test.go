package domain

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/rpc"
)

func TestNewConversationCache(t *testing.T) {
	cache := NewConversationCache(10)
	if cache == nil {
		t.Fatal("NewConversationCache returned nil")
	}
	if cache.maxSize != 10 {
		t.Errorf("Expected maxSize 10, got %d", cache.maxSize)
	}
	if len(cache.entries) != 0 {
		t.Errorf("Expected empty entries map, got %d entries", len(cache.entries))
	}
}

func TestConversationCache_GetPut(t *testing.T) {
	cache := NewConversationCache(5)

	// Test empty cache
	session, events, ok := cache.Get("nonexistent")
	if ok {
		t.Error("Expected Get to return false for nonexistent key")
	}
	if session != nil || events != nil {
		t.Error("Expected nil returns for nonexistent key")
	}

	// Test Put and Get
	testSession := &rpc.SessionState{ID: "test-session"}
	testEvents := []rpc.ConversationEvent{{ID: 123}}

	cache.Put("session1", testSession, testEvents)

	session, events, ok = cache.Get("session1")
	if !ok {
		t.Error("Expected Get to return true after Put")
	}
	if session.ID != "test-session" {
		t.Errorf("Expected session ID 'test-session', got %s", session.ID)
	}
	if len(events) != 1 || events[0].ID != 123 {
		t.Error("Events not retrieved correctly")
	}
}

func TestConversationCache_LRUEviction(t *testing.T) {
	cache := NewConversationCache(3)

	// Fill cache to capacity
	for i := 0; i < 3; i++ {
		sessionID := fmt.Sprintf("session%d", i)
		session := &rpc.SessionState{ID: sessionID}
		cache.Put(sessionID, session, nil)
		time.Sleep(10 * time.Millisecond) // Ensure different timestamps
	}

	// Verify all entries exist
	for i := 0; i < 3; i++ {
		_, _, ok := cache.Get(fmt.Sprintf("session%d", i))
		if !ok {
			t.Errorf("Expected session%d to exist", i)
		}
	}

	// Add one more entry, should evict oldest (session0)
	cache.Put("session3", &rpc.SessionState{ID: "session3"}, nil)

	// session0 should be evicted
	_, _, ok := cache.Get("session0")
	if ok {
		t.Error("Expected session0 to be evicted")
	}

	// Others should still exist
	for i := 1; i <= 3; i++ {
		_, _, ok := cache.Get(fmt.Sprintf("session%d", i))
		if !ok {
			t.Errorf("Expected session%d to exist", i)
		}
	}
}

func TestConversationCache_UpdateExisting(t *testing.T) {
	cache := NewConversationCache(3)

	// Put initial entry
	cache.Put("session1", &rpc.SessionState{ID: "v1"}, nil)

	// Update same entry
	cache.Put("session1", &rpc.SessionState{ID: "v2"}, nil)

	// Should not increase cache size
	if cache.Size() != 1 {
		t.Errorf("Expected cache size 1, got %d", cache.Size())
	}

	// Should have updated value
	session, _, _ := cache.Get("session1")
	if session.ID != "v2" {
		t.Errorf("Expected updated session ID 'v2', got %s", session.ID)
	}
}

func TestConversationCache_AccessTimeUpdate(t *testing.T) {
	cache := NewConversationCache(3)

	// Add entries with delays
	cache.Put("old", &rpc.SessionState{ID: "old"}, nil)
	time.Sleep(50 * time.Millisecond)
	cache.Put("middle", &rpc.SessionState{ID: "middle"}, nil)
	time.Sleep(50 * time.Millisecond)
	cache.Put("new", &rpc.SessionState{ID: "new"}, nil)

	// Access "old" to update its access time
	cache.Get("old")

	// Add one more entry - should evict "middle" not "old"
	cache.Put("newest", &rpc.SessionState{ID: "newest"}, nil)

	// "old" should still exist due to recent access
	_, _, ok := cache.Get("old")
	if !ok {
		t.Error("Expected 'old' to exist after recent access")
	}

	// "middle" should be evicted
	_, _, ok = cache.Get("middle")
	if ok {
		t.Error("Expected 'middle' to be evicted")
	}
}

func TestConversationCache_Invalidate(t *testing.T) {
	cache := NewConversationCache(5)

	cache.Put("session1", &rpc.SessionState{ID: "session1"}, nil)
	cache.Put("session2", &rpc.SessionState{ID: "session2"}, nil)

	// Invalidate one entry
	cache.Invalidate("session1")

	_, _, ok := cache.Get("session1")
	if ok {
		t.Error("Expected session1 to be invalidated")
	}

	// Other entry should still exist
	_, _, ok = cache.Get("session2")
	if !ok {
		t.Error("Expected session2 to still exist")
	}

	// Invalidating non-existent key should not panic
	cache.Invalidate("nonexistent")
}

func TestConversationCache_Clear(t *testing.T) {
	cache := NewConversationCache(5)

	// Add multiple entries
	for i := 0; i < 3; i++ {
		cache.Put(fmt.Sprintf("session%d", i), &rpc.SessionState{}, nil)
	}

	if cache.Size() != 3 {
		t.Errorf("Expected size 3, got %d", cache.Size())
	}

	cache.Clear()

	if cache.Size() != 0 {
		t.Errorf("Expected size 0 after Clear, got %d", cache.Size())
	}

	// Verify all entries are gone
	for i := 0; i < 3; i++ {
		_, _, ok := cache.Get(fmt.Sprintf("session%d", i))
		if ok {
			t.Errorf("Expected session%d to be cleared", i)
		}
	}
}

func TestConversationCache_Size(t *testing.T) {
	cache := NewConversationCache(5)

	if cache.Size() != 0 {
		t.Errorf("Expected initial size 0, got %d", cache.Size())
	}

	cache.Put("s1", &rpc.SessionState{}, nil)
	if cache.Size() != 1 {
		t.Errorf("Expected size 1, got %d", cache.Size())
	}

	cache.Put("s2", &rpc.SessionState{}, nil)
	if cache.Size() != 2 {
		t.Errorf("Expected size 2, got %d", cache.Size())
	}

	cache.Invalidate("s1")
	if cache.Size() != 1 {
		t.Errorf("Expected size 1 after invalidate, got %d", cache.Size())
	}
}

// Concurrent access tests
func TestConversationCache_ConcurrentPutGet(t *testing.T) {
	cache := NewConversationCache(100)
	const numGoroutines = 10
	const numOperations = 100

	var wg sync.WaitGroup
	wg.Add(numGoroutines * 2) // Half putting, half getting

	// Start put goroutines
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < numOperations; j++ {
				sessionID := fmt.Sprintf("session-%d-%d", id, j)
				cache.Put(sessionID, &rpc.SessionState{ID: sessionID}, nil)
			}
		}(i)
	}

	// Start get goroutines
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < numOperations; j++ {
				// Try to get entries from various goroutines
				sessionID := fmt.Sprintf("session-%d-%d", (id+j)%numGoroutines, j)
				cache.Get(sessionID)
			}
		}(i)
	}

	wg.Wait()

	// Cache should not have crashed and size should be reasonable
	size := cache.Size()
	if size == 0 || size > 100 {
		t.Errorf("Unexpected cache size after concurrent operations: %d", size)
	}
}

func TestConversationCache_ConcurrentEviction(t *testing.T) {
	cache := NewConversationCache(10) // Small cache to force evictions
	const numGoroutines = 20
	const numOperations = 50

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < numOperations; j++ {
				sessionID := fmt.Sprintf("session-%d-%d", id, j)
				cache.Put(sessionID, &rpc.SessionState{ID: sessionID}, nil)
				// Also do some reads to trigger access time updates
				if j%3 == 0 {
					cache.Get(fmt.Sprintf("session-%d-%d", id, j-1))
				}
			}
		}(i)
	}

	wg.Wait()

	// Cache size should not exceed maxSize
	if cache.Size() > 10 {
		t.Errorf("Cache size %d exceeds maxSize 10", cache.Size())
	}
}

func TestConversationCache_ConcurrentInvalidate(t *testing.T) {
	cache := NewConversationCache(100)
	const numGoroutines = 10

	// Pre-populate cache
	for i := 0; i < 50; i++ {
		cache.Put(fmt.Sprintf("session%d", i), &rpc.SessionState{}, nil)
	}

	var wg sync.WaitGroup
	wg.Add(numGoroutines * 3) // Put, Get, and Invalidate goroutines

	// Put goroutines
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				cache.Put(fmt.Sprintf("new-%d-%d", id, j), &rpc.SessionState{}, nil)
			}
		}(i)
	}

	// Get goroutines
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				cache.Get(fmt.Sprintf("session%d", j))
			}
		}(i)
	}

	// Invalidate goroutines
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if j%5 == id%5 { // Each goroutine invalidates different subset
					cache.Invalidate(fmt.Sprintf("session%d", j))
				}
			}
		}(i)
	}

	wg.Wait()

	// Cache should still be functional
	cache.Put("final", &rpc.SessionState{ID: "final"}, nil)
	session, _, ok := cache.Get("final")
	if !ok || session.ID != "final" {
		t.Error("Cache not functional after concurrent operations")
	}
}

func TestConversationCache_ConcurrentClear(t *testing.T) {
	cache := NewConversationCache(50)

	var wg sync.WaitGroup
	wg.Add(3)

	// Continuously put entries
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			cache.Put(fmt.Sprintf("session%d", i), &rpc.SessionState{}, nil)
			time.Sleep(time.Millisecond)
		}
	}()

	// Continuously get entries
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			cache.Get(fmt.Sprintf("session%d", i%50))
			time.Sleep(time.Millisecond)
		}
	}()

	// Clear cache periodically
	go func() {
		defer wg.Done()
		for i := 0; i < 5; i++ {
			time.Sleep(20 * time.Millisecond)
			cache.Clear()
		}
	}()

	wg.Wait()

	// Final clear to verify
	cache.Clear()
	if cache.Size() != 0 {
		t.Errorf("Expected size 0 after final clear, got %d", cache.Size())
	}
}

// Race condition test with -race flag
func TestConversationCache_RaceCondition(t *testing.T) {
	cache := NewConversationCache(20)
	done := make(chan bool)

	// Multiple goroutines performing random operations
	for i := 0; i < 10; i++ {
		go func(id int) {
			for j := 0; j < 50; j++ {
				switch j % 6 {
				case 0:
					cache.Put(fmt.Sprintf("key%d", j), &rpc.SessionState{}, nil)
				case 1:
					cache.Get(fmt.Sprintf("key%d", j-1))
				case 2:
					cache.Invalidate(fmt.Sprintf("key%d", j-2))
				case 3:
					cache.Size()
				case 4:
					if j%10 == 0 {
						cache.Clear()
					}
				case 5:
					cache.Put(fmt.Sprintf("key%d", j), &rpc.SessionState{}, nil)
				}
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}
}

// Benchmark tests
func BenchmarkCachePut(b *testing.B) {
	cache := NewConversationCache(1000)
	session := &rpc.SessionState{ID: "bench"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Put(fmt.Sprintf("session%d", i), session, nil)
	}
}

func BenchmarkCacheGet(b *testing.B) {
	cache := NewConversationCache(1000)
	// Pre-populate
	for i := 0; i < 1000; i++ {
		cache.Put(fmt.Sprintf("session%d", i), &rpc.SessionState{}, nil)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Get(fmt.Sprintf("session%d", i%1000))
	}
}

func BenchmarkCachePutWithEviction(b *testing.B) {
	cache := NewConversationCache(100) // Small cache to force evictions
	session := &rpc.SessionState{ID: "bench"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Put(fmt.Sprintf("session%d", i), session, nil)
	}
}
