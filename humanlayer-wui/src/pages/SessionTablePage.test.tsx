import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { useStore } from '@/AppStore'
import { createMockSessions } from '@/test-utils'
import { setupStoreWithUIState, uiStateAssertions, uiTestScenarios } from '@/test-utils-ui'
import { ViewMode, SessionStatus } from '@/lib/daemon/types'

// Mock daemon client
const mockDaemonClient = {
  getSessionLeaves: mock(() => Promise.resolve({ sessions: [] })),
  bulkSetAutoAcceptEdits: mock(() => Promise.resolve({ success: true })),
  updateSessionSettings: mock(() => Promise.resolve({ success: true })),
}

mock.module('@/lib/daemon/client', () => ({
  daemonClient: mockDaemonClient,
}))

mock.module('@/lib/logging', () => ({
  logger: {
    log: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  },
}))

describe('SessionTablePage - Store Integration', () => {
  beforeEach(() => {
    setupStoreWithUIState(uiTestScenarios.clean())
    Object.values(mockDaemonClient).forEach(mockFn => mockFn.mockClear())
  })

  describe('Session Display Integration', () => {
    test('should handle session data from store', () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const state = useStore.getState()
      expect(state.sessions).toHaveLength(3)
      expect(state.sessions[0].id).toBe('session-1')
    })

    test('should handle focused session changes', () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions, [], sessions[1]))

      const state = useStore.getState()
      expect(state.focusedSession?.id).toBe('session-2')

      useStore.getState().setFocusedSession(sessions[2])
      expect(useStore.getState().focusedSession?.id).toBe('session-3')
    })

    test('should handle session selection changes', () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      store.toggleSessionSelection(sessions[0].id)
      uiStateAssertions.expectSelectionState({ selectedIds: ['session-1'] })

      store.toggleSessionSelection(sessions[0].id)
      uiStateAssertions.expectSelectionState({ selectedCount: 0 })
    })
  })

  describe('Navigation Integration', () => {
    test('should handle focus navigation', () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      store.focusNextSession()
      uiStateAssertions.expectSelectionState({ focusedSessionId: 'session-1' })

      store.focusNextSession()
      uiStateAssertions.expectSelectionState({ focusedSessionId: 'session-2' })
    })

    test('should handle focus navigation wrap-around', () => {
      const sessions = createMockSessions(2)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions, [], sessions[1]))

      const store = useStore.getState()

      store.focusNextSession()
      uiStateAssertions.expectSelectionState({ focusedSessionId: 'session-1' })
    })
  })

  describe('View Mode Integration', () => {
    test('should handle view mode changes', () => {
      setupStoreWithUIState(uiTestScenarios.clean())

      const store = useStore.getState()

      uiStateAssertions.expectViewMode(ViewMode.Normal)

      mockDaemonClient.getSessionLeaves.mockResolvedValueOnce({ sessions: [] })
      store.setViewMode(ViewMode.Archived)

      uiStateAssertions.expectViewMode(ViewMode.Archived)
    })
  })

  describe('Session Operations Integration', () => {
    test('should handle bulk operations', async () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(
        uiTestScenarios.withSessionsAndSelections(sessions, ['session-1', 'session-2']),
      )

      const store = useStore.getState()

      mockDaemonClient.bulkSetAutoAcceptEdits.mockResolvedValueOnce({ success: true })

      await store.bulkSetAutoAcceptEdits(['session-1', 'session-2'], true)

      const state = useStore.getState()
      expect(state.sessions.find(s => s.id === 'session-1')?.autoAcceptEdits).toBe(true)
      expect(state.sessions.find(s => s.id === 'session-2')?.autoAcceptEdits).toBe(true)
      expect(state.selectedSessions.size).toBe(0) // Cleared after bulk operation
    })

    test('should handle selection clearing', () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(
        uiTestScenarios.withSessionsAndSelections(sessions, ['session-1', 'session-3']),
      )

      expect(useStore.getState().selectedSessions.size).toBe(2)

      useStore.getState().clearSelection()
      uiStateAssertions.expectSelectionState({ selectedCount: 0 })
    })
  })

  describe('Real-time Updates Integration', () => {
    test('should respond to session updates', () => {
      const sessions = createMockSessions(2)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      const updatedSummary = 'Updated Session Summary'
      store.updateSession(sessions[0].id, { summary: updatedSummary })

      const state = useStore.getState()
      expect(state.sessions[0].summary).toBe(updatedSummary)
    })

    test('should respond to session status changes', () => {
      const sessions = createMockSessions(1)
      sessions[0].status = SessionStatus.Running
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      store.updateSessionStatus(sessions[0].id, SessionStatus.Completed)

      const state = useStore.getState()
      expect(state.sessions[0].status).toBe(SessionStatus.Completed)
    })
  })
})
