import { describe, expect, it } from '@effect/vitest'
import { FetchError } from '@electric-sql/client'
import { ElectricFetchError } from '@humanlayer/schemas/effect/electric/fetch-error'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'

describe('ElectricFetchError', () => {
	it.effect('decodes a real Electric FetchError and strips extra fields', () =>
		Effect.gen(function* () {
			const error = new FetchError(
				401,
				'Unauthorized',
				{ error: 'unauthorized' },
				{ 'content-type': 'application/json' },
				'https://electric.example/v1/shape',
			)

			const decoded = yield* Schema.decodeUnknownEffect(ElectricFetchError)(error)

			expect(decoded).toEqual({
				name: 'FetchError',
				status: 401,
				url: 'https://electric.example/v1/shape',
			})
			expect(decoded).not.toHaveProperty('headers')
			expect(decoded).not.toHaveProperty('json')
			expect(decoded).not.toHaveProperty('text')
		}),
	)
})
