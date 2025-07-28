import { describe, test, expect, beforeEach } from 'bun:test'
import { useStore } from './AppStore'
import type { Session } from '@/lib/daemon/types'
import { createMockSessions } from './test-utils'

// Mock sessions for testing
const mockSessions: Session[] = createMockSessions(8)

describe('AppStore - Range Selection', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useStore.getState()
    store.initSessions(mockSessions)
    store.clearSelection()
    store.setFocusedSession(null)
  })

  test('should select range when using selectRange', () => {
    const store = useStore.getState()

    // Select sessions 0-2
    store.selectRange(mockSessions[0].id, mockSessions[2].id)

    const state = useStore.getState()
    expect(state.selectedSessions.size).toBe(3)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(true)
  })

  test('should add range to existing selection', () => {
    const store = useStore.getState()

    // First select sessions 0-1
    store.selectRange(mockSessions[0].id, mockSessions[1].id)

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)

    // Add sessions 3-4 to selection
    store.addRangeToSelection(mockSessions[3].id, mockSessions[4].id)

    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(4)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-4')).toBe(true)
    expect(state.selectedSessions.has('session-5')).toBe(true)
  })

  test('should update current range preserving other selections', () => {
    const store = useStore.getState()

    // Setup: Select sessions 0-2 and 5-7
    store.selectRange(mockSessions[0].id, mockSessions[2].id)
    store.addRangeToSelection(mockSessions[5].id, mockSessions[7].id)

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(6)

    // Update the first range from anchor 0 to target 1 (shrinking from 0-2 to 0-1)
    store.updateCurrentRange(mockSessions[0].id, mockSessions[1].id)

    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(5)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(false) // Removed
    expect(state.selectedSessions.has('session-6')).toBe(true)
    expect(state.selectedSessions.has('session-7')).toBe(true)
    expect(state.selectedSessions.has('session-8')).toBe(true)
  })

  test('should handle edge cases with empty sessions', () => {
    const store = useStore.getState()
    store.initSessions([])

    // Should not crash when selecting range with no sessions
    store.selectRange('non-existent-1', 'non-existent-2')
    const state = useStore.getState()
    expect(state.selectedSessions.size).toBe(0)
  })

  test('should toggle individual session selection', () => {
    const store = useStore.getState()

    // Toggle on
    store.toggleSessionSelection(mockSessions[0].id)
    let state = useStore.getState()
    expect(state.selectedSessions.has('session-1')).toBe(true)

    // Toggle off
    store.toggleSessionSelection(mockSessions[0].id)
    state = useStore.getState()
    expect(state.selectedSessions.has('session-1')).toBe(false)
  })

  test('should clear all selections', () => {
    const store = useStore.getState()

    // Select multiple sessions
    store.selectRange(mockSessions[0].id, mockSessions[3].id)
    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(4)

    // Clear all
    store.clearSelection()
    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(0)
  })

  test('should handle updateCurrentRange with non-contiguous selections', () => {
    const store = useStore.getState()

    // Select non-contiguous sessions using toggle
    store.toggleSessionSelection(mockSessions[1].id) // session-2
    store.toggleSessionSelection(mockSessions[2].id) // session-3
    store.toggleSessionSelection(mockSessions[4].id) // session-5

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(3)

    // updateCurrentRange from session-3 (anchor) to session-2 (target)
    // Should find contiguous range 1-2 and update it
    store.updateCurrentRange(mockSessions[2].id, mockSessions[1].id)

    state = useStore.getState()
    // Should keep session-2 and session-3, but session-5 should remain
    expect(state.selectedSessions.size).toBe(3)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(true)
    expect(state.selectedSessions.has('session-5')).toBe(true)
  })

  test('should handle pivot behavior when shrinking selection', () => {
    const store = useStore.getState()

    // Select sessions 1-3
    store.toggleSessionSelection(mockSessions[0].id)
    store.toggleSessionSelection(mockSessions[1].id)
    store.toggleSessionSelection(mockSessions[2].id)

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(3)

    // Simulate shift+j from position 0: anchor at 0, target at 1
    // This should create range 0-1, keeping only sessions 1-2
    store.updateCurrentRange(mockSessions[0].id, mockSessions[1].id)

    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(false)
  })

  test('should handle reverse pivot behavior', () => {
    const store = useStore.getState()

    // Select sessions 1-3
    store.toggleSessionSelection(mockSessions[0].id)
    store.toggleSessionSelection(mockSessions[1].id)
    store.toggleSessionSelection(mockSessions[2].id)

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(3)

    // Simulate shift+k from position 2: anchor at 2, target at 1
    // This should create range 1-2, keeping only sessions 2-3
    store.updateCurrentRange(mockSessions[2].id, mockSessions[1].id)

    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(false)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(true)
  })
})

describe('AppStore - bulkSelect behavior', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useStore.getState()
    store.initSessions(mockSessions)
    store.clearSelection()
    store.setFocusedSession(null)
  })

  test('bulkSelect function with desc should select current and next session', () => {
    const store = useStore.getState()

    // Focus on first session
    store.setFocusedSession(mockSessions[0])

    // Call the actual bulkSelect function from the store
    store.bulkSelect(mockSessions[0].id, 'desc')

    // Verify the selection was made correctly
    const state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)

    // Verify focus moved to next session
    expect(state.focusedSession?.id).toBe('session-2')
  })

  test('bulkSelect with desc should select current and next session', () => {
    const store = useStore.getState()

    // Focus on first session
    store.setFocusedSession(mockSessions[0])

    // Simulate bulkSelect behavior for shift+j (desc)
    // This should select current and next session
    store.selectRange(mockSessions[0].id, mockSessions[1].id)

    const state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
  })

  test('bulkSelect with asc should select previous and current session', () => {
    const store = useStore.getState()

    // Focus on second session
    store.setFocusedSession(mockSessions[1])

    // Simulate bulkSelect behavior for shift+k (asc)
    // This should select previous and current session
    store.selectRange(mockSessions[0].id, mockSessions[1].id)

    const state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
  })

  test('bulkSelect within existing selection should pivot (desc)', () => {
    const store = useStore.getState()

    // Pre-select sessions 1, 2, 3
    store.toggleSessionSelection(mockSessions[0].id)
    store.toggleSessionSelection(mockSessions[1].id)
    store.toggleSessionSelection(mockSessions[2].id)

    // Focus on first session
    store.setFocusedSession(mockSessions[0])

    // Simulate bulkSelect from within selection going down
    // Anchor should be at top of contiguous range (session 1)
    // Target is next position (session 2)
    store.updateCurrentRange(mockSessions[0].id, mockSessions[1].id)

    const state = useStore.getState()
    // Should have sessions 1-2, session 3 deselected
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(false)
  })

  test('bulkSelect within existing selection should pivot (asc)', () => {
    const store = useStore.getState()

    // Pre-select sessions 1, 2, 3
    store.toggleSessionSelection(mockSessions[0].id)
    store.toggleSessionSelection(mockSessions[1].id)
    store.toggleSessionSelection(mockSessions[2].id)

    // Focus on third session
    store.setFocusedSession(mockSessions[2])

    // Simulate bulkSelect from within selection going up
    // Anchor should be at bottom of contiguous range (session 3)
    // Target is previous position (session 2)
    store.updateCurrentRange(mockSessions[2].id, mockSessions[1].id)

    const state = useStore.getState()
    // Should have sessions 2-3, session 1 deselected
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(false)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(true)
  })

  test('bulkSelect with multiple ranges should add new range', () => {
    const store = useStore.getState()

    // Pre-select sessions 1-2
    store.selectRange(mockSessions[0].id, mockSessions[1].id)

    // Focus on session 4 (outside existing selection)
    store.setFocusedSession(mockSessions[3])

    // Simulate bulkSelect from new position
    // Should add new range to existing selection
    store.addRangeToSelection(mockSessions[3].id, mockSessions[4].id)

    const state = useStore.getState()
    expect(state.selectedSessions.size).toBe(4)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-4')).toBe(true)
    expect(state.selectedSessions.has('session-5')).toBe(true)
  })

  test('bulkSelect shift+j then shift+k should deselect only the second item', () => {
    const store = useStore.getState()

    // Start with first session focused, no selections
    store.setFocusedSession(mockSessions[0])

    // Press shift+j from session 1
    // Should select sessions 1-2 with focus on session 2
    store.bulkSelect(mockSessions[0].id, 'desc')

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.focusedSession?.id).toBe('session-2')

    // Now press shift+k from session 2
    // Should deselect session 2, keeping only session 1 selected
    // The anchor should be at session 1 (the start of the original range)
    store.bulkSelect(mockSessions[1].id, 'asc')

    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(1)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(false)
    expect(state.focusedSession?.id).toBe('session-1')
  })

  test('bulkSelect multiple shift+k should extend selection backwards', () => {
    const store = useStore.getState()

    // Start with sessions 2-3 selected, focused on 3
    store.toggleSessionSelection(mockSessions[1].id)
    store.toggleSessionSelection(mockSessions[2].id)
    store.setFocusedSession(mockSessions[2])

    // First shift+k from session 3
    // Should deselect session 3, keeping only session 2
    store.bulkSelect(mockSessions[2].id, 'asc')

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(1)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(false)
    expect(state.focusedSession?.id).toBe('session-2')

    // Second shift+k from session 2
    // Should add session 1 to selection (extending backwards)
    store.bulkSelect(mockSessions[1].id, 'asc')

    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.focusedSession?.id).toBe('session-1')
  })
})
