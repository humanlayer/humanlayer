import { describe, test, expect, beforeEach } from 'bun:test'
import { useStore } from './AppStore'
import type { SessionInfo } from '@/lib/daemon/types'
import { createMockSessions } from './test-utils'

// Mock sessions for testing
const mockSessions: SessionInfo[] = createMockSessions(4)

describe('AppStore - Range Selection', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useStore.getState()
    store.initSessions(mockSessions)
    store.clearSelection()
    store.setFocusedSession(null)
    store.setSelectionAnchor(null)
  })

  test('should select range from anchor to current position when moving down', () => {
    const store = useStore.getState()

    // Start at session-1
    store.setFocusedSession(mockSessions[0])

    // First shift+j should set anchor and select sessions 0 and 1
    store.setSelectionAnchor(mockSessions[0].id)
    store.selectRange(mockSessions[0].id, mockSessions[1].id)

    // Get fresh state after updates
    const updatedState = useStore.getState()
    expect(updatedState.selectedSessions.size).toBe(2)
    expect(updatedState.selectedSessions.has('session-1')).toBe(true)
    expect(updatedState.selectedSessions.has('session-2')).toBe(true)

    // Second shift+j should extend range to include session-3
    store.selectRange(mockSessions[0].id, mockSessions[2].id)

    const finalState = useStore.getState()
    expect(finalState.selectedSessions.size).toBe(3)
    expect(finalState.selectedSessions.has('session-1')).toBe(true)
    expect(finalState.selectedSessions.has('session-2')).toBe(true)
    expect(finalState.selectedSessions.has('session-3')).toBe(true)
  })

  test('should shrink range when moving back up with shift+k', () => {
    const store = useStore.getState()

    // Start with range selected from session-1 to session-3
    store.setSelectionAnchor(mockSessions[0].id)
    store.selectRange(mockSessions[0].id, mockSessions[2].id)

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(3)

    // shift+k should shrink range to sessions 1 and 2
    store.selectRange(mockSessions[0].id, mockSessions[1].id)

    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(false)
  })

  test('should handle range selection in reverse direction', () => {
    const store = useStore.getState()

    // Start at session-3 and select upward
    store.setFocusedSession(mockSessions[2])
    store.setSelectionAnchor(mockSessions[2].id)

    // Select from session-3 to session-2 (upward)
    store.selectRange(mockSessions[2].id, mockSessions[1].id)

    let state = useStore.getState()
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(true)

    // Extend to session-1
    store.selectRange(mockSessions[2].id, mockSessions[0].id)

    state = useStore.getState()
    expect(state.selectedSessions.size).toBe(3)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
    expect(state.selectedSessions.has('session-3')).toBe(true)
  })

  test('should clear anchor when regular navigation occurs', () => {
    const store = useStore.getState()

    // Set up range selection
    store.setSelectionAnchor(mockSessions[0].id)
    let state = useStore.getState()
    expect(state.selectionAnchor).toBe('session-1')

    // Regular navigation should clear anchor
    store.clearSelectionAnchor()
    state = useStore.getState()
    expect(state.selectionAnchor).toBe(null)
  })

  test('should handle edge cases with empty sessions', () => {
    const store = useStore.getState()
    store.initSessions([])

    // Should not crash when selecting range with no sessions
    store.selectRange('non-existent-1', 'non-existent-2')
    const state = useStore.getState()
    expect(state.selectedSessions.size).toBe(0)
  })

  test('should select current and next on first shift+j', () => {
    const store = useStore.getState()

    // Start at session-1 with no selection
    store.setFocusedSession(mockSessions[0])
    expect(store.selectedSessions.size).toBe(0)

    // First shift+j should set anchor at current position and select current + next
    store.setSelectionAnchor(mockSessions[0].id)
    store.selectRange(mockSessions[0].id, mockSessions[1].id)

    const state = useStore.getState()
    expect(state.selectionAnchor).toBe('session-1')
    expect(state.selectedSessions.size).toBe(2)
    expect(state.selectedSessions.has('session-1')).toBe(true)
    expect(state.selectedSessions.has('session-2')).toBe(true)
  })
})
