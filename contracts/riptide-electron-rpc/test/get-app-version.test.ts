import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { AppVersion } from '../src/desktop-rpc.js'

describe('GetAppVersion contract', () => {
	it('decodes string versions and rejects non-strings', async () => {
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(AppVersion)('1.2.3'))).resolves.toBe('1.2.3')
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(AppVersion)(123))).rejects.toBeDefined()
	})
})
