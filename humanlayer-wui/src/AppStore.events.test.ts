import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { useStore } from './AppStore'
import { SessionStatus } from '@/lib/daemon/types'
import type { ConversationEvent } from '@/lib/daemon/types'
import { createMockSession } from './test-utils'

// Mock the daemon client
const mockGetConversation = mock(() => Promise.resolve([] as ConversationEvent[]))
const mockDaemonClient = {
  getConversation: mockGetConversation,
}

// Mock the module
mock.module('@/lib/daemon', () => ({
  daemonClient: mockDaemonClient,
}))

// Mock logger to avoid console noise
mock.module('@/lib/logging', () => ({
  logger: {
    log: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  },
}))

describe('AppStore - Event Handling', () => {
  beforeEach(() => {
    // Reset store
    const store = useStore.getState()
    store.initSessions([])
    store.clearSelection()
    store.clearActiveSessionDetail()

    // Reset mocks
    mockGetConversation.mockReset()
  })

  describe('Session Status Changes', () => {
    test('should update session status in all relevant places', () => {
      const store = useStore.getState()
      const session = createMockSession({
        id: 'test-session-1',
        status: SessionStatus.Running,
      })

      // Initialize with session
      store.initSessions([session])
      store.setFocusedSession(session)
      store.setActiveSessionDetail('test-session-1', session, [])

      // Update status
      store.updateSessionStatus('test-session-1', SessionStatus.WaitingInput)

      // Verify all three places are updated
      const state = useStore.getState()
      expect(state.sessions[0].status).toBe(SessionStatus.WaitingInput)
      expect(state.focusedSession?.status).toBe(SessionStatus.WaitingInput)
      expect(state.activeSessionDetail?.session.status).toBe(SessionStatus.WaitingInput)
    })

    test('should handle status update for non-existent session', () => {
      const store = useStore.getState()

      // Update status for session that doesn't exist
      store.updateSessionStatus('non-existent', SessionStatus.Completed)

      // Should not crash, sessions should remain empty
      expect(store.sessions).toHaveLength(0)
    })
  })

  describe('refreshActiveSessionConversation', () => {
    test('should fetch and update conversation for active session', async () => {
      const store = useStore.getState()
      const session = createMockSession({ id: 'test-session-1' })

      // Set as active session
      store.setActiveSessionDetail('test-session-1', session, [])

      // Mock conversation response
      const mockConversation: ConversationEvent[] = [
        {
          id: 1,
          sessionId: 'test-session-1',
          sequence: 1,
          eventType: 'message',
          createdAt: new Date(),
          role: 'user',
          content: 'Test message',
        },
        {
          id: 2,
          sessionId: 'test-session-1',
          sequence: 2,
          eventType: 'tool_call',
          createdAt: new Date(),
          toolId: 'tool-1',
          toolName: 'read',
          approvalStatus: 'approved',
        },
      ]
      mockGetConversation.mockResolvedValueOnce(mockConversation)

      // Refresh conversation
      await store.refreshActiveSessionConversation('test-session-1')

      // Verify
      expect(mockGetConversation).toHaveBeenCalledWith({ session_id: 'test-session-1' })

      // Get updated state
      const updatedState = useStore.getState()
      expect(updatedState.activeSessionDetail?.conversation).toEqual(mockConversation)
    })

    test('should not fetch if session is not the active one', async () => {
      const store = useStore.getState()
      const session1 = createMockSession({ id: 'session-1' })

      // Set session-1 as active
      store.setActiveSessionDetail('session-1', session1, [])

      // Try to refresh session-2
      await store.refreshActiveSessionConversation('session-2')

      // Should not call getConversation
      expect(mockGetConversation).not.toHaveBeenCalled()
    })

    test('should handle errors gracefully', async () => {
      const store = useStore.getState()
      const session = createMockSession({ id: 'test-session-1' })
      const originalConversation: ConversationEvent[] = [
        {
          id: 1,
          sessionId: 'test-session-1',
          sequence: 1,
          eventType: 'message',
          createdAt: new Date(),
          role: 'user',
          content: 'Original',
        },
      ]

      store.setActiveSessionDetail('test-session-1', session, originalConversation)

      // Mock error
      mockGetConversation.mockRejectedValueOnce(new Error('Network error'))

      // Should not throw - the key behavior we're testing
      await expect(store.refreshActiveSessionConversation('test-session-1')).resolves.toBeUndefined()

      // Conversation should remain unchanged - critical behavior
      const finalState = useStore.getState()
      expect(finalState.activeSessionDetail?.conversation).toEqual(originalConversation)
    })
  })

  describe('Event-driven workflows', () => {
    test('new approval workflow: status change + conversation refresh', async () => {
      const store = useStore.getState()
      const session = createMockSession({
        id: 'test-session-1',
        status: SessionStatus.Running,
      })

      // Setup
      store.initSessions([session])
      store.setActiveSessionDetail('test-session-1', session, [])

      // Mock conversation with new approval
      const approvalConversation: ConversationEvent[] = [
        {
          id: 1,
          sessionId: 'test-session-1',
          sequence: 1,
          eventType: 'tool_call',
          createdAt: new Date(),
          toolId: 'approval-1',
          toolName: 'test_tool',
          approvalStatus: 'pending',
        },
      ]
      mockGetConversation.mockResolvedValueOnce(approvalConversation)

      // Simulate new approval event flow
      store.updateSessionStatus('test-session-1', SessionStatus.WaitingInput)
      await store.refreshActiveSessionConversation('test-session-1')

      // Verify final state
      const state = useStore.getState()
      expect(state.sessions[0].status).toBe(SessionStatus.WaitingInput)
      expect(state.activeSessionDetail?.session.status).toBe(SessionStatus.WaitingInput)
      expect(state.activeSessionDetail?.conversation).toEqual(approvalConversation)
    })

    test('approval resolved workflow: status change + conversation refresh', async () => {
      const store = useStore.getState()
      const session = createMockSession({
        id: 'test-session-1',
        status: SessionStatus.WaitingInput,
      })

      // Setup with pending approval
      const pendingApproval: ConversationEvent[] = [
        {
          id: 1,
          sessionId: 'test-session-1',
          sequence: 1,
          eventType: 'tool_call',
          createdAt: new Date(),
          toolId: 'approval-1',
          toolName: 'test_tool',
          approvalStatus: 'pending',
        },
      ]
      store.initSessions([session])
      store.setActiveSessionDetail('test-session-1', session, pendingApproval)

      // Mock conversation with resolved approval
      const resolvedConversation: ConversationEvent[] = [
        {
          id: 1,
          sessionId: 'test-session-1',
          sequence: 1,
          eventType: 'tool_call',
          createdAt: new Date(),
          toolId: 'approval-1',
          toolName: 'test_tool',
          approvalStatus: 'approved',
        },
        {
          id: 2,
          sessionId: 'test-session-1',
          sequence: 2,
          eventType: 'message',
          createdAt: new Date(),
          role: 'assistant',
          content: 'Continuing execution...',
        },
      ]
      mockGetConversation.mockResolvedValueOnce(resolvedConversation)

      // Simulate approval resolved event flow
      store.updateSessionStatus('test-session-1', SessionStatus.Running)
      await store.refreshActiveSessionConversation('test-session-1')

      // Verify final state
      const state = useStore.getState()
      expect(state.sessions[0].status).toBe(SessionStatus.Running)
      expect(state.activeSessionDetail?.session.status).toBe(SessionStatus.Running)
      expect(state.activeSessionDetail?.conversation).toEqual(resolvedConversation)
    })

    test('multiple approvals in sequence', async () => {
      const store = useStore.getState()
      const session = createMockSession({
        id: 'test-session-1',
        status: SessionStatus.Running,
      })

      store.initSessions([session])
      store.setActiveSessionDetail('test-session-1', session, [])

      // First approval
      mockGetConversation.mockResolvedValueOnce([
        {
          id: 1,
          sessionId: 'test-session-1',
          sequence: 1,
          eventType: 'tool_call',
          createdAt: new Date(),
          toolId: 'approval-1',
          toolName: 'test_tool',
          approvalStatus: 'pending',
        },
      ])

      store.updateSessionStatus('test-session-1', SessionStatus.WaitingInput)
      await store.refreshActiveSessionConversation('test-session-1')

      const state1 = useStore.getState()
      expect(state1.activeSessionDetail?.session.status).toBe(SessionStatus.WaitingInput)

      // Resolve first approval
      mockGetConversation.mockResolvedValueOnce([
        {
          id: 1,
          sessionId: 'test-session-1',
          sequence: 1,
          eventType: 'tool_call',
          createdAt: new Date(),
          toolId: 'approval-1',
          toolName: 'test_tool',
          approvalStatus: 'approved',
        },
      ])

      store.updateSessionStatus('test-session-1', SessionStatus.Running)
      await store.refreshActiveSessionConversation('test-session-1')

      const state2 = useStore.getState()
      expect(state2.activeSessionDetail?.session.status).toBe(SessionStatus.Running)

      // Second approval
      mockGetConversation.mockResolvedValueOnce([
        {
          id: 1,
          sessionId: 'test-session-1',
          sequence: 1,
          eventType: 'tool_call',
          createdAt: new Date(),
          toolId: 'approval-1',
          toolName: 'test_tool',
          approvalStatus: 'approved',
        },
        {
          id: 2,
          sessionId: 'test-session-1',
          sequence: 2,
          eventType: 'tool_call',
          createdAt: new Date(),
          toolId: 'approval-2',
          toolName: 'test_tool_2',
          approvalStatus: 'pending',
        },
      ])

      store.updateSessionStatus('test-session-1', SessionStatus.WaitingInput)
      await store.refreshActiveSessionConversation('test-session-1')

      const state3 = useStore.getState()
      expect(state3.activeSessionDetail?.session.status).toBe(SessionStatus.WaitingInput)
      expect(mockGetConversation).toHaveBeenCalledTimes(3)
    })
  })

  describe('Edge cases', () => {
    test('should handle rapid status changes', async () => {
      const store = useStore.getState()
      const session = createMockSession({ id: 'test-session-1' })

      store.initSessions([session])
      store.setActiveSessionDetail('test-session-1', session, [])

      // Mock delayed response
      mockGetConversation.mockImplementation(
        () => new Promise<ConversationEvent[]>(resolve => setTimeout(() => resolve([]), 100)),
      )

      // Rapid status changes
      store.updateSessionStatus('test-session-1', SessionStatus.WaitingInput)
      store.updateSessionStatus('test-session-1', SessionStatus.Running)
      store.updateSessionStatus('test-session-1', SessionStatus.Completed)

      // Final status should be Completed
      const finalState = useStore.getState()
      expect(finalState.sessions[0].status).toBe(SessionStatus.Completed)
      expect(finalState.activeSessionDetail?.session.status).toBe(SessionStatus.Completed)
    })

    test('should handle activeSessionDetail being null', async () => {
      const store = useStore.getState()

      // No active session detail
      expect(store.activeSessionDetail).toBeNull()

      // Should not throw
      await store.refreshActiveSessionConversation('any-session')

      // Should not call getConversation
      expect(mockGetConversation).not.toHaveBeenCalled()
    })
  })
})
