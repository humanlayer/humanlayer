import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { useStore } from '@/AppStore'
import { createMockSession, createMockSessions } from '@/test-utils'
import { setupStoreWithUIState, uiStateAssertions, uiTestScenarios } from '@/test-utils-ui'
import { ViewMode, SessionStatus } from '@/lib/daemon/types'

/**
 * Behavior Preservation Tests
 *
 * These tests ensure that the migration to a unified store with UI state
 * hasn't broken any existing functionality. They test critical user workflows
 * and state management behaviors to prevent regressions.
 */

// Mock daemon client for testing
const mockDaemonClient = {
  updateSessionSettings: mock(() => Promise.resolve({ success: true })),
  archiveSession: mock(() => Promise.resolve({ success: true })),
  bulkArchiveSessions: mock(() => Promise.resolve({ success: true })),
  getSessionLeaves: mock(() => Promise.resolve({ sessions: [] })),
  updateSessionTitle: mock(() => Promise.resolve({ success: true })),
  interruptSession: mock(() => Promise.resolve({ success: true })),
  getSessionState: mock(() => Promise.resolve({ session: {} })),
  getConversation: mock(() => Promise.resolve([])),
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

describe('Behavior Preservation - Core Session Management', () => {
  beforeEach(() => {
    // Reset to clean state
    setupStoreWithUIState(uiTestScenarios.clean())
    Object.values(mockDaemonClient).forEach(mockFn => mockFn.mockClear())
  })

  describe('Session CRUD Operations', () => {
    test('should preserve session initialization behavior', () => {
      const sessions = createMockSessions(5)
      const store = useStore.getState()

      // Initialize sessions
      store.initSessions(sessions)

      const state = useStore.getState()
      expect(state.sessions).toHaveLength(5)
      expect(state.sessions[0].id).toBe('session-1')
      expect(state.sessions[4].id).toBe('session-5')

      // UI state should remain unaffected
      uiStateAssertions.expectModalStates({ hotkeyPanel: false })
    })

    test('should preserve session update behavior', () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      // Update a session
      const updateData = { title: 'Updated Title', summary: 'Updated Summary' }
      store.updateSession('session-2', updateData)

      const state = useStore.getState()
      const updatedSession = state.sessions.find(s => s.id === 'session-2')
      expect(updatedSession?.title).toBe('Updated Title')
      expect(updatedSession?.summary).toBe('Updated Summary')

      // Other sessions should be unchanged
      expect(state.sessions.find(s => s.id === 'session-1')?.title).not.toBe('Updated Title')
    })

    test('should preserve focused session updates', () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions, [], sessions[1]))

      const store = useStore.getState()

      // Update the focused session
      store.updateSession('session-2', { title: 'New Focused Title' })

      const state = useStore.getState()
      expect(state.focusedSession?.title).toBe('New Focused Title')
      expect(state.focusedSession?.id).toBe('session-2')
    })
  })

  describe('Selection and Focus Management', () => {
    test('should preserve session selection behavior', () => {
      const sessions = createMockSessions(5)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      // Test individual selection
      store.toggleSessionSelection('session-1')
      expect(useStore.getState().selectedSessions.has('session-1')).toBe(true)

      // Test deselection
      store.toggleSessionSelection('session-1')
      expect(useStore.getState().selectedSessions.has('session-1')).toBe(false)

      // Test multiple selections
      store.toggleSessionSelection('session-2')
      store.toggleSessionSelection('session-4')

      const state = useStore.getState()
      expect(state.selectedSessions.size).toBe(2)
      expect(state.selectedSessions.has('session-2')).toBe(true)
      expect(state.selectedSessions.has('session-4')).toBe(true)
    })

    test('should preserve range selection behavior', () => {
      const sessions = createMockSessions(8)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      // Test range selection
      store.selectRange('session-2', 'session-5')

      const state = useStore.getState()
      expect(state.selectedSessions.size).toBe(4) // sessions 2, 3, 4, 5
      expect(state.selectedSessions.has('session-2')).toBe(true)
      expect(state.selectedSessions.has('session-3')).toBe(true)
      expect(state.selectedSessions.has('session-4')).toBe(true)
      expect(state.selectedSessions.has('session-5')).toBe(true)
      expect(state.selectedSessions.has('session-1')).toBe(false)
      expect(state.selectedSessions.has('session-6')).toBe(false)
    })

    test('should preserve focus navigation behavior', () => {
      const sessions = createMockSessions(5)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      // Test focus next
      store.focusNextSession()
      expect(useStore.getState().focusedSession?.id).toBe('session-1')

      store.focusNextSession()
      expect(useStore.getState().focusedSession?.id).toBe('session-2')

      // Test wrap around at end
      store.setFocusedSession(sessions[4]) // Last session
      store.focusNextSession()
      expect(useStore.getState().focusedSession?.id).toBe('session-1') // Should wrap to first

      // Test focus previous
      store.focusPreviousSession()
      expect(useStore.getState().focusedSession?.id).toBe('session-5') // Should wrap to last
    })

    test('should preserve bulk selection behavior', () => {
      const sessions = createMockSessions(5)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      // Test bulk select descending (shift+j behavior)
      store.bulkSelect('session-2', 'desc')

      let state = useStore.getState()
      expect(state.selectedSessions.size).toBe(2)
      expect(state.selectedSessions.has('session-2')).toBe(true)
      expect(state.selectedSessions.has('session-3')).toBe(true)
      expect(state.focusedSession?.id).toBe('session-3')

      // Test bulk select ascending (shift+k behavior)
      store.bulkSelect('session-3', 'asc')

      state = useStore.getState()
      expect(state.selectedSessions.size).toBe(1)
      expect(state.selectedSessions.has('session-2')).toBe(true)
      expect(state.selectedSessions.has('session-3')).toBe(false)
      expect(state.focusedSession?.id).toBe('session-2')
    })
  })

  describe('View Mode and Filtering', () => {
    test('should preserve view mode switching behavior', async () => {
      setupStoreWithUIState(uiTestScenarios.clean())

      const store = useStore.getState()

      // Mock refresh call
      mockDaemonClient.getSessionLeaves.mockResolvedValueOnce({ sessions: [] })

      // Test switching to archived
      store.setViewMode(ViewMode.Archived)

      const state = useStore.getState()
      expect(state.viewMode).toBe(ViewMode.Archived)

      // Should have triggered a refresh
      expect(mockDaemonClient.getSessionLeaves).toHaveBeenCalledWith({
        include_archived: true,
        archived_only: true,
      })
    })

    test('should preserve selection clearing behavior', () => {
      const sessions = createMockSessions(3)
      setupStoreWithUIState(
        uiTestScenarios.withSessionsAndSelections(sessions, ['session-1', 'session-3']),
      )

      const store = useStore.getState()

      // Verify selections exist
      expect(useStore.getState().selectedSessions.size).toBe(2)

      // Clear selection
      store.clearSelection()

      const state = useStore.getState()
      expect(state.selectedSessions.size).toBe(0)
    })
  })

  describe('Session Operations', () => {
    test('should preserve optimistic update behavior', async () => {
      const session = createMockSession({
        id: 'session-1',
        autoAcceptEdits: false,
      })
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections([session]))

      const store = useStore.getState()

      mockDaemonClient.updateSessionSettings.mockResolvedValueOnce({ success: true })

      // Test optimistic update
      const promise = store.updateSessionOptimistic('session-1', { autoAcceptEdits: true })

      // Should immediately update UI
      expect(useStore.getState().sessions[0].autoAcceptEdits).toBe(true)
      expect(useStore.getState().pendingUpdates.has('session-1')).toBe(true)

      // Wait for API call
      await promise

      // Should clear pending state
      const finalState = useStore.getState()
      expect(finalState.sessions[0].autoAcceptEdits).toBe(true)
      expect(finalState.pendingUpdates.has('session-1')).toBe(false)
    })

    test('should preserve optimistic update rollback behavior', async () => {
      const session = createMockSession({
        id: 'session-1',
        autoAcceptEdits: false,
      })
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections([session]))

      const store = useStore.getState()

      mockDaemonClient.updateSessionSettings.mockRejectedValueOnce(new Error('Network error'))

      // Test optimistic update that fails
      try {
        await store.updateSessionOptimistic('session-1', { autoAcceptEdits: true })
      } catch {
        // Expected to fail
      }

      // Should revert to original state
      const finalState = useStore.getState()
      expect(finalState.sessions[0].autoAcceptEdits).toBe(false)
      expect(finalState.pendingUpdates.has('session-1')).toBe(false)
    })

    test('should preserve session status update behavior', () => {
      const sessions = createMockSessions(2)
      sessions[0].status = SessionStatus.Running
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions, [], sessions[0]))

      const store = useStore.getState()

      // Update status
      store.updateSessionStatus('session-1', SessionStatus.Completed)

      const state = useStore.getState()
      expect(state.sessions[0].status).toBe(SessionStatus.Completed)

      // Should also update focused session if it matches
      expect(state.focusedSession?.status).toBe(SessionStatus.Completed)
    })
  })

  describe('Async Operations and State Management', () => {
    test('should preserve refresh behavior with pending updates', async () => {
      const sessions = createMockSessions(2)
      setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

      const store = useStore.getState()

      // Add a pending update (simulate in-flight optimistic update)
      useStore.setState({
        pendingUpdates: new Map([
          [
            'session-1',
            {
              updates: { autoAcceptEdits: true },
              timestamp: Date.now() - 500, // Recent
            },
          ],
        ]),
      })

      // Mock server response without the pending update
      const serverSessions = createMockSessions(2)
      serverSessions[0].autoAcceptEdits = false // Server doesn't have the update yet

      mockDaemonClient.getSessionLeaves.mockResolvedValueOnce({
        sessions: serverSessions as any,
      })

      await store.refreshSessions()

      const state = useStore.getState()

      // Should preserve recent pending update
      expect(state.sessions[0].autoAcceptEdits).toBe(true)
      expect(state.pendingUpdates.has('session-1')).toBe(true)
    })

    test('should preserve concurrent operation prevention', async () => {
      setupStoreWithUIState(uiTestScenarios.clean())

      const store = useStore.getState()

      // Mock slow API call
      mockDaemonClient.getSessionLeaves.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ sessions: [] }), 50)),
      )

      // Start first refresh
      const refresh1 = store.refreshSessions()

      // Try second refresh immediately
      const refresh2 = store.refreshSessions()

      await Promise.all([refresh1, refresh2])

      // Should only call API once due to isRefreshing guard
      expect(mockDaemonClient.getSessionLeaves).toHaveBeenCalledTimes(1)
    })

    test('should preserve isRefreshing flag behavior', async () => {
      setupStoreWithUIState(uiTestScenarios.clean())

      const store = useStore.getState()

      mockDaemonClient.getSessionLeaves.mockResolvedValueOnce({ sessions: [] })

      expect(useStore.getState().isRefreshing).toBe(false)

      const refreshPromise = store.refreshSessions()

      // Should be refreshing during operation
      expect(useStore.getState().isRefreshing).toBe(true)

      await refreshPromise

      // Should clear flag after completion
      expect(useStore.getState().isRefreshing).toBe(false)
    })
  })

  describe('Notification and Tracking Systems', () => {
    test('should preserve notification management behavior', () => {
      setupStoreWithUIState(uiTestScenarios.clean())

      const store = useStore.getState()

      // Add notifications
      store.addNotifiedItem('approval-1')
      store.addNotifiedItem('approval-2')

      let state = useStore.getState()
      expect(state.notifiedItems.size).toBe(2)
      expect(state.isItemNotified('approval-1')).toBe(true)
      expect(state.isItemNotified('approval-2')).toBe(true)

      // Remove notification
      store.removeNotifiedItem('approval-1')

      state = useStore.getState()
      expect(state.notifiedItems.size).toBe(1)
      expect(state.isItemNotified('approval-1')).toBe(false)
      expect(state.isItemNotified('approval-2')).toBe(true)
    })

    test('should preserve session-specific notification clearing', () => {
      setupStoreWithUIState(uiTestScenarios.clean())

      const store = useStore.getState()

      // Add session-specific notifications
      store.addNotifiedItem('session-1-approval-1')
      store.addNotifiedItem('session-1-approval-2')
      store.addNotifiedItem('session-2-approval-1')
      store.addNotifiedItem('global-notification')

      expect(useStore.getState().notifiedItems.size).toBe(4)

      // Clear notifications for session-1
      store.clearNotificationsForSession('session-1')

      const state = useStore.getState()
      expect(state.notifiedItems.size).toBe(2)
      expect(state.isItemNotified('session-1-approval-1')).toBe(false)
      expect(state.isItemNotified('session-1-approval-2')).toBe(false)
      expect(state.isItemNotified('session-2-approval-1')).toBe(true)
      expect(state.isItemNotified('global-notification')).toBe(true)
    })

    test('should preserve navigation tracking behavior', () => {
      setupStoreWithUIState(uiTestScenarios.clean())

      const store = useStore.getState()

      // Track navigation from session
      store.trackNavigationFrom('session-1')

      let state = useStore.getState()
      expect(state.recentNavigations.has('session-1')).toBe(true)
      expect(state.wasRecentlyNavigatedFrom('session-1')).toBe(true)
      expect(state.wasRecentlyNavigatedFrom('session-2')).toBe(false)

      // Test with time window
      expect(state.wasRecentlyNavigatedFrom('session-1', 1000)).toBe(true)
    })
  })
})

describe('Behavior Preservation - UI State Integration', () => {
  beforeEach(() => {
    setupStoreWithUIState(uiTestScenarios.clean())
    Object.values(mockDaemonClient).forEach(mockFn => mockFn.mockClear())
  })

  test('should preserve session operations while UI states are active', async () => {
    const sessions = createMockSessions(3)

    // Set up complex UI state
    setupStoreWithUIState({
      sessions,
      selectedSessions: new Set(['session-1', 'session-2']),
      focusedSession: sessions[1],
      isHotkeyPanelOpen: true,
      editingSessionId: 'session-3',
      editValue: 'Edit Value',
    })

    const store = useStore.getState()

    // Perform session operation
    store.updateSession('session-2', { title: 'Updated While UI Active' })

    const state = useStore.getState()

    // Session should be updated
    expect(state.sessions[1].title).toBe('Updated While UI Active')
    expect(state.focusedSession?.title).toBe('Updated While UI Active')

    // UI states should be preserved
    uiStateAssertions.expectModalStates({ hotkeyPanel: true })
    uiStateAssertions.expectEditingState({ sessionId: 'session-3', value: 'Edit Value' })
    uiStateAssertions.expectSelectionState({
      selectedCount: 2,
      selectedIds: ['session-1', 'session-2'],
    })
  })

  test('should preserve UI state during view mode changes', async () => {
    setupStoreWithUIState({
      isHotkeyPanelOpen: true,
      editingSessionId: 'session-1',
      editValue: 'Edit Value',
      viewMode: ViewMode.Normal,
    })

    const store = useStore.getState()

    mockDaemonClient.getSessionLeaves.mockResolvedValueOnce({ sessions: [] })

    // Change view mode (triggers refresh)
    store.setViewMode(ViewMode.Archived)

    // Wait for async refresh to complete
    await new Promise(resolve => setTimeout(resolve, 0))

    const state = useStore.getState()

    // View mode should change
    expect(state.viewMode).toBe(ViewMode.Archived)

    // All UI states should be preserved
    uiStateAssertions.expectModalStates({ hotkeyPanel: true })
    uiStateAssertions.expectEditingState({ sessionId: 'session-1', value: 'Edit Value' })
  })

  test('should handle edge case: UI operations during session refresh', async () => {
    const sessions = createMockSessions(2)
    setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

    const store = useStore.getState()

    // Start a slow refresh
    mockDaemonClient.getSessionLeaves.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ sessions: sessions as any }), 30)),
    )

    const refreshPromise = store.refreshSessions()

    // Perform UI operations during refresh
    store.setHotkeyPanelOpen(true)
    store.startEdit('session-1', 'Title')
    store.toggleSessionSelection('session-1')

    // Wait for refresh to complete
    await refreshPromise

    // UI operations should have completed successfully
    uiStateAssertions.expectModalStates({ hotkeyPanel: true })
    uiStateAssertions.expectEditingState({ sessionId: 'session-1', value: 'Title' })
    uiStateAssertions.expectSelectionState({ selectedIds: ['session-1'] })
  })
})

describe('Behavior Preservation - Error Handling and Edge Cases', () => {
  beforeEach(() => {
    setupStoreWithUIState(uiTestScenarios.clean())
    Object.values(mockDaemonClient).forEach(mockFn => mockFn.mockClear())
  })

  test('should preserve state integrity during API failures', async () => {
    const sessions = createMockSessions(2)

    setupStoreWithUIState({
      sessions,
      selectedSessions: new Set(['session-1']),
      isHotkeyPanelOpen: true,
      editingSessionId: 'session-2',
      editValue: 'Edit Value',
    })

    const store = useStore.getState()

    // Mock API failure
    mockDaemonClient.updateSessionSettings.mockRejectedValueOnce(new Error('API Error'))

    // Attempt operation that will fail
    try {
      await store.updateSessionOptimistic('session-1', { autoAcceptEdits: true })
    } catch {
      // Expected to fail
    }

    const state = useStore.getState()

    // Session should be reverted
    expect(state.sessions[0].autoAcceptEdits).toBe(false)

    // UI state should be preserved despite API failure
    uiStateAssertions.expectModalStates({ hotkeyPanel: true })
    uiStateAssertions.expectEditingState({ sessionId: 'session-2', value: 'Edit Value' })
    uiStateAssertions.expectSelectionState({ selectedIds: ['session-1'] })
  })

  test('should handle empty state scenarios correctly', () => {
    setupStoreWithUIState(uiTestScenarios.clean())

    const store = useStore.getState()

    // Attempt operations on empty state
    store.focusNextSession() // Should not crash
    store.focusPreviousSession() // Should not crash
    store.selectRange('non-existent-1', 'non-existent-2') // Should not crash
    store.bulkSelect('non-existent', 'desc') // Should not crash

    const state = useStore.getState()

    // State should remain consistent
    expect(state.sessions).toHaveLength(0)
    expect(state.focusedSession).toBe(null)
    expect(state.selectedSessions.size).toBe(0)
  })

  test('should handle rapid state changes correctly', () => {
    const sessions = createMockSessions(5)
    setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

    const store = useStore.getState()

    // Perform rapid state changes
    for (let i = 0; i < 10; i++) {
      store.focusNextSession()
      store.toggleSessionSelection(`session-${(i % 5) + 1}`)
      store.setHotkeyPanelOpen(i % 2 === 0)
    }

    const state = useStore.getState()

    // State should be consistent
    expect(state.focusedSession).toBeDefined()
    expect(state.sessions).toHaveLength(5)
    expect(typeof state.isHotkeyPanelOpen).toBe('boolean')
    expect(state.selectedSessions.size).toBeGreaterThanOrEqual(0)
    expect(state.selectedSessions.size).toBeLessThanOrEqual(5)
  })

  test('should preserve state during concurrent UI and session operations', () => {
    const sessions = createMockSessions(3)
    setupStoreWithUIState(uiTestScenarios.withSessionsAndSelections(sessions))

    const store = useStore.getState()

    // Perform concurrent operations
    store.setHotkeyPanelOpen(true)
    store.updateSession('session-1', { title: 'Concurrent Update' })
    store.startEdit('session-2', 'Title')
    store.toggleSessionSelection('session-3')
    store.setFocusedSession(sessions[1])

    const state = useStore.getState()

    // All operations should complete successfully
    expect(state.sessions[0].title).toBe('Concurrent Update')
    expect(state.focusedSession?.id).toBe('session-2')
    expect(state.selectedSessions.has('session-3')).toBe(true)

    uiStateAssertions.expectModalStates({ hotkeyPanel: true })
    uiStateAssertions.expectEditingState({
      sessionId: 'session-2',
      value: 'Title',
    })
  })

  test('should handle state reset scenarios correctly', () => {
    // Set up complex state
    const sessions = createMockSessions(3)
    setupStoreWithUIState({
      sessions,
      selectedSessions: new Set(['session-1', 'session-2']),
      focusedSession: sessions[1],
      isHotkeyPanelOpen: true,
      editingSessionId: 'session-3',
      editValue: 'Edit Value',
    })

    // Verify complex state is set
    let state = useStore.getState()
    expect(state.sessions).toHaveLength(3)
    expect(state.selectedSessions.size).toBe(2)
    expect(state.isHotkeyPanelOpen).toBe(true)

    // Reset to clean state
    setupStoreWithUIState(uiTestScenarios.clean())

    // Verify clean reset
    state = useStore.getState()
    expect(state.sessions).toHaveLength(0)
    expect(state.selectedSessions.size).toBe(0)
    expect(state.focusedSession).toBe(null)
    expect(state.isHotkeyPanelOpen).toBe(false)
    expect(state.editingSessionId).toBe(null)
    expect(state.editValue).toBe('')
  })
})
