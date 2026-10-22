import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { PtyCreateError, PtyEvent, PtyNotFoundError, PtyOperationError } from '../src/desktop-rpc.js'

describe('PTY contracts', () => {
	it('round-trips output and exit events', async () => {
		const events = [
			{ event: 'output', data: { data: [0, 1, 127, 255] } },
			{ event: 'exit', data: { code: null } },
			{ event: 'exit', data: { code: 7 } },
		] as const
		for (const event of events) {
			const encoded = await Effect.runPromise(Schema.encodeEffect(PtyEvent)(event))
			await expect(Effect.runPromise(Schema.decodeUnknownEffect(PtyEvent)(encoded))).resolves.toEqual(event)
		}
	})

	it('rejects malformed events', async () => {
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(PtyEvent)({ event: 'output', data: { data: ['bad'] } })),
		).rejects.toBeDefined()
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(PtyEvent)({ event: 'unknown', data: {} })),
		).rejects.toBeDefined()
	})

	it('round-trips caller-actionable operation errors', async () => {
		const errors = [
			new PtyCreateError({ message: 'spawn failed' }),
			new PtyNotFoundError({ ptyId: 'pty-1', message: 'missing' }),
			new PtyOperationError({ ptyId: 'pty-1', operation: 'resize', message: 'invalid size' }),
		]
		for (const error of errors) {
			const encoded = await Effect.runPromise(Schema.encodeEffect(Schema.Any)(error))
			expect(encoded).toMatchObject({ _tag: error._tag })
		}
	})
})
