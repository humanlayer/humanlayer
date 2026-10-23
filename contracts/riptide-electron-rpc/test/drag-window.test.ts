import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { DragWindow, WindowDragError } from '../src/desktop-rpc.js'

describe('DragWindow contract', () => {
	it('has no window identity or coordinates in its input and returns void', () => {
		expect(Schema.decodeUnknownSync(DragWindow.payloadSchema)(undefined)).toBeUndefined()
		// Effect v4 Void discards any supplied value rather than rejecting it.
		expect(Schema.decodeUnknownSync(DragWindow.payloadSchema)({ windowId: 123, x: 10, y: 20 })).toBeUndefined()
		expect(Schema.decodeUnknownSync(DragWindow.successSchema)(undefined)).toBeUndefined()
	})

	for (const reason of ['unavailable', 'busy', 'failed'] as const) {
		it(`round-trips the ${reason} error`, async () => {
			const error = new WindowDragError({ reason, message: 'Window drag refused' })
			const encoded = await Effect.runPromise(Schema.encodeEffect(WindowDragError)(error))
			expect(await Effect.runPromise(Schema.decodeUnknownEffect(WindowDragError)(encoded))).toEqual(error)
		})
	}
})
