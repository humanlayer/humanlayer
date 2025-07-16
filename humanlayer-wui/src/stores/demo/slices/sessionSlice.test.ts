import { describe, test, expect, beforeEach } from 'bun:test'
import { create } from 'zustand'
import { createMockSessions } from '@/test-utils'
import { createSessionSlice, SessionSlice } from './sessionSlice'
import { createStoreTest, testInitialState, createNavigationTests } from '../test-utils'

describe('Demo SessionSlice', () => {
  let store: ReturnType<typeof createStoreTest<SessionSlice>>
  const mockSessions = createMockSessions(5)

  beforeEach(() => {
    store = createStoreTest(() => create<SessionSlice>()(createSessionSlice))
  })

  describe('Session Management', () => {
    test('should initialize with correct defaults', () => {
      testInitialState(store.getState(), {
        sessions: [],
        focusedSession: null,
        searchQuery: '',
      })
    })

    test('should handle basic session operations', () => {
      // Test setters
      store.testSetters([
        ['setSessions', 'sessions', mockSessions],
        ['setSearchQuery', 'searchQuery', 'test query'],
        ['setFocusedSession', 'focusedSession', mockSessions[0]],
      ])
    })

    test('should add and update sessions', () => {
      // Add session
      store.act(s => s.addSession(mockSessions[0]))
      expect(store.getState().sessions.some(s => s.id === mockSessions[0].id)).toBe(true)
      expect(store.getState().sessions.length).toBe(1)

      // Update session
      store.act(s => {
        s.setSessions(mockSessions)
        s.setFocusedSession(mockSessions[0])
        s.updateSession('session-1', { summary: 'Updated summary' })
      })

      const state = store.getState()
      const updated = state.sessions.find(s => s.id === 'session-1')
      expect(updated?.summary).toBe('Updated summary')
      expect(state.focusedSession?.summary).toBe('Updated summary')
    })

    test('should handle session removal with focus clearing', () => {
      store.act(s => {
        s.setSessions(mockSessions)
        s.setFocusedSession(mockSessions[1])
      })

      // Remove focused session
      store.act(s => s.removeSession('session-2'))
      expect(store.getState().sessions.length).toBe(4)
      expect(store.getState().focusedSession).toBeNull()

      // Clear all
      store.act(s => {
        s.setFocusedSession(store.getState().sessions[0])
        s.clearSessions()
      })

      expect(store.getState().sessions).toEqual([])
      expect(store.getState().focusedSession).toBeNull()
    })
  })

  describe('Focus Navigation', () => {
    beforeEach(() => {
      store.act(s => s.setSessions(mockSessions))
    })

    const navigationTests = createNavigationTests([
      { current: 0, action: 'next', expected: 1, total: 5 },
      { current: 4, action: 'next', expected: 0, total: 5, description: 'wrap to first' },
      { current: 2, action: 'prev', expected: 1, total: 5 },
      { current: 0, action: 'prev', expected: 4, total: 5, description: 'wrap to last' },
    ])

    navigationTests.forEach(([description, { current, action, expected }]) => {
      test(description, () => {
        store.act(s => s.setFocusedSession(mockSessions[current]))
        store.act(s => (action === 'next' ? s.focusNextSession() : s.focusPreviousSession()))
        expect(store.getState().focusedSession?.id).toBe(`session-${expected + 1}`)
      })
    })

    test('should handle navigation with no focused session', () => {
      store.act(s => s.setFocusedSession(null))
      store.act(s => s.focusNextSession())
      expect(store.getState().focusedSession?.id).toBe('session-1')
    })

    test('should handle navigation with empty sessions', () => {
      store.act(s => {
        s.clearSessions()
        s.focusNextSession()
        s.focusPreviousSession()
      })
      expect(store.getState().focusedSession).toBeNull()
    })
  })

  describe('Search Functionality', () => {
    test('should set and clear search query', () => {
      store.testSetter('setSearchQuery', 'searchQuery', 'test query')
      store.testSetter('setSearchQuery', 'searchQuery', '')
    })
  })

  describe('Utility Functions', () => {
    beforeEach(() => {
      store.act(s => s.setSessions(mockSessions))
    })

    test('should provide session utilities', () => {
      const state = store.getState()

      // Find by ID
      expect(state.findSessionById('session-3')).toBe(mockSessions[2])
      expect(state.findSessionById('non-existent')).toBeUndefined()

      // Count
      expect(state.getSessionCount()).toBe(5)

      // Existence check
      expect(state.hasSession('session-1')).toBe(true)
      expect(state.hasSession('non-existent')).toBe(false)
    })
  })
})
