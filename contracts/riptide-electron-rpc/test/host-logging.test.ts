import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { HostLogAccessError, HostLogLevel, WriteHostLogPayload } from '../src/desktop-rpc.js'

describe('host logging contract', () => {
	it('decodes supported levels and rejects unknown levels', async () => {
		for (const level of HostLogLevel.literals) {
			await expect(
				Effect.runPromise(
					Schema.decodeUnknownEffect(WriteHostLogPayload)({ level, message: 'renderer message' }),
				),
			).resolves.toEqual({ level, message: 'renderer message' })
		}
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(WriteHostLogPayload)({ level: 'verbose', message: 'nope' })),
		).rejects.toBeDefined()
	})

	it('serializes log access failures', async () => {
		const error = new HostLogAccessError({ message: 'denied' })
		const encoded = await Effect.runPromise(Schema.encodeEffect(HostLogAccessError)(error))
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(HostLogAccessError)(encoded))).resolves.toEqual(error)
	})
})
