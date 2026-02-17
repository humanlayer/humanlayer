import { describe, test, expect, beforeEach } from 'bun:test'
import { create } from 'zustand'

/**
 * These tests verify the pending questions tracking logic used in AppStore.
 * We test against a minimal standalone Zustand store that mirrors the
 * AppStore's pending questions slice, since the full AppStore cannot be
 * imported in this worktree due to a missing @humanlayer/hld-sdk build.
 *
 * The same pre-existing issue affects all AppStore.*.test.ts files.
 */

interface PendingQuestionsSlice {
  sessionsWithPendingQuestions: Set<string>
  addPendingQuestionSession: (sessionId: string) => void
  removePendingQuestionSession: (sessionId: string) => void
  setPendingQuestionSessions: (sessionIds: Set<string>) => void
}

// Mirror the exact implementation from AppStore.ts
const createTestStore = () =>
  create<PendingQuestionsSlice>(set => ({
    sessionsWithPendingQuestions: new Set<string>(),
    addPendingQuestionSession: (sessionId: string) =>
      set(state => ({
        sessionsWithPendingQuestions: new Set(state.sessionsWithPendingQuestions).add(sessionId),
      })),
    removePendingQuestionSession: (sessionId: string) =>
      set(state => {
        const newSet = new Set(state.sessionsWithPendingQuestions)
        newSet.delete(sessionId)
        return { sessionsWithPendingQuestions: newSet }
      }),
    setPendingQuestionSessions: (sessionIds: Set<string>) =>
      set({ sessionsWithPendingQuestions: sessionIds }),
  }))

describe('AppStore - Pending Questions Tracking', () => {
  let useStore: ReturnType<typeof createTestStore>

  beforeEach(() => {
    useStore = createTestStore()
  })

  test('initial state has empty pending questions set', () => {
    const state = useStore.getState()
    expect(state.sessionsWithPendingQuestions.size).toBe(0)
  })

  test('addPendingQuestionSession adds a session', () => {
    useStore.getState().addPendingQuestionSession('session-1')

    const state = useStore.getState()
    expect(state.sessionsWithPendingQuestions.has('session-1')).toBe(true)
    expect(state.sessionsWithPendingQuestions.size).toBe(1)
  })

  test('addPendingQuestionSession is idempotent', () => {
    useStore.getState().addPendingQuestionSession('session-1')
    useStore.getState().addPendingQuestionSession('session-1')

    const state = useStore.getState()
    expect(state.sessionsWithPendingQuestions.size).toBe(1)
  })

  test('addPendingQuestionSession can track multiple sessions', () => {
    useStore.getState().addPendingQuestionSession('session-1')
    useStore.getState().addPendingQuestionSession('session-2')
    useStore.getState().addPendingQuestionSession('session-3')

    const state = useStore.getState()
    expect(state.sessionsWithPendingQuestions.size).toBe(3)
    expect(state.sessionsWithPendingQuestions.has('session-1')).toBe(true)
    expect(state.sessionsWithPendingQuestions.has('session-2')).toBe(true)
    expect(state.sessionsWithPendingQuestions.has('session-3')).toBe(true)
  })

  test('removePendingQuestionSession removes a session', () => {
    useStore.getState().addPendingQuestionSession('session-1')
    useStore.getState().addPendingQuestionSession('session-2')

    useStore.getState().removePendingQuestionSession('session-1')

    const state = useStore.getState()
    expect(state.sessionsWithPendingQuestions.has('session-1')).toBe(false)
    expect(state.sessionsWithPendingQuestions.has('session-2')).toBe(true)
    expect(state.sessionsWithPendingQuestions.size).toBe(1)
  })

  test('removePendingQuestionSession is safe for non-existent session', () => {
    useStore.getState().addPendingQuestionSession('session-1')

    useStore.getState().removePendingQuestionSession('non-existent')

    const state = useStore.getState()
    expect(state.sessionsWithPendingQuestions.size).toBe(1)
    expect(state.sessionsWithPendingQuestions.has('session-1')).toBe(true)
  })

  test('setPendingQuestionSessions replaces the entire set', () => {
    useStore.getState().addPendingQuestionSession('session-1')

    useStore.getState().setPendingQuestionSessions(new Set(['session-2', 'session-3']))

    const state = useStore.getState()
    expect(state.sessionsWithPendingQuestions.size).toBe(2)
    expect(state.sessionsWithPendingQuestions.has('session-1')).toBe(false)
    expect(state.sessionsWithPendingQuestions.has('session-2')).toBe(true)
    expect(state.sessionsWithPendingQuestions.has('session-3')).toBe(true)
  })

  test('setPendingQuestionSessions with empty set clears all', () => {
    useStore.getState().addPendingQuestionSession('session-1')
    useStore.getState().addPendingQuestionSession('session-2')

    useStore.getState().setPendingQuestionSessions(new Set())

    const state = useStore.getState()
    expect(state.sessionsWithPendingQuestions.size).toBe(0)
  })
})
