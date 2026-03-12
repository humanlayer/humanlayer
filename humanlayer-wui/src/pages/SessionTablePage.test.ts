import { describe, expect, test } from 'bun:test'
import { SessionStatus } from '@/lib/daemon/types'
import { createMockSession } from '@/test-utils'
import { getLatestChildSession } from './SessionTablePage'

describe('getLatestChildSession', () => {
  test('prefers an active child session over newer completed children', () => {
    const parent = createMockSession({ id: 'parent-1' })
    const runningChild = createMockSession({
      id: 'child-running',
      parentSessionId: parent.id,
      status: SessionStatus.Running,
      lastActivityAt: new Date('2026-03-12T20:00:00Z'),
    })
    const completedChild = createMockSession({
      id: 'child-completed',
      parentSessionId: parent.id,
      status: SessionStatus.Completed,
      lastActivityAt: new Date('2026-03-12T21:00:00Z'),
    })

    expect(getLatestChildSession([parent, completedChild, runningChild], parent.id)?.id).toBe(
      'child-running',
    )
  })

  test('falls back to the most recent child when none are active', () => {
    const parent = createMockSession({ id: 'parent-2' })
    const olderChild = createMockSession({
      id: 'child-older',
      parentSessionId: parent.id,
      status: SessionStatus.Completed,
      lastActivityAt: new Date('2026-03-12T18:00:00Z'),
    })
    const newestChild = createMockSession({
      id: 'child-newest',
      parentSessionId: parent.id,
      status: SessionStatus.Completed,
      lastActivityAt: new Date('2026-03-12T22:00:00Z'),
    })

    expect(getLatestChildSession([parent, olderChild, newestChild], parent.id)?.id).toBe(
      'child-newest',
    )
  })

  test('returns null when a session has no child sessions', () => {
    const parent = createMockSession({ id: 'parent-3' })

    expect(getLatestChildSession([parent], parent.id)).toBeNull()
  })
})
