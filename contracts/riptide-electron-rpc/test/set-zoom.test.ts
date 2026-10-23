import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { SetZoomPayload, WindowZoomSetError } from '../src/desktop-rpc.js'

describe('SetZoom contract', () => {
	it('decodes numeric zoom factors and rejects other payloads', async () => {
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(SetZoomPayload)({ zoomFactor: 1.25 })),
		).resolves.toEqual({
			zoomFactor: 1.25,
		})
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(SetZoomPayload)({ zoomFactor: '1.25' })),
		).rejects.toBeDefined()
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(SetZoomPayload)({ zoomFactor: 11 })),
		).rejects.toBeDefined()
	})

	it('serializes the expected platform error', async () => {
		const error = new WindowZoomSetError({ message: 'failed' })
		const encoded = await Effect.runPromise(Schema.encodeEffect(WindowZoomSetError)(error))
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(WindowZoomSetError)(encoded))).resolves.toEqual(error)
	})
})
