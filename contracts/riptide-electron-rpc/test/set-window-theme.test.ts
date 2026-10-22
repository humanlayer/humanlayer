import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { SetWindowThemePayload, WindowThemeSetError } from '../src/desktop-rpc.js'

describe('SetWindowTheme contract', () => {
	it('accepts only light and dark', async () => {
		for (const theme of ['light', 'dark']) {
			await expect(
				Effect.runPromise(Schema.decodeUnknownEffect(SetWindowThemePayload)({ theme })),
			).resolves.toEqual({ theme })
		}
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(SetWindowThemePayload)({ theme: 'system' })),
		).rejects.toBeDefined()
	})

	it('round-trips its schema-backed error', async () => {
		const error = new WindowThemeSetError({ message: 'failed' })
		const encoded = await Effect.runPromise(Schema.encodeEffect(WindowThemeSetError)(error))
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(WindowThemeSetError)(encoded))).resolves.toEqual(
			error,
		)
	})
})
