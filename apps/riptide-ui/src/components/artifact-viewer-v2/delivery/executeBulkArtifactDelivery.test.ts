import { RESOLVED_COMMENTS_NOTE } from '@humanlayer/ui/lib/comment-utils'
import { describe, expect, test, vi } from 'vitest'

import { executeBulkArtifactDelivery, type DeliveryAcceptance } from './executeBulkArtifactDelivery'

const feedback = { markdown: '<comments>\nformatted feedback\n</comments>', rootCommentIds: ['root-1', 'root-2'] }

describe('executeBulkArtifactDelivery', () => {
	test.each([
		[{ kind: 'send', sessionId: 'session-1' } as const, 'send', { kind: 'continued', transactionId: 'tx-1' }],
		[{ kind: 'queue', sessionId: 'session-1' } as const, 'queue', { kind: 'queued', transactionId: 'tx-2' }],
	])('dispatches a $kind capability with the matching intent', async (capability, expectedIntent, acceptance) => {
		const dispatch = vi.fn(async () => acceptance as DeliveryAcceptance)
		const confirm = vi.fn(async () => {})
		const resolveBatch = vi.fn(async () => {})

		const result = await executeBulkArtifactDelivery({
			capability,
			mode: 'send',
			feedback,
			dispatch,
			confirm,
			resolveBatch,
		})

		expect(result).toEqual({ kind: 'delivered' })
		expect(dispatch).toHaveBeenCalledWith(expectedIntent, feedback.markdown)
		expect(confirm).toHaveBeenCalledWith(acceptance)
		expect(resolveBatch).not.toHaveBeenCalled()
	})

	test('resolves only captured roots after delivery acceptance', async () => {
		const order: string[] = []
		const dispatch = vi.fn(async () => {
			order.push('dispatch')
			return { kind: 'continued', transactionId: 'tx-1' } as const
		})
		const result = await executeBulkArtifactDelivery({
			capability: { kind: 'send', sessionId: 'session-1' },
			mode: 'send-and-resolve',
			feedback,
			dispatch,
			confirm: async () => {
				order.push('accepted')
			},
			resolveBatch: async (rootIds) => {
				order.push(`resolve:${rootIds.join(',')}`)
			},
		})

		expect(result).toEqual({ kind: 'delivered-and-resolved' })
		expect(dispatch).toHaveBeenCalledWith(
			'send',
			`<comments>\nformatted feedback\n${RESOLVED_COMMENTS_NOTE}\n</comments>`,
		)
		expect(order).toEqual(['dispatch', 'accepted', 'resolve:root-1,root-2'])
	})

	test('does not resolve after rejection', async () => {
		const confirm = vi.fn(async () => {})
		const resolveBatch = vi.fn(async () => {})
		const result = await executeBulkArtifactDelivery({
			capability: { kind: 'queue', sessionId: 'session-1' },
			mode: 'send-and-resolve',
			feedback,
			dispatch: async () => ({ kind: 'rejected', reason: 'forbidden' }),
			confirm,
			resolveBatch,
		})

		expect(result).toEqual({ kind: 'failed', message: 'Delivery rejected: forbidden' })
		expect(confirm).not.toHaveBeenCalled()
		expect(resolveBatch).not.toHaveBeenCalled()
	})

	test('inserts the resolved note before the outer closing tag when comment text contains the same tag', async () => {
		const dispatch = vi.fn(async () => ({ kind: 'continued', transactionId: 'tx-1' }) as const)
		await executeBulkArtifactDelivery({
			capability: { kind: 'send', sessionId: 'session-1' },
			mode: 'send-and-resolve',
			feedback: {
				markdown: '<comments>\n<comment>Keep </comments> literal</comment>\n</comments>',
				rootCommentIds: ['root-1'],
			},
			dispatch,
			confirm: async () => {},
			resolveBatch: async () => {},
		})

		expect(dispatch).toHaveBeenCalledWith(
			'send',
			`<comments>\n<comment>Keep </comments> literal</comment>\n${RESOLVED_COMMENTS_NOTE}\n</comments>`,
		)
	})

	test('reports partial success and preserves captured IDs when resolution fails', async () => {
		const result = await executeBulkArtifactDelivery({
			capability: { kind: 'send', sessionId: 'session-1' },
			mode: 'send-and-resolve',
			feedback,
			dispatch: async () => ({ kind: 'continued', transactionId: 'tx-1' }),
			confirm: async () => {},
			resolveBatch: async () => {
				throw new Error('resolve failed')
			},
		})

		expect(result).toEqual({ kind: 'delivered-resolution-failed', rootCommentIds: feedback.rootCommentIds })
	})
})
