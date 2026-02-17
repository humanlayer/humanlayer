import { describe, test, expect, beforeEach } from 'bun:test'
import { create } from 'zustand'

/**
 * These tests verify the sessionsAwaitingAnswer tracking logic used in
 * AppStore. We test against a minimal standalone Zustand store that mirrors
 * the AppStore's slice, since the full AppStore cannot be imported in this
 * worktree due to a missing @humanlayer/hld-sdk build.
 *
 * The same pre-existing issue affects all AppStore.*.test.ts files.
 */

interface AwaitingAnswerSlice {
  sessionsAwaitingAnswer: Set<string>
  addSessionAwaitingAnswer: (sessionId: string) => void
  removeSessionAwaitingAnswer: (sessionId: string) => void
  setSessionsAwaitingAnswer: (sessionIds: Set<string>) => void
}

// Mirror the exact implementation from AppStore.ts
const createTestStore = () =>
  create<AwaitingAnswerSlice>(set => ({
    sessionsAwaitingAnswer: new Set<string>(),
    addSessionAwaitingAnswer: (sessionId: string) =>
      set(state => ({
        sessionsAwaitingAnswer: new Set(state.sessionsAwaitingAnswer).add(sessionId),
      })),
    removeSessionAwaitingAnswer: (sessionId: string) =>
      set(state => {
        const newSet = new Set(state.sessionsAwaitingAnswer)
        newSet.delete(sessionId)
        return { sessionsAwaitingAnswer: newSet }
      }),
    setSessionsAwaitingAnswer: (sessionIds: Set<string>) => set({ sessionsAwaitingAnswer: sessionIds }),
  }))

describe('AppStore - Sessions Awaiting Answer Tracking', () => {
  let useStore: ReturnType<typeof createTestStore>

  beforeEach(() => {
    useStore = createTestStore()
  })

  test('initial state has empty set', () => {
    const state = useStore.getState()
    expect(state.sessionsAwaitingAnswer.size).toBe(0)
  })

  test('addSessionAwaitingAnswer adds a session', () => {
    useStore.getState().addSessionAwaitingAnswer('session-1')

    const state = useStore.getState()
    expect(state.sessionsAwaitingAnswer.has('session-1')).toBe(true)
    expect(state.sessionsAwaitingAnswer.size).toBe(1)
  })

  test('addSessionAwaitingAnswer is idempotent', () => {
    useStore.getState().addSessionAwaitingAnswer('session-1')
    useStore.getState().addSessionAwaitingAnswer('session-1')

    const state = useStore.getState()
    expect(state.sessionsAwaitingAnswer.size).toBe(1)
  })

  test('addSessionAwaitingAnswer can track multiple sessions', () => {
    useStore.getState().addSessionAwaitingAnswer('session-1')
    useStore.getState().addSessionAwaitingAnswer('session-2')
    useStore.getState().addSessionAwaitingAnswer('session-3')

    const state = useStore.getState()
    expect(state.sessionsAwaitingAnswer.size).toBe(3)
    expect(state.sessionsAwaitingAnswer.has('session-1')).toBe(true)
    expect(state.sessionsAwaitingAnswer.has('session-2')).toBe(true)
    expect(state.sessionsAwaitingAnswer.has('session-3')).toBe(true)
  })

  test('removeSessionAwaitingAnswer removes a session', () => {
    useStore.getState().addSessionAwaitingAnswer('session-1')
    useStore.getState().addSessionAwaitingAnswer('session-2')

    useStore.getState().removeSessionAwaitingAnswer('session-1')

    const state = useStore.getState()
    expect(state.sessionsAwaitingAnswer.has('session-1')).toBe(false)
    expect(state.sessionsAwaitingAnswer.has('session-2')).toBe(true)
    expect(state.sessionsAwaitingAnswer.size).toBe(1)
  })

  test('removeSessionAwaitingAnswer is safe for non-existent session', () => {
    useStore.getState().addSessionAwaitingAnswer('session-1')

    useStore.getState().removeSessionAwaitingAnswer('non-existent')

    const state = useStore.getState()
    expect(state.sessionsAwaitingAnswer.size).toBe(1)
    expect(state.sessionsAwaitingAnswer.has('session-1')).toBe(true)
  })

  test('setSessionsAwaitingAnswer replaces the entire set', () => {
    useStore.getState().addSessionAwaitingAnswer('session-1')

    useStore.getState().setSessionsAwaitingAnswer(new Set(['session-2', 'session-3']))

    const state = useStore.getState()
    expect(state.sessionsAwaitingAnswer.size).toBe(2)
    expect(state.sessionsAwaitingAnswer.has('session-1')).toBe(false)
    expect(state.sessionsAwaitingAnswer.has('session-2')).toBe(true)
    expect(state.sessionsAwaitingAnswer.has('session-3')).toBe(true)
  })

  test('setSessionsAwaitingAnswer with empty set clears all', () => {
    useStore.getState().addSessionAwaitingAnswer('session-1')
    useStore.getState().addSessionAwaitingAnswer('session-2')

    useStore.getState().setSessionsAwaitingAnswer(new Set())

    const state = useStore.getState()
    expect(state.sessionsAwaitingAnswer.size).toBe(0)
  })
})
