import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	extractNextStepEffectWithService,
	NextStepExtractionError,
	NextStepExtractor,
} from './extract-next-step.effect'

describe('extractNextStepEffect', () => {
	it('returns mocked extraction results', async () => {
		const extraction = {
			parsedAt: 123,
			extraction: {
				type: 'next_step_found' as const,
				nextStepPrompt: 'use the rpi:create-research skill for .humanlayer/tasks/test',
				nextStepSummary: 'research: test',
				nextStepType: 'create-research' as const,
				taskReference: 'test',
			},
		}

		const result = await Effect.runPromise(
			extractNextStepEffectWithService('assistant message').pipe(
				Effect.provide(Layer.succeed(NextStepExtractor, { extract: async () => extraction })),
			),
		)

		expect(result).toEqual(extraction)
	})

	it('converts extractionError results into tagged failures', async () => {
		const result = await Effect.runPromise(
			extractNextStepEffectWithService('assistant message').pipe(
				Effect.provide(
					Layer.succeed(NextStepExtractor, {
						extract: async () => ({
							parsedAt: 123,
							extraction: { type: 'no_next_step' as const, reason: 'Extraction failed' },
							extractionError: 'model unavailable',
						}),
					}),
				),
				Effect.flip,
			),
		)

		expect(result).toBeInstanceOf(NextStepExtractionError)
		if (result instanceof NextStepExtractionError) {
			expect(result.message).toBe('model unavailable')
		}
	})
})
