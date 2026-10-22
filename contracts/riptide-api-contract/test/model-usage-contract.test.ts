import { ModelTokenUsage } from '@humanlayer/schemas/effect/model-usage'
import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'

import { ModelTokenUsageSchema, UpdateSessionInputSchema } from '../src/daemon/sessions/update'
import { RecordSessionUsageInputSchema } from '../src/daemon/sessions/usage-record'

const validUsage = {
	input_tokens: 100,
	output_tokens: 20,
	cache_read_input_tokens: 30,
	cache_creation_input_tokens: 10,
}

describe('model usage contract parity', () => {
	test('Effect and Zod accept the conventional usage fixture', () => {
		expect(Schema.decodeUnknownSync(ModelTokenUsage)(validUsage)).toEqual(validUsage)
		expect(ModelTokenUsageSchema.parse(validUsage)).toEqual(validUsage)
		expect(
			UpdateSessionInputSchema.safeParse({
				sessionId: '019b049c-950d-7baa-b9a8-b9364599319b',
				modelUsage: { model: validUsage },
			}).success,
		).toBe(true)
	})

	test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('Effect and Zod reject token count %s', (value) => {
		expect(() => Schema.decodeUnknownSync(ModelTokenUsage)({ ...validUsage, input_tokens: value })).toThrow()
		expect(ModelTokenUsageSchema.safeParse({ ...validUsage, input_tokens: value }).success).toBe(false)
	})

	test('daemon usage records accept fold_run but not backfill', () => {
		const input = {
			sessionId: '019b049c-950d-7baa-b9a8-b9364599319b',
			reportKey: 'event-1',
			source: 'fold_run',
			occurredAt: 1,
			entries: [{ model: 'gpt-5.6-sol', tokens: validUsage }],
		}
		expect(RecordSessionUsageInputSchema.safeParse(input).success).toBe(true)
		expect(RecordSessionUsageInputSchema.safeParse({ ...input, source: 'backfill' }).success).toBe(false)
	})
})
