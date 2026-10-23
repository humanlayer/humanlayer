import { describe, expect, test, vi } from 'vitest'

import { executeDiffFeedbackDelivery } from './executeDiffFeedbackDelivery'

const feedback = { text: 'editor\n\n<diff_comments />', rootCommentIds: ['root-1'] }
const editorCapture = { id: 'capture-1', text: 'editor' }

describe('executeDiffFeedbackDelivery', () => {
	test('confirms a ready send before clearing captured text and resolving exact roots', async () => {
		const calls: string[] = []
		const result = await executeDiffFeedbackDelivery({
			intent: 'send',
			mode: 'send-and-resolve',
			feedback,
			editorCapture,
			dispatch: async (intent, text) => {
				calls.push(`dispatch:${intent}:${text}`)
				return { kind: 'continued', transactionId: 'tx-1' }
			},
			confirm: async () => {
				calls.push('confirm')
			},
			clearEditorIfUnchanged: () => {
				calls.push('clear')
			},
			resolveBatch: async (ids) => {
				calls.push(`resolve:${ids.join(',')}`)
			},
		})

		expect(result).toEqual({ kind: 'delivered-and-resolved' })
		expect(calls).toEqual(['dispatch:send:editor\n\n<diff_comments />', 'confirm', 'clear', 'resolve:root-1'])
	})

	test('queues running-session feedback and leaves roots open in send mode', async () => {
		const resolveBatch = vi.fn(async () => {})
		const result = await executeDiffFeedbackDelivery({
			intent: 'queue',
			mode: 'send',
			feedback,
			editorCapture,
			dispatch: async () => ({ kind: 'queued', transactionId: 'tx-2' }),
			confirm: async () => {},
			clearEditorIfUnchanged: () => {},
			resolveBatch,
		})

		expect(result).toEqual({ kind: 'delivered' })
		expect(resolveBatch).not.toHaveBeenCalled()
	})

	test('keeps editor text and roots when delivery fails', async () => {
		const clearEditorIfUnchanged = vi.fn()
		const resolveBatch = vi.fn(async () => {})
		const result = await executeDiffFeedbackDelivery({
			intent: 'send',
			mode: 'send-and-resolve',
			feedback,
			editorCapture,
			dispatch: async () => ({ kind: 'rejected', reason: 'unsupported state' }),
			confirm: async () => {},
			clearEditorIfUnchanged,
			resolveBatch,
		})

		expect(result).toEqual({ kind: 'failed', message: 'Delivery rejected: unsupported state' })
		expect(clearEditorIfUnchanged).not.toHaveBeenCalled()
		expect(resolveBatch).not.toHaveBeenCalled()
	})

	test('returns root IDs for resolve-only recovery without dispatching twice', async () => {
		const dispatch = vi.fn(async () => ({ kind: 'continued' as const, transactionId: 'tx-3' }))
		const result = await executeDiffFeedbackDelivery({
			intent: 'send',
			mode: 'send-and-resolve',
			feedback,
			editorCapture,
			dispatch,
			confirm: async () => {},
			clearEditorIfUnchanged: () => {},
			resolveBatch: async () => {
				throw new Error('resolve failed')
			},
		})

		expect(result).toEqual({ kind: 'delivered-resolution-failed', rootCommentIds: ['root-1'] })
		expect(dispatch).toHaveBeenCalledTimes(1)
	})
})
