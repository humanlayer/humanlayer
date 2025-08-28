import { describe, test, expect, beforeEach } from 'bun:test'
import { useStore } from '@/AppStore'

// Mock localStorage
const mockLocalStorage = {
  getItem: (key: string) => mockLocalStorage.data[key] || null,
  setItem: (key: string, value: string) => {
    mockLocalStorage.data[key] = value
  },
  removeItem: (key: string) => {
    delete mockLocalStorage.data[key]
  },
  data: {} as Record<string, string>,
}

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
})

describe('useSessionActions with Zustand Form State', () => {
  beforeEach(() => {
    // Reset store state
    useStore.setState({
      sessionResponses: {},
    })

    // Clear localStorage mock
    mockLocalStorage.data = {}
  })

  test('should initialize session response from localStorage', () => {
    const sessionId = 'session-123'
    const savedInput = 'Saved response from localStorage'

    // Pre-populate localStorage
    mockLocalStorage.setItem(`response-input.${sessionId}`, savedInput)

    const store = useStore.getState()
    const response = store.getSessionResponse(sessionId)

    expect(response.input).toBe(savedInput)
    expect(response.isResponding).toBe(false)
    expect(response.forkFromSessionId).toBeUndefined()
  })

  test('should handle fork message setup', () => {
    const sessionId = 'session-123'
    const forkFromSessionId = 'parent-session-456'
    const forkContent = 'Fork from this message'

    const store = useStore.getState()

    // Simulate fork message selection
    store.setSessionResponse(sessionId, forkContent)
    store.setSessionForkFrom(sessionId, forkFromSessionId)

    const response = store.getSessionResponse(sessionId)
    expect(response.input).toBe(forkContent)
    expect(response.forkFromSessionId).toBe(forkFromSessionId)
    expect(response.isResponding).toBe(false)
  })

  test('should handle session continuation flow', async () => {
    const sessionId = 'session-123'
    const responseInput = 'Continue with this message'

    const store = useStore.getState()

    // Set up initial state
    store.setSessionResponse(sessionId, responseInput)

    // Simulate starting continuation
    store.setSessionResponding(sessionId, true)

    const respondingState = store.getSessionResponse(sessionId)
    expect(respondingState.input).toBe(responseInput)
    expect(respondingState.isResponding).toBe(true)

    // Simulate successful completion - clear response
    store.clearSessionResponse(sessionId)

    const clearedState = store.getSessionResponse(sessionId)
    expect(clearedState.input).toBe('')
    expect(clearedState.isResponding).toBe(false)
    expect(clearedState.forkFromSessionId).toBeUndefined()
  })

  test('should handle error during continuation', () => {
    const sessionId = 'session-123'
    const responseInput = 'Message that will fail'

    const store = useStore.getState()

    // Set up state
    store.setSessionResponse(sessionId, responseInput)
    store.setSessionResponding(sessionId, true)

    // Simulate error - should reset responding state but keep input
    store.setSessionResponding(sessionId, false)

    const errorState = store.getSessionResponse(sessionId)
    expect(errorState.input).toBe(responseInput) // Input preserved for retry
    expect(errorState.isResponding).toBe(false)
  })

  test('should clear fork state after successful fork', () => {
    const sessionId = 'session-123'
    const forkFromSessionId = 'parent-session-456'
    const forkMessage = 'Fork message'

    const store = useStore.getState()

    // Set up fork
    store.setSessionResponse(sessionId, forkMessage)
    store.setSessionForkFrom(sessionId, forkFromSessionId)

    // Verify fork setup
    let state = store.getSessionResponse(sessionId)
    expect(state.forkFromSessionId).toBe(forkFromSessionId)

    // Clear fork after success
    store.setSessionForkFrom(sessionId, null)

    state = store.getSessionResponse(sessionId)
    expect(state.forkFromSessionId).toBeUndefined()
    expect(state.input).toBe(forkMessage) // Input should remain
  })

  test('should sync with localStorage on input changes', () => {
    const sessionId = 'session-123'
    const inputs = ['H', 'He', 'Hel', 'Hell', 'Hello', 'Hello world']

    const store = useStore.getState()

    inputs.forEach(input => {
      store.setSessionResponse(sessionId, input)
      expect(mockLocalStorage.getItem(`response-input.${sessionId}`)).toBe(input)
    })
  })

  test('should clear localStorage when clearing response', () => {
    const sessionId = 'session-123'
    const input = 'Test message'

    const store = useStore.getState()

    // Set response
    store.setSessionResponse(sessionId, input)
    expect(mockLocalStorage.getItem(`response-input.${sessionId}`)).toBe(input)

    // Clear response
    store.clearSessionResponse(sessionId)
    expect(mockLocalStorage.getItem(`response-input.${sessionId}`)).toBeNull()
  })

  test('should handle multiple sessions independently', () => {
    const session1 = 'session-123'
    const session2 = 'session-456'
    const input1 = 'Message for session 1'
    const input2 = 'Message for session 2'

    const store = useStore.getState()

    // Set up different states for each session
    store.setSessionResponse(session1, input1)
    store.setSessionResponse(session2, input2)
    store.setSessionResponding(session1, true)
    store.setSessionForkFrom(session2, 'parent-789')

    // Verify independence
    const state1 = store.getSessionResponse(session1)
    const state2 = store.getSessionResponse(session2)

    expect(state1.input).toBe(input1)
    expect(state1.isResponding).toBe(true)
    expect(state1.forkFromSessionId).toBeUndefined()

    expect(state2.input).toBe(input2)
    expect(state2.isResponding).toBe(false)
    expect(state2.forkFromSessionId).toBe('parent-789')

    // Clear one should not affect the other
    store.clearSessionResponse(session1)

    const cleared1 = store.getSessionResponse(session1)
    const unchanged2 = store.getSessionResponse(session2)

    expect(cleared1.input).toBe('')
    expect(unchanged2.input).toBe(input2) // Should remain unchanged
  })

  test('should handle localStorage unavailability gracefully', () => {
    // Remove localStorage
    const originalLocalStorage = window.localStorage
    delete (window as any).localStorage

    const sessionId = 'session-123'
    const input = 'Test message'

    const store = useStore.getState()

    // Should not throw errors
    expect(() => {
      store.setSessionResponse(sessionId, input)
      store.getSessionResponse(sessionId)
      store.clearSessionResponse(sessionId)
    }).not.toThrow()

    // Restore localStorage
    window.localStorage = originalLocalStorage
  })

  test('should handle rapid state changes', () => {
    const sessionId = 'session-123'
    const store = useStore.getState()

    // Rapid state changes
    for (let i = 0; i < 10; i++) {
      store.setSessionResponse(sessionId, `Message ${i}`)
      store.setSessionResponding(sessionId, i % 2 === 0)
      if (i % 3 === 0) {
        store.setSessionForkFrom(sessionId, `parent-${i}`)
      }
    }

    const finalState = store.getSessionResponse(sessionId)
    expect(finalState.input).toBe('Message 9')
    expect(finalState.isResponding).toBe(false) // 9 % 2 = 1, not 0
    expect(finalState.forkFromSessionId).toBe('parent-9') // Last fork set at i=9
  })

  test('should preserve state during navigation scenarios', () => {
    const sessionId = 'session-123'
    const input = 'Partially typed message'
    const store = useStore.getState()

    // User starts typing
    store.setSessionResponse(sessionId, input)

    // User navigates away (state should persist)
    const stateAfterNav = store.getSessionResponse(sessionId)
    expect(stateAfterNav.input).toBe(input)

    // User navigates back (should restore from localStorage)
    mockLocalStorage.setItem(`response-input.${sessionId}`, input)
    const restoredState = store.getSessionResponse(sessionId)
    expect(restoredState.input).toBe(input)
  })
})

describe('Form State Integration with Session Actions', () => {
  test('should handle complete session continuation workflow', async () => {
    const sessionId = 'session-123'
    const message = 'Continue with this'
    const store = useStore.getState()

    // 1. User types message
    store.setSessionResponse(sessionId, message)

    // 2. User submits (responding starts)
    store.setSessionResponding(sessionId, true)

    // 3. Check state during submission
    let state = store.getSessionResponse(sessionId)
    expect(state.input).toBe(message)
    expect(state.isResponding).toBe(true)

    // 4. Successful completion - clear all state
    store.clearSessionResponse(sessionId)

    // 5. Verify cleanup
    const finalState = store.getSessionResponse(sessionId)
    expect(finalState.input).toBe('')
    expect(finalState.isResponding).toBe(false)
    expect(finalState.forkFromSessionId).toBeUndefined()
  })

  test('should handle fork workflow correctly', () => {
    const sessionId = 'session-123'
    const parentSessionId = 'parent-456'
    const forkMessage = 'Fork from this point'
    const store = useStore.getState()

    // 1. Set up fork (simulating pendingForkMessage effect)
    store.setSessionResponse(sessionId, forkMessage)
    store.setSessionForkFrom(sessionId, parentSessionId)

    // 2. Verify fork mode setup
    let state = store.getSessionResponse(sessionId)
    expect(state.input).toBe(forkMessage)
    expect(state.forkFromSessionId).toBe(parentSessionId)

    // 3. User submits fork
    store.setSessionResponding(sessionId, true)

    // 4. Fork completes - clear fork state
    store.setSessionForkFrom(sessionId, null)
    store.clearSessionResponse(sessionId)

    // 5. Verify cleanup
    const finalState = store.getSessionResponse(sessionId)
    expect(finalState.input).toBe('')
    expect(finalState.isResponding).toBe(false)
    expect(finalState.forkFromSessionId).toBeUndefined()
  })
})
