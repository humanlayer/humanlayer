import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import {
	ExternalUrlNotAllowedError,
	ExternalUrlOpenError,
	OpenExternalUrlError,
	OpenExternalUrlPayload,
} from '../src/desktop-rpc.js'

describe('OpenExternalUrl contract', () => {
	it('decodes payloads and rejects non-string URLs', async () => {
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(OpenExternalUrlPayload)({ url: 'https://example.com' })),
		).resolves.toEqual({
			url: 'https://example.com',
		})
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(OpenExternalUrlPayload)({ url: 42 })),
		).rejects.toBeDefined()
	})

	it('round-trips every tagged expected error', async () => {
		const errors = [
			new ExternalUrlNotAllowedError({ message: 'blocked' }),
			new ExternalUrlOpenError({ message: 'failed' }),
		]
		for (const error of errors) {
			const encoded = await Effect.runPromise(Schema.encodeEffect(OpenExternalUrlError)(error))
			await expect(Effect.runPromise(Schema.decodeUnknownEffect(OpenExternalUrlError)(encoded))).resolves.toEqual(
				error,
			)
		}
	})
})
