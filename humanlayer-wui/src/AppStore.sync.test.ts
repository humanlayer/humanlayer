import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { useStore } from './AppStore'
import { createMockSession } from '@/test-utils'
import { ViewMode } from '@/lib/daemon/types'

// Create mock functions with proper typing
const mockGetSessionLeaves = mock(() => Promise.resolve({ sessions: [] as any[] }))
const mockUpdateSessionSettings = mock(() => Promise.resolve({ success: true }))

// Mock the daemon client module
mock.module('@/lib/daemon/client', () => ({
  daemonClient: {
    getSessionLeaves: mockGetSessionLeaves,
    updateSessionSettings: mockUpdateSessionSettings,
  },
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

describe('AppStore - State Synchronization', () => {
  beforeEach(() => {
    // Reset store to initial state
    useStore.setState({
      sessions: [],
      focusedSession: null,
      viewMode: ViewMode.Normal,
      selectedSessions: new Set(),
      pendingUpdates: new Map(),
      isRefreshing: false,
      activeSessionDetail: null,
    })

    // Clear all mocks
    mockGetSessionLeaves.mockClear()
    mockUpdateSessionSettings.mockClear()
  })

  afterEach(() => {
    // Clean up any timers
  })

  describe('optimistic updates', () => {
    test('should apply updates optimistically and track as pending', async () => {
      const session = createMockSession({ id: 'test-1' })
      useStore.setState({ sessions: [session] })

      // Mock successful API call
      mockUpdateSessionSettings.mockResolvedValueOnce({ success: true })

      // Apply optimistic update
      const promise = useStore.getState().updateSessionOptimistic('test-1', {
        autoAcceptEdits: true,
        dangerouslySkipPermissions: true,
      })

      // Check immediate state update
      const stateAfterOptimistic = useStore.getState()
      expect(stateAfterOptimistic.sessions[0].autoAcceptEdits).toBe(true)
      expect(stateAfterOptimistic.sessions[0].dangerouslySkipPermissions).toBe(true)
      expect(stateAfterOptimistic.pendingUpdates.has('test-1')).toBe(true)

      // Wait for API call to complete
      await promise

      // Check pending update is cleared after success
      const stateAfterSuccess = useStore.getState()
      expect(stateAfterSuccess.sessions[0].autoAcceptEdits).toBe(true)
      expect(stateAfterSuccess.sessions[0].dangerouslySkipPermissions).toBe(true)
      expect(stateAfterSuccess.pendingUpdates.has('test-1')).toBe(false)
    })

    test('should revert optimistic updates on API failure', async () => {
      const session = createMockSession({
        id: 'test-1',
        autoAcceptEdits: false,
        dangerouslySkipPermissions: false,
      })
      useStore.setState({ sessions: [session] })

      // Mock API failure
      mockUpdateSessionSettings.mockRejectedValueOnce(new Error('Network error'))

      // Apply optimistic update
      try {
        await useStore.getState().updateSessionOptimistic('test-1', {
          autoAcceptEdits: true,
          dangerouslySkipPermissions: true,
        })
      } catch {
        // Expected to throw
      }

      // Check state is reverted after failure
      const stateAfterFailure = useStore.getState()
      expect(stateAfterFailure.sessions[0].autoAcceptEdits).toBe(false)
      expect(stateAfterFailure.sessions[0].dangerouslySkipPermissions).toBe(false)
      expect(stateAfterFailure.pendingUpdates.has('test-1')).toBe(false)
    })

    test('should transform field names correctly for API calls', async () => {
      const session = createMockSession({ id: 'test-1' })
      useStore.setState({ sessions: [session] })

      mockUpdateSessionSettings.mockResolvedValueOnce({ success: true })

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
      await useStore.getState().updateSessionOptimistic('test-1', {
        autoAcceptEdits: true,
        dangerouslySkipPermissions: true,
        dangerouslySkipPermissionsExpiresAt: expiresAt,
      })

      // Check API was called with correct field names
      expect(mockUpdateSessionSettings).toHaveBeenCalledWith('test-1', {
        auto_accept_edits: true,
        dangerously_skip_permissions: true,
        dangerously_skip_permissions_timeout_ms: expect.any(Number),
      })
    })
  })

  describe('refreshSessions - server as source of truth', () => {
    test('should use server data as source of truth', async () => {
      // Set up initial local state with modifications
      const localSession = createMockSession({
        id: 'test-1',
        autoAcceptEdits: true,
        dangerouslySkipPermissions: true,
      })
      useStore.setState({ sessions: [localSession] })

      // Mock server response with different values
      const serverSession = createMockSession({
        id: 'test-1',
        autoAcceptEdits: false,
        dangerouslySkipPermissions: false,
      })
      mockGetSessionLeaves.mockResolvedValueOnce({
        sessions: [serverSession] as any,
      })

      // Refresh sessions
      await useStore.getState().refreshSessions()

      // Should use server values, not local
      const state = useStore.getState()
      expect(state.sessions[0].autoAcceptEdits).toBe(false)
      expect(state.sessions[0].dangerouslySkipPermissions).toBe(false)
    })

    test('should preserve recent pending updates during refresh', async () => {
      const session = createMockSession({ id: 'test-1' })
      useStore.setState({ sessions: [session] })

      // Add a pending update (simulating an in-flight update)
      const pendingUpdate = {
        updates: { autoAcceptEdits: true },
        timestamp: Date.now() - 500, // 500ms ago - still recent
      }
      useStore.setState({
        pendingUpdates: new Map([['test-1', pendingUpdate]]),
      })

      // Mock server response
      const serverSession = createMockSession({
        id: 'test-1',
        autoAcceptEdits: false, // Server doesn't have the update yet
      })
      mockGetSessionLeaves.mockResolvedValueOnce({
        sessions: [serverSession] as any,
      })

      // Refresh sessions
      await useStore.getState().refreshSessions()

      // Should preserve the pending update
      const state = useStore.getState()
      expect(state.sessions[0].autoAcceptEdits).toBe(true)
      expect(state.pendingUpdates.has('test-1')).toBe(true)
    })

    test('should discard old pending updates during refresh', async () => {
      const session = createMockSession({ id: 'test-1' })
      useStore.setState({ sessions: [session] })

      // Add an old pending update
      const oldPendingUpdate = {
        updates: { autoAcceptEdits: true },
        timestamp: Date.now() - 3000, // 3 seconds ago - too old
      }
      useStore.setState({
        pendingUpdates: new Map([['test-1', oldPendingUpdate]]),
      })

      // Mock server response
      const serverSession = createMockSession({
        id: 'test-1',
        autoAcceptEdits: false,
      })
      mockGetSessionLeaves.mockResolvedValueOnce({
        sessions: [serverSession] as any,
      })

      // Refresh sessions
      await useStore.getState().refreshSessions()

      // Should NOT preserve the old update
      const state = useStore.getState()
      expect(state.sessions[0].autoAcceptEdits).toBe(false)
      expect(state.pendingUpdates.has('test-1')).toBe(false)
    })

    test('should prevent concurrent refreshes', async () => {
      mockGetSessionLeaves.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ sessions: [] }), 100)),
      )

      // Start first refresh
      const refresh1 = useStore.getState().refreshSessions()

      // Try to start second refresh immediately
      const refresh2 = useStore.getState().refreshSessions()

      await Promise.all([refresh1, refresh2])

      // Should only call API once
      expect(mockGetSessionLeaves).toHaveBeenCalledTimes(1)
    })

    test('should set isRefreshing flag correctly', async () => {
      mockGetSessionLeaves.mockResolvedValueOnce({ sessions: [] })

      expect(useStore.getState().isRefreshing).toBe(false)

      const refreshPromise = useStore.getState().refreshSessions()

      // Should be refreshing immediately
      expect(useStore.getState().isRefreshing).toBe(true)

      await refreshPromise

      // Should clear flag after completion
      expect(useStore.getState().isRefreshing).toBe(false)
    })

    test('should clear isRefreshing flag on error', async () => {
      mockGetSessionLeaves.mockRejectedValueOnce(new Error('Network error'))

      const refreshPromise = useStore.getState().refreshSessions()

      expect(useStore.getState().isRefreshing).toBe(true)

      await refreshPromise

      expect(useStore.getState().isRefreshing).toBe(false)
    })
  })

  describe('state validation', () => {
    test('should clean up expired dangerous skip permissions during refresh', async () => {
      // Mock Date.now() for this test
      const originalDateNow = Date.now
      const now = new Date('2024-01-01T12:00:00Z').getTime()
      Date.now = () => now

      // Create session with expired dangerous skip permissions
      const expiredSession = createMockSession({
        id: 'test-1',
        dangerouslySkipPermissions: true,
        dangerouslySkipPermissionsExpiresAt: new Date('2024-01-01T11:00:00Z'), // 1 hour ago
      })

      mockGetSessionLeaves.mockResolvedValueOnce({
        sessions: [expiredSession] as any,
      })

      await useStore.getState().refreshSessions()

      const state = useStore.getState()
      expect(state.sessions[0].dangerouslySkipPermissions).toBe(false)
      expect(state.sessions[0].dangerouslySkipPermissionsExpiresAt).toBeUndefined()

      // Restore original Date.now
      Date.now = originalDateNow
    })

    test('should preserve valid dangerous skip permissions during refresh', async () => {
      // Mock Date.now() for this test
      const originalDateNow = Date.now
      const now = new Date('2024-01-01T12:00:00Z').getTime()
      Date.now = () => now

      // Create session with valid dangerous skip permissions
      const validSession = createMockSession({
        id: 'test-1',
        dangerouslySkipPermissions: true,
        dangerouslySkipPermissionsExpiresAt: new Date('2024-01-01T13:00:00Z'), // 1 hour future
      })

      mockGetSessionLeaves.mockResolvedValueOnce({
        sessions: [validSession] as any,
      })

      await useStore.getState().refreshSessions()

      const state = useStore.getState()
      expect(state.sessions[0].dangerouslySkipPermissions).toBe(true)
      expect(state.sessions[0].dangerouslySkipPermissionsExpiresAt).toBeDefined()

      // Restore original Date.now
      Date.now = originalDateNow
    })
  })

  describe('race condition scenarios', () => {
    test('should handle refresh during pending update correctly', async () => {
      const session = createMockSession({ id: 'test-1' })
      useStore.setState({ sessions: [session] })

      // Start optimistic update (don't await)
      mockUpdateSessionSettings.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100)),
      )
      const updatePromise = useStore.getState().updateSessionOptimistic('test-1', {
        autoAcceptEdits: true,
      })

      // Immediately trigger refresh
      const serverSession = createMockSession({
        id: 'test-1',
        autoAcceptEdits: false, // Server doesn't know about update yet
      })
      mockGetSessionLeaves.mockResolvedValueOnce({
        sessions: [serverSession] as any,
      })

      await useStore.getState().refreshSessions()

      // Should preserve the pending update
      expect(useStore.getState().sessions[0].autoAcceptEdits).toBe(true)

      // Wait for update to complete
      await updatePromise

      // Should still have the update
      expect(useStore.getState().sessions[0].autoAcceptEdits).toBe(true)
    })

    test('should handle dangerous skip permissions expiry during refresh', async () => {
      // Mock Date constructor and Date.now for this test
      const originalDateNow = Date.now

      // Set initial time
      const startTime = new Date('2024-01-01T12:00:00Z').getTime()
      Date.now = () => startTime

      const session = createMockSession({
        id: 'test-1',
        dangerouslySkipPermissions: true,
        dangerouslySkipPermissionsExpiresAt: new Date('2024-01-01T12:00:05Z'), // Expires in 5 seconds
      })
      useStore.setState({ sessions: [session] })

      // Advance time so dangerous skip permissions expires
      Date.now = () => new Date('2024-01-01T12:00:10Z').getTime()

      // Server still returns old data
      mockGetSessionLeaves.mockResolvedValueOnce({
        sessions: [session] as any, // Still has dangerous skip permissions enabled
      })

      await useStore.getState().refreshSessions()

      // Should clean up expired state even though server returned it as enabled
      const state = useStore.getState()
      expect(state.sessions[0].dangerouslySkipPermissions).toBe(false)
      expect(state.sessions[0].dangerouslySkipPermissionsExpiresAt).toBeUndefined()

      // Restore original Date functions
      Date.now = originalDateNow
    })
  })
})
