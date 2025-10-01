import { describe, test, expect, beforeEach, mock } from 'bun:test'

// Mock the daemon client for archive tests
const mockArchiveSession = mock(() => Promise.resolve())
const mockBulkArchiveSessions = mock(() => Promise.resolve({ success: true }))
const mockGetSessionLeaves = mock(() =>
  Promise.resolve({
    sessions: [],
  }),
)

// Mock the module BEFORE importing anything that uses it
mock.module('@/lib/daemon', () => ({
  daemonClient: {
    archiveSession: mockArchiveSession,
    bulkArchiveSessions: mockBulkArchiveSessions,
    getSessionLeaves: mockGetSessionLeaves,
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

// Import AFTER mocking
import { useStore } from './AppStore'
import { ViewMode } from '@/lib/daemon/types'
import { createMockSession } from './test-utils'

describe('AppStore - Archive Session Focus Clearing', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useStore.getState()
    store.initSessions([])
    store.clearSelection()
    store.setFocusedSession(null)
    store.setViewMode(ViewMode.Normal)

    // Reset mocks
    mockArchiveSession.mockReset()
    mockBulkArchiveSessions.mockReset()
    mockGetSessionLeaves.mockReset()
    mockGetSessionLeaves.mockResolvedValue({ sessions: [] })
  })

  test('should clear focusedSession when archiving in Normal view', async () => {
    const session = createMockSession({
      id: 'session-1',
      archived: false,
    })

    // Setup: Set view mode to Normal and focus a session
    useStore.getState().initSessions([session])
    useStore.getState().setFocusedSession(session)

    // Verify initial state - get fresh state after setting
    const initialState = useStore.getState()
    expect(initialState.focusedSession).toBeDefined()
    expect(initialState.focusedSession?.id).toBe('session-1')
    expect(initialState.getViewMode()).toBe(ViewMode.Normal)

    // Archive the focused session
    await useStore.getState().archiveSession('session-1', true)

    // Verify focus was cleared
    const finalState = useStore.getState()
    expect(finalState.focusedSession).toBeNull()
    expect(mockArchiveSession).toHaveBeenCalledWith({
      session_id: 'session-1',
      archived: true,
    })
  })

  test('should NOT clear focusedSession when unarchiving', async () => {
    const session = createMockSession({
      id: 'session-1',
      archived: true,
    })

    // Setup: Set view mode to Normal and focus a session
    useStore.getState().initSessions([session])
    useStore.getState().setFocusedSession(session)

    // Verify initial state
    const initialState = useStore.getState()
    expect(initialState.focusedSession?.id).toBe('session-1')

    // Unarchive the focused session (archived: false)
    await useStore.getState().archiveSession('session-1', false)

    // Verify focus was NOT cleared
    const finalState = useStore.getState()
    expect(finalState.focusedSession?.id).toBe('session-1')
    expect(mockArchiveSession).toHaveBeenCalledWith({
      session_id: 'session-1',
      archived: false,
    })
  })

  test('should NOT clear focusedSession when archiving in Archive view mode', async () => {
    const session = createMockSession({
      id: 'session-1',
      archived: false,
    })

    // Setup: Set view mode to Archived and focus a session
    useStore.getState().initSessions([session])
    useStore.getState().setViewMode(ViewMode.Archived)
    useStore.getState().setFocusedSession(session)

    // Verify initial state
    const initialState = useStore.getState()
    expect(initialState.focusedSession?.id).toBe('session-1')
    expect(initialState.getViewMode()).toBe(ViewMode.Archived)

    // Archive the focused session
    await useStore.getState().archiveSession('session-1', true)

    // Verify focus was NOT cleared (because we're in Archive view)
    const finalState = useStore.getState()
    expect(finalState.focusedSession?.id).toBe('session-1')
    expect(mockArchiveSession).toHaveBeenCalledWith({
      session_id: 'session-1',
      archived: true,
    })
  })

  test('should NOT clear focusedSession when archiving a different session', async () => {
    const session1 = createMockSession({
      id: 'session-1',
      archived: false,
    })
    const session2 = createMockSession({
      id: 'session-2',
      archived: false,
    })

    // Setup: Focus session 1 and archive session 2
    useStore.getState().initSessions([session1, session2])
    useStore.getState().setFocusedSession(session1)

    // Verify initial state
    const initialState = useStore.getState()
    expect(initialState.focusedSession?.id).toBe('session-1')

    // Archive a different session
    await useStore.getState().archiveSession('session-2', true)

    // Verify focus was NOT cleared (different session was archived)
    const finalState = useStore.getState()
    expect(finalState.focusedSession?.id).toBe('session-1')
    expect(mockArchiveSession).toHaveBeenCalledWith({
      session_id: 'session-2',
      archived: true,
    })
  })

  test('should handle archiving when no session is focused', async () => {
    const session = createMockSession({
      id: 'session-1',
      archived: false,
    })

    // Setup: No focused session
    useStore.getState().initSessions([session])
    useStore.getState().setFocusedSession(null)

    // Verify initial state
    expect(useStore.getState().focusedSession).toBeNull()

    // Archive the session
    await useStore.getState().archiveSession('session-1', true)

    // Verify focus remains null
    const finalState = useStore.getState()
    expect(finalState.focusedSession).toBeNull()
    expect(mockArchiveSession).toHaveBeenCalledWith({
      session_id: 'session-1',
      archived: true,
    })
  })

  test('should handle multiple sequential archives correctly', async () => {
    const session1 = createMockSession({ id: 'session-1', archived: false })
    const session2 = createMockSession({ id: 'session-2', archived: false })
    const session3 = createMockSession({ id: 'session-3', archived: false })

    // Setup: Initialize sessions
    useStore.getState().initSessions([session1, session2, session3])

    // Archive session 1 while focused
    useStore.getState().setFocusedSession(session1)
    await useStore.getState().archiveSession('session-1', true)
    expect(useStore.getState().focusedSession).toBeNull()

    // Focus session 2 and archive it
    useStore.getState().setFocusedSession(session2)
    await useStore.getState().archiveSession('session-2', true)
    expect(useStore.getState().focusedSession).toBeNull()

    // Focus session 3 and archive it
    useStore.getState().setFocusedSession(session3)
    await useStore.getState().archiveSession('session-3', true)
    expect(useStore.getState().focusedSession).toBeNull()

    // Verify all archive calls were made
    expect(mockArchiveSession).toHaveBeenCalledTimes(3)
  })
})
