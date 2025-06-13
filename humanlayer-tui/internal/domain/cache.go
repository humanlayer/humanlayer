// Package domain contains the pure business logic of the application.
package domain

import (
	"sync"
	"time"

	"github.com/humanlayer/humanlayer/hld/rpc"
)

// ConversationCacheEntry represents a cached conversation
type ConversationCacheEntry struct {
	Session      *rpc.SessionState
	Events       []rpc.ConversationEvent
	LastAccessed time.Time
}

// ConversationCache implements a simple LRU cache for conversations
type ConversationCache struct {
	mu      sync.RWMutex
	entries map[string]*ConversationCacheEntry
	maxSize int
}

// NewConversationCache creates a new conversation cache with specified max size
func NewConversationCache(maxSize int) *ConversationCache {
	return &ConversationCache{
		entries: make(map[string]*ConversationCacheEntry),
		maxSize: maxSize,
	}
}

// Get retrieves a conversation from cache if it exists
func (c *ConversationCache) Get(sessionID string) (*rpc.SessionState, []rpc.ConversationEvent, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, exists := c.entries[sessionID]
	if !exists {
		return nil, nil, false
	}

	// Update access time for LRU
	entry.LastAccessed = time.Now()
	return entry.Session, entry.Events, true
}

// Put stores a conversation in cache, evicting oldest if necessary
func (c *ConversationCache) Put(sessionID string, session *rpc.SessionState, events []rpc.ConversationEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// If at capacity, evict least recently used
	if len(c.entries) >= c.maxSize && c.entries[sessionID] == nil {
		c.evictLRU()
	}

	c.entries[sessionID] = &ConversationCacheEntry{
		Session:      session,
		Events:       events,
		LastAccessed: time.Now(),
	}
}

// evictLRU removes the least recently used entry
func (c *ConversationCache) evictLRU() {
	if len(c.entries) == 0 {
		return
	}

	var oldestKey string
	var oldestTime time.Time
	first := true

	for key, entry := range c.entries {
		if first || entry.LastAccessed.Before(oldestTime) {
			oldestKey = key
			oldestTime = entry.LastAccessed
			first = false
		}
	}

	delete(c.entries, oldestKey)
}

// Invalidate removes a specific conversation from cache (useful when it's updated)
func (c *ConversationCache) Invalidate(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, sessionID)
}

// Clear removes all entries from the cache
func (c *ConversationCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*ConversationCacheEntry)
}

// Size returns the current number of entries in the cache
func (c *ConversationCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}
