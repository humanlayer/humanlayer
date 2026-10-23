import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { OpenNewWindowError } from '../src/desktop-rpc.js'

describe('OpenNewWindow contract', () => {
	it('round-trips its schema-backed error', async () => {
		const error = new OpenNewWindowError({ message: 'failed' })
		const encoded = await Effect.runPromise(Schema.encodeEffect(OpenNewWindowError)(error))
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(OpenNewWindowError)(encoded))).resolves.toEqual(error)
	})
})
