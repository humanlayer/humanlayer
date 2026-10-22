import { describe, expect, test } from 'vitest'

import { startDetachedPostRunCapture } from '@/agents/shared/run-session'

describe('shared session post-run lifecycle', () => {
	test('resolves shutdown coordination before detached pull-request capture finishes', async () => {
		const order: string[] = []
		let finishCapture: (() => void) | undefined
		const captureFinished = new Promise<void>((resolve) => {
			finishCapture = resolve
		})

		startDetachedPostRunCapture({
			resolveSessionCompletion: () => {
				order.push('shutdown-resolved')
			},
			capturePostRun: async () => {
				order.push('capture-started')
				await captureFinished
				order.push('capture-finished')
			},
			captureUnexpectedFailure: () => {
				order.push('capture-failed')
			},
		})

		expect(order).toEqual(['shutdown-resolved', 'capture-started'])
		finishCapture?.()
		await captureFinished
		await Promise.resolve()
		expect(order).toEqual(['shutdown-resolved', 'capture-started', 'capture-finished'])
	})
})
