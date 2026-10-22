import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { DirectoryPickerOperationError } from '../src/desktop-rpc.js'

describe('directory picker contract', () => {
	it('round-trips its schema-backed operation error', async () => {
		const error = new DirectoryPickerOperationError({ message: 'Could not open the directory picker' })
		const encoded = await Effect.runPromise(Schema.encodeEffect(DirectoryPickerOperationError)(error))

		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(DirectoryPickerOperationError)(encoded)),
		).resolves.toEqual(error)
	})
})
