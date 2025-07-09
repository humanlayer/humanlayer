# WUI Real-time Event Streaming Implementation Plan

## Overview

This plan replaces the current 1-second polling mechanism in the conversation display with real-time event streaming using the existing daemon subscription infrastructure.

## Current State Analysis

The WUI currently polls for conversation updates every second, but the daemon already has a complete real-time event streaming system that's being used for approvals and session status updates. We just need to extend its usage to conversation events.

### Key Discoveries:
- Daemon publishes `conversation_updated` events in real-time (hld/bus/types.go)
- Subscription infrastructure already exists and works (humanlayer-wui/src/lib/daemon/client.ts:70-91)
- Other hooks already use subscriptions successfully (useSubscriptions.ts)
- Event data includes all conversation details (messages, tool calls, results)
- No WebSocket/SSE implementation needed - long-polling JSON-RPC works great

## What We're NOT Doing

- Not implementing WebSocket or Server-Sent Events
- Not changing the daemon's event publishing system
- Not modifying the existing subscription infrastructure
- Not changing how events are stored or structured
- Not removing the ability to manually refresh

## Implementation Approach

Create a new `useConversationSubscription` hook that subscribes to `conversation_updated` events and incrementally updates the conversation state as events arrive.

## Phase 1: Create Real-time Conversation Hook

### Overview
Create a new hook that subscribes to conversation updates and maintains the event list with real-time updates.

### Changes Required:

#### 1. Create New Conversation Subscription Hook
**File**: `humanlayer-wui/src/hooks/useConversationSubscription.ts` (new file)
**Changes**: Create hook for real-time conversation updates

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { daemonClient, ConversationEvent, EventNotification } from '@/lib/daemon'
import { formatError } from '@/utils/errors'

interface UseConversationSubscriptionReturn {
  events: ConversationEvent[]
  loading: boolean
  error: string | null
  isInitialLoad: boolean
  refresh: () => Promise<void>
}

interface ConversationUpdatedEventData {
  session_id: string
  claude_session_id?: string
  event: ConversationEvent
}

export function useConversationSubscription(
  sessionId?: string,
  claudeSessionId?: string,
): UseConversationSubscriptionReturn {
  const [events, setEvents] = useState<ConversationEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const isSubscribedRef = useRef(false)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // Initial fetch to get existing events
  const fetchInitialConversation = useCallback(async () => {
    if (!sessionId && !claudeSessionId) {
      setError('Either sessionId or claudeSessionId must be provided')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const response = await daemonClient.getConversation(sessionId, claudeSessionId)
      setEvents(response.events)
      setIsInitialLoad(false)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId, claudeSessionId])

  // Subscribe to real-time updates
  useEffect(() => {
    if (!sessionId && !claudeSessionId) {
      return
    }

    // Prevent duplicate subscriptions
    if (isSubscribedRef.current) {
      return
    }

    let isActive = true

    const subscribe = async () => {
      // First fetch existing events
      await fetchInitialConversation()

      // Then subscribe to updates
      if (!isActive) return

      try {
        isSubscribedRef.current = true
        
        const subscription = await daemonClient.subscribeToEvents(
          {
            event_types: ['conversation_updated'],
            session_id: sessionId,
            // Note: claudeSessionId filtering might need backend support
          },
          {
            onEvent: (notification: EventNotification) => {
              if (!isActive) return

              if (notification.event.type === 'conversation_updated') {
                const data = notification.event.data as ConversationUpdatedEventData
                
                // Only process events for our session
                if (sessionId && data.session_id !== sessionId) return
                if (claudeSessionId && data.claude_session_id !== claudeSessionId) return

                // Add new event to the list
                setEvents(prev => {
                  // Check if event already exists (by ID)
                  const exists = prev.some(e => e.id === data.event.id)
                  if (exists) return prev
                  
                  // Add new event and sort by ID (or created_at)
                  return [...prev, data.event].sort((a, b) => a.id - b.id)
                })
              }
            },
            onError: (error: Error) => {
              console.error('Conversation subscription error:', error)
              setError(formatError(error))
              // Could fall back to polling here if needed
            },
          },
        )

        unsubscribeRef.current = subscription.unlisten
      } catch (err) {
        console.error('Failed to subscribe to conversation updates:', err)
        setError(formatError(err))
        isSubscribedRef.current = false
      }
    }

    subscribe()

    return () => {
      isActive = false
      isSubscribedRef.current = false
      
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [sessionId, claudeSessionId, fetchInitialConversation])

  return {
    events,
    loading,
    error,
    refresh: fetchInitialConversation,
    isInitialLoad,
  }
}
```

#### 2. Update useConversation to Use Subscription
**File**: `humanlayer-wui/src/hooks/useConversation.ts`
**Changes**: Add option to use subscription-based updates

Add to the top of the file:
```typescript
import { useConversationSubscription } from './useConversationSubscription'
```

Update the hook signature:
```typescript
export function useConversation(
  sessionId?: string,
  claudeSessionId?: string,
  pollInterval: number = 1000,
  useSubscription: boolean = true, // New parameter
): UseConversationReturn {
  // Use subscription-based hook if enabled
  if (useSubscription) {
    return useConversationSubscription(sessionId, claudeSessionId)
  }
  
  // ... existing polling implementation
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] Build completes successfully: `bun run build`
- [ ] No circular dependencies introduced

#### Manual Verification:
- [ ] Initial conversation loads correctly
- [ ] New messages appear instantly without polling delay
- [ ] Tool calls show up immediately when started
- [ ] Tool results update in real-time
- [ ] No duplicate events in the list
- [ ] Events maintain correct order
- [ ] Memory cleanup on unmount (no leaks)

---

## Phase 2: Optimize Performance and Edge Cases

### Overview
Add optimizations for large conversations and handle edge cases gracefully.

### Changes Required:

#### 1. Add Event Deduplication and Batching
**File**: `humanlayer-wui/src/hooks/useConversationSubscription.ts`
**Changes**: Handle rapid event updates efficiently

Update the event handler:
```typescript
// Add refs for batching
const eventQueueRef = useRef<ConversationEvent[]>([])
const processingRef = useRef(false)

// Batch process events to avoid excessive re-renders
const processEventQueue = useCallback(() => {
  if (processingRef.current || eventQueueRef.current.length === 0) return
  
  processingRef.current = true
  
  setEvents(prev => {
    const newEvents = [...prev]
    const eventMap = new Map(prev.map(e => [e.id, e]))
    
    // Process queued events
    for (const event of eventQueueRef.current) {
      if (!eventMap.has(event.id)) {
        newEvents.push(event)
        eventMap.set(event.id, event)
      }
    }
    
    // Clear queue
    eventQueueRef.current = []
    processingRef.current = false
    
    // Sort by ID or created_at
    return newEvents.sort((a, b) => a.id - b.id)
  })
}, [])

// Update the onEvent handler
onEvent: (notification: EventNotification) => {
  if (!isActive) return

  if (notification.event.type === 'conversation_updated') {
    const data = notification.event.data as ConversationUpdatedEventData
    
    // Filter by session
    if (sessionId && data.session_id !== sessionId) return
    if (claudeSessionId && data.claude_session_id !== claudeSessionId) return

    // Queue event for batch processing
    eventQueueRef.current.push(data.event)
    
    // Process queue with requestAnimationFrame for smooth updates
    requestAnimationFrame(processEventQueue)
  }
}
```

#### 2. Add Fallback to Polling
**File**: `humanlayer-wui/src/hooks/useConversationSubscription.ts`
**Changes**: Fall back to polling if subscription fails

Add polling fallback:
```typescript
const [usePollingFallback, setUsePollingFallback] = useState(false)

// In the subscription error handler
onError: (error: Error) => {
  console.error('Conversation subscription error:', error)
  setError(formatError(error))
  
  // Fall back to polling after repeated failures
  if (!usePollingFallback) {
    console.warn('Falling back to polling due to subscription error')
    setUsePollingFallback(true)
  }
}

// Add polling effect
useEffect(() => {
  if (!usePollingFallback) return
  
  const interval = setInterval(() => {
    fetchInitialConversation()
  }, 1000)
  
  return () => clearInterval(interval)
}, [usePollingFallback, fetchInitialConversation])
```

### Success Criteria:

#### Manual Verification:
- [ ] Rapid tool calls don't cause UI jank
- [ ] Large conversations (100+ events) load smoothly
- [ ] Falls back to polling if subscription fails
- [ ] No duplicate events even with rapid updates
- [ ] Performance remains good with many events

---

## Phase 3: Migration and Feature Flags

### Overview
Add feature flag to gradually roll out the change and allow easy rollback.

### Changes Required:

#### 1. Add Feature Flag
**File**: `humanlayer-wui/src/hooks/useConversation.ts`
**Changes**: Check feature flag for subscription usage

```typescript
// Check localStorage or environment variable
const shouldUseSubscription = (): boolean => {
  // Check localStorage first for dev override
  const override = localStorage.getItem('useConversationSubscription')
  if (override !== null) {
    return override === 'true'
  }
  
  // Default to true (enabled)
  return true
}

export function useConversation(
  sessionId?: string,
  claudeSessionId?: string,
  pollInterval: number = 1000,
  useSubscription: boolean = shouldUseSubscription(),
): UseConversationReturn {
```

#### 2. Add Debug UI for Testing
**File**: `humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx`
**Changes**: Add debug toggle in development

Add debug toggle (only in development):
```typescript
{import.meta.env.DEV && (
  <div className="absolute top-2 right-2 text-xs text-muted-foreground">
    <label className="flex items-center gap-1">
      <input
        type="checkbox"
        checked={localStorage.getItem('useConversationSubscription') !== 'false'}
        onChange={(e) => {
          localStorage.setItem('useConversationSubscription', String(e.target.checked))
          window.location.reload()
        }}
      />
      Real-time
    </label>
  </div>
)}
```

### Success Criteria:

#### Manual Verification:
- [ ] Feature flag correctly enables/disables subscription
- [ ] Debug toggle works in development
- [ ] Easy to switch between polling and subscription
- [ ] No behavior change when flag is off

---

## Testing Strategy

### Manual Testing Steps:
1. Start a Claude Code session
2. Verify initial conversation loads
3. Send messages and verify instant appearance
4. Run multiple tools rapidly
5. Check tool results update immediately
6. Open multiple sessions simultaneously
7. Test with slow/interrupted network
8. Verify memory usage doesn't grow over time
9. Test fallback to polling by breaking subscription

### Edge Cases to Test:
- Very large conversations (1000+ events)
- Rapid tool execution (10+ tools in sequence)
- Multiple browser tabs with same session
- Network disconnection and reconnection
- Session with no events
- Switching between sessions quickly

## Performance Considerations

- Event batching prevents excessive re-renders
- RequestAnimationFrame ensures smooth UI updates
- Deduplication prevents memory growth
- Fallback to polling ensures reliability
- Subscription cleanup prevents memory leaks

## Migration Notes

1. Feature flag allows gradual rollout
2. Polling remains as fallback
3. No changes to event data structure
4. Backward compatible with existing code

## References

- Current polling implementation: useConversation.ts
- Working subscription example: useSubscriptions.ts
- Daemon event types: hld/bus/types.go
- Event publishing: hld/session/manager.go