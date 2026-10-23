import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { type UseSmartSessionEntryScrollOptions, useSmartSessionEntryScroll } from '@/hooks/useSmartSessionEntryScroll'

type EventLike = { id: string; parentToolUseId: string | undefined }

function makeEvents(...ids: string[]): ConversationEvent[] {
	return ids.map((id) => ({ id, parentToolUseId: undefined }) as EventLike) as unknown as ConversationEvent[]
}

function baseOpts(overrides: Partial<UseSmartSessionEntryScrollOptions> = {}): UseSmartSessionEntryScrollOptions {
	return {
		sessionId: 'session-A',
		hasEvents: true,
		isSessionReady: true,
		isSessionLoading: false,
		approvalsReady: true,
		oldestPendingApprovalEventId: null,
		events: makeEvents('e1', 'e2'),
		scrollToPendingApprovalEvent: vi.fn(() => {}),
		jumpToBottom: vi.fn(() => {}),
		...overrides,
	}
}

let animationFrames: Array<{ id: number; callback: FrameRequestCallback }> = []
let nextAnimationFrameId = 1

function flushAnimationFrames(count = 2) {
	act(() => {
		for (let frame = 0; frame < count; frame++) {
			const callbacks = animationFrames
			animationFrames = []
			callbacks.forEach(({ callback }) => callback(frame * 16))
		}
	})
}

describe('useSmartSessionEntryScroll', () => {
	beforeEach(() => {
		animationFrames = []
		nextAnimationFrameId = 1
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			const id = nextAnimationFrameId++
			animationFrames.push({ id, callback })
			return id
		})
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			animationFrames = animationFrames.filter((frame) => frame.id !== id)
		})
	})

	afterEach(() => vi.unstubAllGlobals())

	test('fires jumpToBottom once when gate is satisfied with no pending approval', () => {
		const jumpToBottom = vi.fn(() => {})
		const scrollToPendingApprovalEvent = vi.fn(() => {})
		renderHook(() => useSmartSessionEntryScroll(baseOpts({ jumpToBottom, scrollToPendingApprovalEvent })))
		flushAnimationFrames()
		expect(jumpToBottom).toHaveBeenCalledTimes(1)
		expect(scrollToPendingApprovalEvent).toHaveBeenCalledTimes(0)
	})

	test('fires scrollToPendingApprovalEvent once when a root-level pending approval exists', () => {
		const jumpToBottom = vi.fn(() => {})
		const scrollToPendingApprovalEvent = vi.fn(() => {})
		renderHook(() =>
			useSmartSessionEntryScroll(
				baseOpts({
					oldestPendingApprovalEventId: 'approval-1',
					events: makeEvents('e1', 'approval-1'),
					jumpToBottom,
					scrollToPendingApprovalEvent,
				}),
			),
		)
		flushAnimationFrames()
		expect(scrollToPendingApprovalEvent).toHaveBeenCalledTimes(1)
		expect(scrollToPendingApprovalEvent).toHaveBeenCalledWith('approval-1')
		expect(jumpToBottom).toHaveBeenCalledTimes(0)
	})

	test('does not re-fire when an unrelated dep changes within the same sessionId', () => {
		const jumpToBottom = vi.fn(() => {})
		const { rerender } = renderHook((opts: UseSmartSessionEntryScrollOptions) => useSmartSessionEntryScroll(opts), {
			initialProps: baseOpts({ jumpToBottom }),
		})
		flushAnimationFrames()
		expect(jumpToBottom).toHaveBeenCalledTimes(1)

		// New events array reference, same sessionId — must not re-fire.
		rerender(baseOpts({ jumpToBottom, events: makeEvents('e1', 'e2', 'e3') }))
		expect(jumpToBottom).toHaveBeenCalledTimes(1)
	})

	test('re-arms and fires again when sessionId changes and the gate is satisfied for the new session', () => {
		const jumpToBottom = vi.fn(() => {})
		const { rerender } = renderHook((opts: UseSmartSessionEntryScrollOptions) => useSmartSessionEntryScroll(opts), {
			initialProps: baseOpts({ sessionId: 'session-A', jumpToBottom }),
		})
		flushAnimationFrames()
		expect(jumpToBottom).toHaveBeenCalledTimes(1)

		// Navigate to a different session — guard must re-arm and fire again.
		rerender(baseOpts({ sessionId: 'session-B', jumpToBottom }))
		flushAnimationFrames()
		expect(jumpToBottom).toHaveBeenCalledTimes(2)
	})

	test('does not fire while the gate is unsatisfied, regardless of sessionId changes', () => {
		const jumpToBottom = vi.fn(() => {})
		const scrollToPendingApprovalEvent = vi.fn(() => {})
		const { rerender } = renderHook((opts: UseSmartSessionEntryScrollOptions) => useSmartSessionEntryScroll(opts), {
			initialProps: baseOpts({
				sessionId: 'session-A',
				hasEvents: false,
				events: makeEvents(),
				jumpToBottom,
				scrollToPendingApprovalEvent,
			}),
		})
		expect(jumpToBottom).toHaveBeenCalledTimes(0)

		// Change sessionId while gate still unsatisfied — must remain silent.
		rerender(
			baseOpts({
				sessionId: 'session-B',
				hasEvents: false,
				events: makeEvents(),
				jumpToBottom,
				scrollToPendingApprovalEvent,
			}),
		)
		expect(jumpToBottom).toHaveBeenCalledTimes(0)
		expect(scrollToPendingApprovalEvent).toHaveBeenCalledTimes(0)
	})
})
