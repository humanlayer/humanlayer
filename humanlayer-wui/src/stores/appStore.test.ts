import { describe, test, expect, beforeEach } from 'bun:test'
import { createRealAppStore, AppState } from './appStore'
import type { SessionInfo } from '@/lib/daemon/types'
import { ViewMode, ApprovalStatus } from '@/lib/daemon/types'
import { createMockSessions } from '../test-utils'
import { StoreApi } from 'zustand'

// TODO: Add proper mocking when bun:test supports it
// For now, tests that rely on daemon client will need to be adjusted

// Mock sessions for testing
const mockSessions: SessionInfo[] = createMockSessions(8)

describe('AppStore - Range Selection', () => {
  let store: StoreApi<AppState>

  beforeEach(() => {
    // Create a new store instance for each test
    store = createRealAppStore()
    const state = store.getState()
    state.initSessions(mockSessions)
    state.clearSelection()
    state.setFocusedSession(null)
  })

  test('should select range when using selectRange', () => {
    const state = store.getState()

    // Select sessions 0-2
    state.selectRange(mockSessions[0].id, mockSessions[2].id)

    const currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(3)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-3')).toBe(true)
  })

  test('should add range to existing selection', () => {
    const state = store.getState()

    // First select sessions 0-1
    state.selectRange(mockSessions[0].id, mockSessions[1].id)

    let currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(2)

    // Add sessions 3-4 to selection
    state.addRangeToSelection(mockSessions[3].id, mockSessions[4].id)

    currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(4)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-4')).toBe(true)
    expect(currentState.selectedSessions.has('session-5')).toBe(true)
  })

  test('should update current range preserving other selections', () => {
    const state = store.getState()

    // Setup: Select sessions 0-2 and 5-7
    state.selectRange(mockSessions[0].id, mockSessions[2].id)
    state.addRangeToSelection(mockSessions[5].id, mockSessions[7].id)

    let currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(6)

    // Update the first range from anchor 0 to target 1 (shrinking from 0-2 to 0-1)
    state.updateCurrentRange(mockSessions[0].id, mockSessions[1].id)

    currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(5)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-3')).toBe(false) // Removed
    expect(currentState.selectedSessions.has('session-6')).toBe(true)
    expect(currentState.selectedSessions.has('session-7')).toBe(true)
    expect(currentState.selectedSessions.has('session-8')).toBe(true)
  })

  test('should handle edge cases with empty sessions', () => {
    const state = store.getState()
    state.initSessions([])

    // Should not crash when selecting range with no sessions
    state.selectRange('non-existent-1', 'non-existent-2')
    const currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(0)
  })

  test('should toggle individual session selection', () => {
    const state = store.getState()

    // Toggle on
    state.toggleSessionSelection(mockSessions[0].id)
    let currentState = store.getState()
    expect(currentState.selectedSessions.has('session-1')).toBe(true)

    // Toggle off
    state.toggleSessionSelection(mockSessions[0].id)
    currentState = store.getState()
    expect(currentState.selectedSessions.has('session-1')).toBe(false)
  })

  test('should clear all selections', () => {
    const state = store.getState()

    // Select multiple sessions
    state.selectRange(mockSessions[0].id, mockSessions[3].id)
    let currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(4)

    // Clear all
    state.clearSelection()
    currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(0)
  })

  test('should handle updateCurrentRange with non-contiguous selections', () => {
    const state = store.getState()

    // Select non-contiguous sessions using toggle
    state.toggleSessionSelection(mockSessions[1].id) // session-2
    state.toggleSessionSelection(mockSessions[2].id) // session-3
    state.toggleSessionSelection(mockSessions[4].id) // session-5

    let currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(3)

    // updateCurrentRange from session-3 (anchor) to session-2 (target)
    // Should find contiguous range 1-2 and update it
    state.updateCurrentRange(mockSessions[2].id, mockSessions[1].id)

    currentState = store.getState()
    // Should keep session-2 and session-3, but session-5 should remain
    expect(currentState.selectedSessions.size).toBe(3)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-3')).toBe(true)
    expect(currentState.selectedSessions.has('session-5')).toBe(true)
  })

  test('should handle pivot behavior when shrinking selection', () => {
    const state = store.getState()

    // Select sessions 1-3
    state.toggleSessionSelection(mockSessions[0].id)
    state.toggleSessionSelection(mockSessions[1].id)
    state.toggleSessionSelection(mockSessions[2].id)

    let currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(3)

    // Simulate shift+j from position 0: anchor at 0, target at 1
    // This should create range 0-1, keeping only sessions 1-2
    state.updateCurrentRange(mockSessions[0].id, mockSessions[1].id)

    currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-3')).toBe(false)
  })

  test('should handle reverse pivot behavior', () => {
    const state = store.getState()

    // Select sessions 1-3
    state.toggleSessionSelection(mockSessions[0].id)
    state.toggleSessionSelection(mockSessions[1].id)
    state.toggleSessionSelection(mockSessions[2].id)

    let currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(3)

    // Simulate shift+k from position 2: anchor at 2, target at 1
    // This should create range 1-2, keeping only sessions 2-3
    state.updateCurrentRange(mockSessions[2].id, mockSessions[1].id)

    currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(false)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-3')).toBe(true)
  })
})

describe('AppStore - bulkSelect behavior', () => {
  let store: StoreApi<AppState>

  beforeEach(() => {
    // Create a new store instance for each test
    store = createRealAppStore()
    const state = store.getState()
    state.initSessions(mockSessions)
    state.clearSelection()
    state.setFocusedSession(null)
  })

  test('bulkSelect function with desc should select current and next session', () => {
    const state = store.getState()

    // Focus on first session
    state.setFocusedSession(mockSessions[0])

    // Call the actual bulkSelect function from the store
    state.bulkSelect(mockSessions[0].id, 'desc')

    // Verify the selection was made correctly
    const currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)

    // Verify focus moved to next session
    expect(currentState.focusedSession?.id).toBe('session-2')
  })

  test('bulkSelect with desc should select current and next session', () => {
    const state = store.getState()

    // Focus on first session
    state.setFocusedSession(mockSessions[0])

    // Simulate bulkSelect behavior for shift+j (desc)
    // This should select current and next session
    state.selectRange(mockSessions[0].id, mockSessions[1].id)

    const currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
  })

  test('bulkSelect with asc should select previous and current session', () => {
    const state = store.getState()

    // Focus on second session
    state.setFocusedSession(mockSessions[1])

    // Simulate bulkSelect behavior for shift+k (asc)
    // This should select previous and current session
    state.selectRange(mockSessions[0].id, mockSessions[1].id)

    const currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
  })

  test('bulkSelect within existing selection should pivot (desc)', () => {
    const state = store.getState()

    // Pre-select sessions 1, 2, 3
    state.toggleSessionSelection(mockSessions[0].id)
    state.toggleSessionSelection(mockSessions[1].id)
    state.toggleSessionSelection(mockSessions[2].id)

    // Focus on first session
    state.setFocusedSession(mockSessions[0])

    // Simulate bulkSelect from within selection going down
    // Anchor should be at top of contiguous range (session 1)
    // Target is next position (session 2)
    state.updateCurrentRange(mockSessions[0].id, mockSessions[1].id)

    const currentState = store.getState()
    // Should have sessions 1-2, session 3 deselected
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-3')).toBe(false)
  })

  test('bulkSelect within existing selection should pivot (asc)', () => {
    const state = store.getState()

    // Pre-select sessions 1, 2, 3
    state.toggleSessionSelection(mockSessions[0].id)
    state.toggleSessionSelection(mockSessions[1].id)
    state.toggleSessionSelection(mockSessions[2].id)

    // Focus on third session
    state.setFocusedSession(mockSessions[2])

    // Simulate bulkSelect from within selection going up
    // Anchor should be at bottom of contiguous range (session 3)
    // Target is previous position (session 2)
    state.updateCurrentRange(mockSessions[2].id, mockSessions[1].id)

    const currentState = store.getState()
    // Should have sessions 2-3, session 1 deselected
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(false)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-3')).toBe(true)
  })

  test('bulkSelect with multiple ranges should add new range', () => {
    const state = store.getState()

    // Pre-select sessions 1-2
    state.selectRange(mockSessions[0].id, mockSessions[1].id)

    // Focus on session 4 (outside existing selection)
    state.setFocusedSession(mockSessions[3])

    // Simulate bulkSelect from new position
    // Should add new range to existing selection
    state.addRangeToSelection(mockSessions[3].id, mockSessions[4].id)

    const currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(4)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-4')).toBe(true)
    expect(currentState.selectedSessions.has('session-5')).toBe(true)
  })

  test('bulkSelect shift+j then shift+k should deselect only the second item', () => {
    const state = store.getState()

    // Start with first session focused, no selections
    state.setFocusedSession(mockSessions[0])

    // Press shift+j from session 1
    // Should select sessions 1-2 with focus on session 2
    state.bulkSelect(mockSessions[0].id, 'desc')

    let currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.focusedSession?.id).toBe('session-2')

    // Now press shift+k from session 2
    // Should deselect session 2, keeping only session 1 selected
    // The anchor should be at session 1 (the start of the original range)
    state.bulkSelect(mockSessions[1].id, 'asc')

    currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(1)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(false)
    expect(currentState.focusedSession?.id).toBe('session-1')
  })

  test('bulkSelect multiple shift+k should extend selection backwards', () => {
    const state = store.getState()

    // Start with sessions 2-3 selected, focused on 3
    state.toggleSessionSelection(mockSessions[1].id)
    state.toggleSessionSelection(mockSessions[2].id)
    state.setFocusedSession(mockSessions[2])

    // First shift+k from session 3
    // Should deselect session 3, keeping only session 2
    state.bulkSelect(mockSessions[2].id, 'asc')

    let currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(1)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.selectedSessions.has('session-3')).toBe(false)
    expect(currentState.focusedSession?.id).toBe('session-2')

    // Second shift+k from session 2
    // Should add session 1 to selection (extending backwards)
    state.bulkSelect(mockSessions[1].id, 'asc')

    currentState = store.getState()
    expect(currentState.selectedSessions.size).toBe(2)
    expect(currentState.selectedSessions.has('session-1')).toBe(true)
    expect(currentState.selectedSessions.has('session-2')).toBe(true)
    expect(currentState.focusedSession?.id).toBe('session-1')
  })
})

describe('AppStore - Notification Management', () => {
  let store: StoreApi<AppState>

  beforeEach(() => {
    store = createRealAppStore()
  })

  test('should add and check notified items', () => {
    const state = store.getState()

    state.addNotifiedItem('notification-1')
    state.addNotifiedItem('notification-2')

    expect(state.isItemNotified('notification-1')).toBe(true)
    expect(state.isItemNotified('notification-2')).toBe(true)
    expect(state.isItemNotified('notification-3')).toBe(false)
  })

  test('should remove notified items', () => {
    const state = store.getState()

    state.addNotifiedItem('notification-1')
    state.addNotifiedItem('notification-2')

    state.removeNotifiedItem('notification-1')

    expect(state.isItemNotified('notification-1')).toBe(false)
    expect(state.isItemNotified('notification-2')).toBe(true)
  })

  test('should clear notifications for specific session', () => {
    const state = store.getState()

    state.addNotifiedItem('session-1-approval-1')
    state.addNotifiedItem('session-1-event-1')
    state.addNotifiedItem('session-2-approval-1')

    state.clearNotificationsForSession('session-1')

    expect(state.isItemNotified('session-1-approval-1')).toBe(false)
    expect(state.isItemNotified('session-1-event-1')).toBe(false)
    expect(state.isItemNotified('session-2-approval-1')).toBe(true)
  })
})

describe('AppStore - Navigation Tracking', () => {
  let store: StoreApi<AppState>

  beforeEach(() => {
    store = createRealAppStore()
  })

  test('should track navigation from session', () => {
    const state = store.getState()

    state.trackNavigationFrom('session-1')

    expect(state.wasRecentlyNavigatedFrom('session-1')).toBe(true)
    expect(state.wasRecentlyNavigatedFrom('session-2')).toBe(false)
  })

  // TODO: Re-enable when bun:test supports fake timers
  // test('should check navigation within time window', () => {
  //   const state = store.getState()
  //   state.trackNavigationFrom('session-1')
  //   // Check immediately - should be true
  //   expect(state.wasRecentlyNavigatedFrom('session-1', 1000)).toBe(true)
  //   // Advance time by 500ms
  //   vi.advanceTimersByTime(500)
  //   expect(state.wasRecentlyNavigatedFrom('session-1', 1000)).toBe(true)
  //   // Advance time by another 600ms (total 1100ms)
  //   vi.advanceTimersByTime(600)
  //   expect(state.wasRecentlyNavigatedFrom('session-1', 1000)).toBe(false)
  // })

  // TODO: Re-enable when bun:test supports fake timers
  // test('should auto-cleanup navigation tracking after timeout', () => {
  //   const state = store.getState()
  //   state.trackNavigationFrom('session-1')
  //   expect(state.wasRecentlyNavigatedFrom('session-1')).toBe(true)
  //   // Advance time by 5 seconds (cleanup timeout)
  //   vi.advanceTimersByTime(5000)
  //   expect(state.wasRecentlyNavigatedFrom('session-1')).toBe(false)
  // })
})

describe('AppStore - Session Management', () => {
  let store: StoreApi<AppState>

  beforeEach(() => {
    store = createRealAppStore()
    const state = store.getState()
    state.initSessions(mockSessions)
  })

  test('should focus next session', () => {
    const state = store.getState()

    // Start with no focus
    state.setFocusedSession(null)
    state.focusNextSession()

    expect(store.getState().focusedSession?.id).toBe('session-1')

    // Focus next again
    state.focusNextSession()
    expect(store.getState().focusedSession?.id).toBe('session-2')

    // Focus last session and wrap around
    state.setFocusedSession(mockSessions[mockSessions.length - 1])
    state.focusNextSession()
    expect(store.getState().focusedSession?.id).toBe('session-1')
  })

  test('should focus previous session', () => {
    const state = store.getState()

    // Start with no focus
    state.setFocusedSession(null)
    state.focusPreviousSession()

    expect(store.getState().focusedSession?.id).toBe('session-8')

    // Focus previous again
    state.focusPreviousSession()
    expect(store.getState().focusedSession?.id).toBe('session-7')

    // Focus first session and wrap around
    state.setFocusedSession(mockSessions[0])
    state.focusPreviousSession()
    expect(store.getState().focusedSession?.id).toBe('session-8')
  })

  test('should update session', () => {
    const state = store.getState()

    state.updateSession('session-1', { summary: 'Updated summary' })

    const currentState = store.getState()
    const updatedSession = currentState.sessions.find(s => s.id === 'session-1')
    expect(updatedSession?.summary).toBe('Updated summary')
  })

  test('should update focused session when updating its data', () => {
    const state = store.getState()

    state.setFocusedSession(mockSessions[0])
    state.updateSession('session-1', { summary: 'Updated summary' })

    const currentState = store.getState()
    expect(currentState.focusedSession?.summary).toBe('Updated summary')
  })
})

describe('AppStore - Approval Management', () => {
  let store: StoreApi<AppState>

  beforeEach(() => {
    store = createRealAppStore()
  })

  test('should set approvals', () => {
    const state = store.getState()
    const mockApprovals = [
      { id: 'approval-1', status: 'pending' },
      { id: 'approval-2', status: 'pending' },
    ]

    state.setApprovals(mockApprovals as any)

    const currentState = store.getState()
    expect(currentState.approvals).toHaveLength(2)
    expect(currentState.approvals[0].id).toBe('approval-1')
  })

  test('should update approval', () => {
    const state = store.getState()
    const mockApprovals = [
      { id: 'approval-1', status: 'pending' },
      { id: 'approval-2', status: 'pending' },
    ]

    state.setApprovals(mockApprovals as any)
    state.updateApproval('approval-1', { status: ApprovalStatus.Approved })

    const currentState = store.getState()
    const updatedApproval = currentState.approvals.find(a => a.id === 'approval-1')
    expect(updatedApproval?.status).toBe(ApprovalStatus.Approved)
  })
})

describe('AppStore - UI State', () => {
  let store: StoreApi<AppState>

  beforeEach(() => {
    store = createRealAppStore()
  })

  test('should set loading state', () => {
    const state = store.getState()

    state.setLoading(true)
    expect(store.getState().isLoading).toBe(true)

    state.setLoading(false)
    expect(store.getState().isLoading).toBe(false)
  })

  test('should set active session id', () => {
    const state = store.getState()

    state.setActiveSessionId('session-123')
    expect(store.getState().activeSessionId).toBe('session-123')

    state.setActiveSessionId(null)
    expect(store.getState().activeSessionId).toBe(null)
  })

  test('should set view mode', () => {
    const state = store.getState()

    state.setViewMode(ViewMode.Archived)

    expect(store.getState().viewMode).toBe(ViewMode.Archived)
    // TODO: Add test for refresh sessions when mocking is available
  })
})
