import { Effect } from 'effect'
import { describe, expect, test, vi } from 'vitest'

import {
	handleInterruptOutcome,
	isInterruptRequestedEvent,
	shouldResumeAfterInterrupt,
	subscribeToSessionInterrupt,
} from '@/agents/claudecode/interrupts'
import type { DaemonServices } from '@/agents/claudecode/types'
import { createInterruptState } from '@/agents/shared/interrupt-state.service'
import type { SessionChangeMessage } from '@/collections/types'
import type { ORPCClient } from '@/orpc/client'

import { makeSessionChange } from '../helpers/session-fixtures'

describe('isInterruptRequestedEvent', () => {
	test('returns true for update to interrupt_requested from different status, matching session ID', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested' },
			previousValue: { status: 'running' },
		})

		expect(isInterruptRequestedEvent(change, 'session-123')).toBe(true)
	})

	test('returns true for insert with interrupt_requested status, matching session ID', () => {
		const change = makeSessionChange({
			type: 'insert',
			value: { id: 'session-123', status: 'interrupt_requested' },
		})

		expect(isInterruptRequestedEvent(change, 'session-123')).toBe(true)
	})

	test('returns false for wrong session ID', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested' },
			previousValue: { status: 'running' },
		})

		expect(isInterruptRequestedEvent(change, 'session-456')).toBe(false)
	})

	test('returns false for delete type', () => {
		const change = makeSessionChange({
			type: 'delete',
			value: { id: 'session-123', status: 'interrupt_requested' },
		})

		expect(isInterruptRequestedEvent(change, 'session-123')).toBe(false)
	})

	test('returns false when previousValue already interrupt_requested (no re-trigger)', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested' },
			previousValue: { status: 'interrupt_requested' },
		})

		expect(isInterruptRequestedEvent(change, 'session-123')).toBe(false)
	})

	test('returns false for non-interrupt_requested status', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'running' },
			previousValue: { status: 'launching' },
		})

		expect(isInterruptRequestedEvent(change, 'session-123')).toBe(false)
	})
})

describe('shouldResumeAfterInterrupt', () => {
	test('returns resume: true with new prompt when prompt changed on update', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested', prompt: 'new prompt' },
			previousValue: { status: 'running', prompt: 'old prompt' },
		})

		const result = shouldResumeAfterInterrupt(change)

		expect(result.resume).toBe(true)
		expect(result.newPrompt).toBe('new prompt')
	})

	test('returns resume: false when prompt unchanged', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested', prompt: 'same prompt' },
			previousValue: { status: 'running', prompt: 'same prompt' },
		})

		const result = shouldResumeAfterInterrupt(change)

		expect(result.resume).toBe(false)
		expect(result.newPrompt).toBe(null)
	})

	test('returns resume: false for insert even with prompt', () => {
		const change = makeSessionChange({
			type: 'insert',
			value: { id: 'session-123', status: 'interrupt_requested', prompt: 'new prompt' },
		})

		const result = shouldResumeAfterInterrupt(change)

		expect(result.resume).toBe(false)
		expect(result.newPrompt).toBe(null)
	})

	test('returns resume: false when current prompt is empty', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested', prompt: '' },
			previousValue: { status: 'running', prompt: 'old prompt' },
		})

		const result = shouldResumeAfterInterrupt(change)

		expect(result.resume).toBe(false)
		expect(result.newPrompt).toBe(null)
	})

	test('returns resume: false when current prompt is undefined', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested', prompt: undefined },
			previousValue: { status: 'running', prompt: 'old prompt' },
		})

		const result = shouldResumeAfterInterrupt(change)

		expect(result.resume).toBe(false)
		expect(result.newPrompt).toBe(null)
	})
})

describe('handleInterruptOutcome', () => {
	test('no-op when not interrupted', async () => {
		const mockOnResume = vi.fn(async (_prompt: string) => {})
		const mockSessionsUpdate = vi.fn(async () => ({ success: true, transactionId: 'mock-txid' }))
		const mockOrpc = {
			sessions: {
				update: mockSessionsUpdate,
			},
		} as unknown as ORPCClient

		const mockShutdown = {
			isDaemonShuttingDown: () => false,
		} as unknown as DaemonServices['shutdown']

		const interruptState = await createInterruptState()

		await handleInterruptOutcome({
			interruptState,
			sessionId: 'session-123',
			onResume: mockOnResume,
			orpc: mockOrpc,
			shutdown: mockShutdown,
		})

		expect(mockOnResume).not.toHaveBeenCalled()
		expect(mockSessionsUpdate).not.toHaveBeenCalled()
	})

	test('no-op when daemon is shutting down', async () => {
		const mockOnResume = vi.fn(async (_prompt: string) => {})
		const mockSessionsUpdate = vi.fn(async () => ({ success: true, transactionId: 'mock-txid' }))
		const mockOrpc = {
			sessions: {
				update: mockSessionsUpdate,
			},
		} as unknown as ORPCClient

		const mockShutdown = {
			isDaemonShuttingDown: () => true,
		} as unknown as DaemonServices['shutdown']

		const interruptState = await createInterruptState()
		await Effect.runPromise(interruptState.markInterrupted(null))

		await handleInterruptOutcome({
			interruptState,
			sessionId: 'session-123',
			onResume: mockOnResume,
			orpc: mockOrpc,
			shutdown: mockShutdown,
		})

		expect(mockOnResume).not.toHaveBeenCalled()
		expect(mockSessionsUpdate).not.toHaveBeenCalled()
	})

	test('sets interrupted status when no resume prompt provided', async () => {
		const mockOnResume = vi.fn(async (_prompt: string) => {})
		const mockSessionsUpdate = vi.fn(async () => ({ success: true, transactionId: 'mock-txid' }))
		const mockOrpc = {
			sessions: {
				update: mockSessionsUpdate,
			},
		} as unknown as ORPCClient

		const mockShutdown = {
			isDaemonShuttingDown: () => false,
		} as unknown as DaemonServices['shutdown']

		const interruptState = await createInterruptState()
		await Effect.runPromise(interruptState.markInterrupted(null))

		await handleInterruptOutcome({
			interruptState,
			sessionId: 'session-123',
			onResume: mockOnResume,
			orpc: mockOrpc,
			shutdown: mockShutdown,
		})

		expect(mockOnResume).not.toHaveBeenCalled()
		expect(mockSessionsUpdate).toHaveBeenCalledTimes(1)
		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: 'session-123',
			status: 'interrupted',
		})
	})

	test('calls onResume with new prompt when resumeWithPrompt is provided', async () => {
		const mockOnResume = vi.fn(async (_prompt: string) => {})
		const mockSessionsUpdate = vi.fn(async () => ({ success: true, transactionId: 'mock-txid' }))
		const mockOrpc = {
			sessions: {
				update: mockSessionsUpdate,
			},
		} as unknown as ORPCClient

		const mockShutdown = {
			isDaemonShuttingDown: () => false,
		} as unknown as DaemonServices['shutdown']

		const interruptState = await createInterruptState()
		await Effect.runPromise(interruptState.markInterrupted('new prompt'))

		await handleInterruptOutcome({
			interruptState,
			sessionId: 'session-123',
			onResume: mockOnResume,
			orpc: mockOrpc,
			shutdown: mockShutdown,
		})

		expect(mockOnResume).toHaveBeenCalledTimes(1)
		expect(mockOnResume).toHaveBeenCalledWith('new prompt')
		expect(mockSessionsUpdate).not.toHaveBeenCalled()
	})
})

/**
 * Helper to create a controllable sessions collection mock for subscription testing.
 * Returns both the mock collection and a helper to emit changes.
 */
function createControllableSessionsCollection() {
	let callback: ((changes: SessionChangeMessage[]) => void) | null = null
	return {
		collection: {
			get: () => undefined,
			subscribeChanges: (cb: (changes: SessionChangeMessage[]) => void) => {
				callback = cb
				return {
					unsubscribe: () => {
						callback = null
					},
				}
			},
		} as unknown as DaemonServices['collections']['sessions'],
		// Test helper: emit changes to the subscription
		emitChanges: (changes: SessionChangeMessage[]) => callback?.(changes),
	}
}

describe('subscribeToSessionInterrupt', () => {
	test('marks state on interrupt', async () => {
		const { collection, emitChanges } = createControllableSessionsCollection()
		const interruptState = await createInterruptState()

		subscribeToSessionInterrupt({
			sessionId: 'session-123',
			interruptState,
			eventIterator: undefined,
			closeInputStream: undefined,
			sessionsCollection: collection,
		})

		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested' },
			previousValue: { status: 'running' },
		})

		emitChanges([change])

		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(await Effect.runPromise(interruptState.wasInterrupted)).toBe(true)
	})

	test('sets resumeWithPrompt from prompt change', async () => {
		const { collection, emitChanges } = createControllableSessionsCollection()
		const interruptState = await createInterruptState()

		subscribeToSessionInterrupt({
			sessionId: 'session-123',
			interruptState,
			eventIterator: undefined,
			closeInputStream: undefined,
			sessionsCollection: collection,
		})

		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested', prompt: 'new prompt' },
			previousValue: { status: 'running', prompt: 'old prompt' },
		})

		emitChanges([change])

		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(await Effect.runPromise(interruptState.resumeWithPrompt)).toBe('new prompt')
	})

	test('calls eventIterator.interrupt()', async () => {
		const { collection, emitChanges } = createControllableSessionsCollection()
		const interruptState = await createInterruptState()
		const mockInterrupt = vi.fn(async () => {})

		subscribeToSessionInterrupt({
			sessionId: 'session-123',
			interruptState,
			eventIterator: { interrupt: mockInterrupt },
			closeInputStream: undefined,
			sessionsCollection: collection,
		})

		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested' },
			previousValue: { status: 'running' },
		})

		emitChanges([change])

		// Wait for async interrupt call to complete
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(mockInterrupt).toHaveBeenCalledTimes(1)
	})

	test('calls closeInputStream', async () => {
		const { collection, emitChanges } = createControllableSessionsCollection()
		const interruptState = await createInterruptState()
		const mockCloseInputStream = vi.fn(() => {})

		subscribeToSessionInterrupt({
			sessionId: 'session-123',
			interruptState,
			eventIterator: undefined,
			closeInputStream: mockCloseInputStream,
			sessionsCollection: collection,
		})

		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested' },
			previousValue: { status: 'running' },
		})

		emitChanges([change])

		// Wait for async callback to complete
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(mockCloseInputStream).toHaveBeenCalledTimes(1)
	})

	test('ignores non-matching changes', async () => {
		const { collection, emitChanges } = createControllableSessionsCollection()
		const interruptState = await createInterruptState()
		const mockCloseInputStream = vi.fn(() => {})

		subscribeToSessionInterrupt({
			sessionId: 'session-123',
			interruptState,
			eventIterator: undefined,
			closeInputStream: mockCloseInputStream,
			sessionsCollection: collection,
		})

		// Emit change for different session ID
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-456', status: 'interrupt_requested' },
			previousValue: { status: 'running' },
		})

		emitChanges([change])

		expect(await Effect.runPromise(interruptState.wasInterrupted)).toBe(false)
		expect(mockCloseInputStream).not.toHaveBeenCalled()
	})

	test('ignores non-interrupt status changes', async () => {
		const { collection, emitChanges } = createControllableSessionsCollection()
		const interruptState = await createInterruptState()
		const mockCloseInputStream = vi.fn(() => {})

		subscribeToSessionInterrupt({
			sessionId: 'session-123',
			interruptState,
			eventIterator: undefined,
			closeInputStream: mockCloseInputStream,
			sessionsCollection: collection,
		})

		// Emit update to running status
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'running' },
			previousValue: { status: 'launching' },
		})

		emitChanges([change])

		expect(await Effect.runPromise(interruptState.wasInterrupted)).toBe(false)
		expect(mockCloseInputStream).not.toHaveBeenCalled()
	})

	test('unsubscribe stops listening', async () => {
		const { collection, emitChanges } = createControllableSessionsCollection()
		const interruptState = await createInterruptState()
		const mockCloseInputStream = vi.fn(() => {})

		const unsubscribe = subscribeToSessionInterrupt({
			sessionId: 'session-123',
			interruptState,
			eventIterator: undefined,
			closeInputStream: mockCloseInputStream,
			sessionsCollection: collection,
		})

		// Call unsubscribe
		unsubscribe()

		// Emit change after unsubscribe
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'interrupt_requested' },
			previousValue: { status: 'running' },
		})

		emitChanges([change])

		// State should not be mutated after unsubscribe
		expect(await Effect.runPromise(interruptState.wasInterrupted)).toBe(false)
		expect(mockCloseInputStream).not.toHaveBeenCalled()
	})
})
