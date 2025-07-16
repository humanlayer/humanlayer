import { describe, test, expect, beforeEach } from 'bun:test'
import { create, StoreApi } from 'zustand'
import type { SessionInfo } from '@/lib/daemon/types'
import { createMockSessions } from '@/test-utils'
import { createSessionSlice, SessionSlice } from './sessionSlice'

// Helper to create a test store with just the session slice
function createTestStore(): StoreApi<SessionSlice> {
  return create<SessionSlice>()(createSessionSlice)
}

describe('Demo SessionSlice', () => {
  let store: StoreApi<SessionSlice>
  let mockSessions: SessionInfo[]

  beforeEach(() => {
    store = createTestStore()
    mockSessions = createMockSessions(5)
  })

  describe('Session Management', () => {
    test('should initialize with empty sessions', () => {
      const state = store.getState()
      expect(state.sessions).toEqual([])
      expect(state.focusedSession).toBeNull()
      expect(state.searchQuery).toBe('')
    })

    test('should set sessions', () => {
      store.getState().setSessions(mockSessions)

      const state = store.getState()
      expect(state.sessions).toEqual(mockSessions)
      expect(state.sessions.length).toBe(5)
    })

    test('should add a single session', () => {
      const newSession = mockSessions[0]
      store.getState().addSession(newSession)

      const state = store.getState()
      expect(state.sessions).toContain(newSession)
      expect(state.sessions.length).toBe(1)
    })

    test('should update an existing session', () => {
      store.getState().setSessions(mockSessions)

      const updates = { summary: 'Updated summary' }
      store.getState().updateSession('session-1', updates)

      const state = store.getState()
      const updatedSession = state.sessions.find(s => s.id === 'session-1')
      expect(updatedSession?.summary).toBe('Updated summary')
    })

    test('should update focused session when updating the focused one', () => {
      store.getState().setSessions(mockSessions)
      store.getState().setFocusedSession(mockSessions[0])

      const updates = { summary: 'Updated summary' }
      store.getState().updateSession('session-1', updates)

      const state = store.getState()
      expect(state.focusedSession?.summary).toBe('Updated summary')
    })

    test('should remove a session', () => {
      store.getState().setSessions(mockSessions)

      store.getState().removeSession('session-2')

      const state = store.getState()
      expect(state.sessions.length).toBe(4)
      expect(state.sessions.find(s => s.id === 'session-2')).toBeUndefined()
    })

    test('should clear focused session when removing the focused one', () => {
      store.getState().setSessions(mockSessions)
      store.getState().setFocusedSession(mockSessions[1])

      store.getState().removeSession('session-2')

      const state = store.getState()
      expect(state.focusedSession).toBeNull()
    })

    test('should clear all sessions', () => {
      store.getState().setSessions(mockSessions)
      store.getState().setFocusedSession(mockSessions[0])

      store.getState().clearSessions()

      const state = store.getState()
      expect(state.sessions).toEqual([])
      expect(state.focusedSession).toBeNull()
    })
  })

  describe('Focus Management', () => {
    test('should set focused session', () => {
      store.getState().setSessions(mockSessions)
      store.getState().setFocusedSession(mockSessions[2])

      const state = store.getState()
      expect(state.focusedSession).toEqual(mockSessions[2])
    })

    test('should focus next session', () => {
      store.getState().setSessions(mockSessions)
      store.getState().setFocusedSession(mockSessions[0])

      store.getState().focusNextSession()

      const state = store.getState()
      expect(state.focusedSession?.id).toBe('session-2')
    })

    test('should wrap to first session when focusing next from last', () => {
      store.getState().setSessions(mockSessions)
      store.getState().setFocusedSession(mockSessions[4])

      store.getState().focusNextSession()

      const state = store.getState()
      expect(state.focusedSession?.id).toBe('session-1')
    })

    test('should focus first session when no session is focused', () => {
      store.getState().setSessions(mockSessions)

      store.getState().focusNextSession()

      const state = store.getState()
      expect(state.focusedSession?.id).toBe('session-1')
    })

    test('should focus previous session', () => {
      store.getState().setSessions(mockSessions)
      store.getState().setFocusedSession(mockSessions[2])

      store.getState().focusPreviousSession()

      const state = store.getState()
      expect(state.focusedSession?.id).toBe('session-2')
    })

    test('should wrap to last session when focusing previous from first', () => {
      store.getState().setSessions(mockSessions)
      store.getState().setFocusedSession(mockSessions[0])

      store.getState().focusPreviousSession()

      const state = store.getState()
      expect(state.focusedSession?.id).toBe('session-5')
    })

    test('should handle focus navigation with empty sessions', () => {
      // No sessions
      store.getState().focusNextSession()
      expect(store.getState().focusedSession).toBeNull()

      store.getState().focusPreviousSession()
      expect(store.getState().focusedSession).toBeNull()
    })
  })

  describe('Search Functionality', () => {
    test('should set search query', () => {
      store.getState().setSearchQuery('test query')

      const state = store.getState()
      expect(state.searchQuery).toBe('test query')
    })

    test('should clear search query', () => {
      store.getState().setSearchQuery('test query')
      store.getState().setSearchQuery('')

      const state = store.getState()
      expect(state.searchQuery).toBe('')
    })
  })

  describe('Batch Operations', () => {
    test('should find session by id', () => {
      store.getState().setSessions(mockSessions)

      const session = store.getState().findSessionById('session-3')
      expect(session).toEqual(mockSessions[2])
    })

    test('should return undefined for non-existent session id', () => {
      store.getState().setSessions(mockSessions)

      const session = store.getState().findSessionById('non-existent')
      expect(session).toBeUndefined()
    })

    test('should get session count', () => {
      expect(store.getState().getSessionCount()).toBe(0)

      store.getState().setSessions(mockSessions)
      expect(store.getState().getSessionCount()).toBe(5)
    })

    test('should check if session exists', () => {
      store.getState().setSessions(mockSessions)

      expect(store.getState().hasSession('session-1')).toBe(true)
      expect(store.getState().hasSession('non-existent')).toBe(false)
    })
  })
})
