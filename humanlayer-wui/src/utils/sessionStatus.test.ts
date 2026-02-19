import { describe, test, expect } from 'bun:test'
import { renderSessionStatus } from './sessionStatus'

describe('renderSessionStatus', () => {
  test('returns "draft" for draft sessions', () => {
    expect(renderSessionStatus({ status: 'draft' })).toBe('draft')
  })

  test('returns "interrupted" for interrupted sessions', () => {
    expect(renderSessionStatus({ status: 'interrupted' })).toBe('interrupted')
  })

  test('returns "ready_for_input" for completed non-archived sessions', () => {
    expect(renderSessionStatus({ status: 'completed', archived: false })).toBe('ready_for_input')
  })

  test('returns "completed" for completed archived sessions', () => {
    expect(renderSessionStatus({ status: 'completed', archived: true })).toBe('completed')
  })

  test('returns "needs_approval" for waiting_input without context', () => {
    expect(renderSessionStatus({ status: 'waiting_input' })).toBe('needs_approval')
  })

  test('returns "needs_approval" for waiting_input with waitingReason=approval', () => {
    expect(renderSessionStatus({ status: 'waiting_input' }, { waitingReason: 'approval' })).toBe(
      'needs_approval',
    )
  })

  test('returns "awaiting_answer" for waiting_input with waitingReason=question', () => {
    expect(renderSessionStatus({ status: 'waiting_input' }, { waitingReason: 'question' })).toBe(
      'awaiting_answer',
    )
  })

  test('returns status as-is for unknown statuses', () => {
    expect(renderSessionStatus({ status: 'running' })).toBe('running')
    expect(renderSessionStatus({ status: 'failed' })).toBe('failed')
  })

  test('ignores context for non-waiting_input statuses', () => {
    expect(renderSessionStatus({ status: 'running' }, { waitingReason: 'question' })).toBe('running')
    expect(renderSessionStatus({ status: 'draft' }, { waitingReason: 'question' })).toBe('draft')
  })
})
