import { describe, expect, it } from '@effect/vitest'
import {
	FOLD_MODEL_PROVIDER_VALUES,
	FoldModelProvider,
	FoldModelProviderZodSchema,
	SELECTABLE_MODEL_PROVIDER_VALUES,
	SelectableModelProvider,
	SelectableModelProviderZodSchema,
} from '@humanlayer/schemas/model-provider'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

describe('ModelProviderSchema', () => {
	for (const provider of SELECTABLE_MODEL_PROVIDER_VALUES) {
		it.effect(`decodes ${provider} with Effect`, () =>
			Effect.gen(function* () {
				expect(yield* Schema.decodeEffect(SelectableModelProvider)(provider)).toBe(provider)
			}),
		)

		it(`parses ${provider} with Zod`, () => {
			expect(SelectableModelProviderZodSchema.parse(provider)).toBe(provider)
		})
	}

	it('keeps Fold providers as a validated subset', () => {
		expect(FOLD_MODEL_PROVIDER_VALUES).toEqual(['codex', 'xai'])
		expect(FoldModelProviderZodSchema.safeParse('xai').success).toBe(true)
		expect(FoldModelProviderZodSchema.safeParse('anthropic').success).toBe(false)
		expect(Schema.is(FoldModelProvider)('codex')).toBe(true)
		expect(Schema.is(FoldModelProvider)('firepass')).toBe(false)
	})

	it('does not claim to model open-ended providers from non-launcher agents', () => {
		expect(SelectableModelProviderZodSchema.safeParse('openai').success).toBe(false)
		expect(Schema.is(SelectableModelProvider)('openai')).toBe(false)
	})
})
