import { describe, test, expect, beforeEach } from 'bun:test'
import { useStore } from '@/AppStore'

// Mock localStorage for testing
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

// Mock window.localStorage
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
})

describe('Form State Management', () => {
  beforeEach(() => {
    // Reset store state
    useStore.setState({
      sessionResponses: {},
      approvalDenials: {},
    })

    // Clear localStorage mock
    mockLocalStorage.data = {}
  })

  describe('Session Response State', () => {
    test('should initialize empty response state', () => {
      const store = useStore.getState()
      expect(store.sessionResponses).toEqual({})
    })

    test('should set session response input', () => {
      const store = useStore.getState()
      const sessionId = 'session-123'
      const input = 'Test response'

      store.setSessionResponse(sessionId, input)

      const response = store.getSessionResponse(sessionId)
      expect(response.input).toBe(input)
      expect(response.isResponding).toBe(false)
      expect(response.forkFromSessionId).toBeUndefined()
    })

    test('should persist session response to localStorage', () => {
      const store = useStore.getState()
      const sessionId = 'session-123'
      const input = 'Test response'

      store.setSessionResponse(sessionId, input)

      expect(mockLocalStorage.getItem(`response-input.${sessionId}`)).toBe(input)
    })

    test('should set session responding state', () => {
      const store = useStore.getState()
      const sessionId = 'session-123'

      store.setSessionResponding(sessionId, true)

      const response = store.getSessionResponse(sessionId)
      expect(response.isResponding).toBe(true)
      expect(response.input).toBe('') // Should initialize empty input
    })

    test('should set fork from session ID', () => {
      const store = useStore.getState()
      const sessionId = 'session-123'
      const forkFromSessionId = 'parent-session-456'

      store.setSessionForkFrom(sessionId, forkFromSessionId)

      const response = store.getSessionResponse(sessionId)
      expect(response.forkFromSessionId).toBe(forkFromSessionId)
    })

    test('should clear fork from session ID when set to null', () => {
      const store = useStore.getState()
      const sessionId = 'session-123'

      // Set fork first
      store.setSessionForkFrom(sessionId, 'parent-session-456')
      expect(store.getSessionResponse(sessionId).forkFromSessionId).toBe('parent-session-456')

      // Clear fork
      store.setSessionForkFrom(sessionId, null)
      expect(store.getSessionResponse(sessionId).forkFromSessionId).toBeUndefined()
    })

    test('should clear session response', () => {
      const store = useStore.getState()
      const sessionId = 'session-123'

      // Set up some state
      store.setSessionResponse(sessionId, 'Test input')
      store.setSessionResponding(sessionId, true)
      store.setSessionForkFrom(sessionId, 'parent-456')

      // Clear response
      store.clearSessionResponse(sessionId)

      const response = store.getSessionResponse(sessionId)
      expect(response.input).toBe('')
      expect(response.isResponding).toBe(false)
      expect(response.forkFromSessionId).toBeUndefined()

      // Should clear localStorage too
      expect(mockLocalStorage.getItem(`response-input.${sessionId}`)).toBeNull()
    })

    test('should initialize from localStorage when getting session response', () => {
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

    test('should maintain state across multiple session IDs', () => {
      const store = useStore.getState()
      const sessionId1 = 'session-123'
      const sessionId2 = 'session-456'

      store.setSessionResponse(sessionId1, 'Response 1')
      store.setSessionResponse(sessionId2, 'Response 2')
      store.setSessionResponding(sessionId1, true)
      store.setSessionForkFrom(sessionId2, 'parent-789')

      const response1 = store.getSessionResponse(sessionId1)
      const response2 = store.getSessionResponse(sessionId2)

      expect(response1.input).toBe('Response 1')
      expect(response1.isResponding).toBe(true)
      expect(response1.forkFromSessionId).toBeUndefined()

      expect(response2.input).toBe('Response 2')
      expect(response2.isResponding).toBe(false)
      expect(response2.forkFromSessionId).toBe('parent-789')
    })
  })

  describe('Approval Denial State', () => {
    test('should initialize empty approval denial state', () => {
      const store = useStore.getState()
      expect(store.approvalDenials).toEqual({})
    })

    test('should set approval denial reason', () => {
      const store = useStore.getState()
      const approvalId = 'approval-123'
      const reason = 'Security concern'

      store.setApprovalDenialReason(approvalId, reason)

      const denial = store.getApprovalDenial(approvalId)
      expect(denial.reason).toBe(reason)
      expect(denial.isDenying).toBe(false)
    })

    test('should set approval denying state', () => {
      const store = useStore.getState()
      const approvalId = 'approval-123'

      store.setApprovalDenying(approvalId, true)

      const denial = store.getApprovalDenial(approvalId)
      expect(denial.isDenying).toBe(true)
      expect(denial.reason).toBe('') // Should initialize empty reason
    })

    test('should clear approval denial', () => {
      const store = useStore.getState()
      const approvalId = 'approval-123'

      // Set up some state
      store.setApprovalDenialReason(approvalId, 'Test reason')
      store.setApprovalDenying(approvalId, true)

      // Clear denial
      store.clearApprovalDenial(approvalId)

      const denial = store.getApprovalDenial(approvalId)
      expect(denial.reason).toBe('')
      expect(denial.isDenying).toBe(false)
    })

    test('should return default state for non-existent approval', () => {
      const store = useStore.getState()
      const approvalId = 'non-existent-approval'

      const denial = store.getApprovalDenial(approvalId)
      expect(denial.reason).toBe('')
      expect(denial.isDenying).toBe(false)
    })

    test('should maintain state across multiple approval IDs', () => {
      const store = useStore.getState()
      const approvalId1 = 'approval-123'
      const approvalId2 = 'approval-456'

      store.setApprovalDenialReason(approvalId1, 'Reason 1')
      store.setApprovalDenialReason(approvalId2, 'Reason 2')
      store.setApprovalDenying(approvalId1, true)

      const denial1 = store.getApprovalDenial(approvalId1)
      const denial2 = store.getApprovalDenial(approvalId2)

      expect(denial1.reason).toBe('Reason 1')
      expect(denial1.isDenying).toBe(true)

      expect(denial2.reason).toBe('Reason 2')
      expect(denial2.isDenying).toBe(false)
    })
  })

  describe('Integration Tests', () => {
    test('should handle complex form state scenarios', () => {
      const store = useStore.getState()

      // Multiple sessions with responses
      store.setSessionResponse('session-1', 'Continue this session')
      store.setSessionResponse('session-2', 'Fork from here')
      store.setSessionForkFrom('session-2', 'session-1')
      store.setSessionResponding('session-1', true)

      // Multiple approvals being denied
      store.setApprovalDenialReason('approval-1', 'Security issue')
      store.setApprovalDenialReason('approval-2', 'Policy violation')
      store.setApprovalDenying('approval-1', true)

      // Verify all states are maintained correctly
      const response1 = store.getSessionResponse('session-1')
      const response2 = store.getSessionResponse('session-2')
      const denial1 = store.getApprovalDenial('approval-1')
      const denial2 = store.getApprovalDenial('approval-2')

      expect(response1.input).toBe('Continue this session')
      expect(response1.isResponding).toBe(true)
      expect(response1.forkFromSessionId).toBeUndefined()

      expect(response2.input).toBe('Fork from here')
      expect(response2.isResponding).toBe(false)
      expect(response2.forkFromSessionId).toBe('session-1')

      expect(denial1.reason).toBe('Security issue')
      expect(denial1.isDenying).toBe(true)

      expect(denial2.reason).toBe('Policy violation')
      expect(denial2.isDenying).toBe(false)
    })

    test('should handle state cleanup after operations', () => {
      const store = useStore.getState()
      const sessionId = 'session-123'
      const approvalId = 'approval-456'

      // Set up initial state
      store.setSessionResponse(sessionId, 'Test message')
      store.setSessionResponding(sessionId, true)
      store.setApprovalDenialReason(approvalId, 'Test reason')
      store.setApprovalDenying(approvalId, true)

      // Simulate completion - clear form states
      store.clearSessionResponse(sessionId)
      store.clearApprovalDenial(approvalId)

      // Verify cleanup
      const response = store.getSessionResponse(sessionId)
      const denial = store.getApprovalDenial(approvalId)

      expect(response.input).toBe('')
      expect(response.isResponding).toBe(false)
      expect(response.forkFromSessionId).toBeUndefined()

      expect(denial.reason).toBe('')
      expect(denial.isDenying).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    test('should handle empty string inputs gracefully', () => {
      const store = useStore.getState()

      store.setSessionResponse('session-123', '')
      store.setApprovalDenialReason('approval-123', '')

      const response = store.getSessionResponse('session-123')
      const denial = store.getApprovalDenial('approval-123')

      expect(response.input).toBe('')
      expect(denial.reason).toBe('')
    })

    test('should handle localStorage unavailability', () => {
      // Temporarily remove localStorage
      const originalLocalStorage = window.localStorage
      delete (window as any).localStorage

      const store = useStore.getState()

      // Should not throw error when localStorage is unavailable
      expect(() => {
        store.setSessionResponse('session-123', 'test')
        store.getSessionResponse('session-123')
        store.clearSessionResponse('session-123')
      }).not.toThrow()

      // Restore localStorage
      window.localStorage = originalLocalStorage
    })

    test('should handle rapid state updates', () => {
      const store = useStore.getState()
      const sessionId = 'session-123'

      // Rapid updates
      for (let i = 0; i < 10; i++) {
        store.setSessionResponse(sessionId, `Message ${i}`)
        store.setSessionResponding(sessionId, i % 2 === 0)
      }

      const response = store.getSessionResponse(sessionId)
      expect(response.input).toBe('Message 9')
      expect(response.isResponding).toBe(false) // Last update was i=9, 9%2=1=false
    })
  })
})
