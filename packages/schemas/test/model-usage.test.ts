import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import {
	contextOccupancyTokens,
	ModelTokenUsage,
	SessionModelUsage,
	totalPromptTokens,
} from '../src/effect/model-usage'

describe('model usage schemas', () => {
	it('decodes conventional token usage synchronously', () => {
		const usage = Schema.decodeUnknownSync(ModelTokenUsage)({
			input_tokens: 100,
			output_tokens: 20,
			cache_read_input_tokens: 30,
			cache_creation_input_tokens: 10,
		})

		expect(totalPromptTokens(usage)).toBe(140)
		expect(contextOccupancyTokens(usage)).toBe(160)
		expect(Schema.decodeUnknownSync(SessionModelUsage)({ model: usage })).toEqual({ model: usage })
	})

	it.effect('decodes in Effect and rejects invalid token counts', () =>
		Effect.gen(function* () {
			const valid = yield* Schema.decodeUnknownEffect(ModelTokenUsage)({ input_tokens: 0, output_tokens: 1 })
			expect(valid).toEqual({ input_tokens: 0, output_tokens: 1 })

			for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
				const exit = yield* Effect.exit(
					Schema.decodeUnknownEffect(ModelTokenUsage)({ input_tokens: value, output_tokens: 1 }),
				)
				expect(exit._tag).toBe('Failure')
			}
		}),
	)
})
