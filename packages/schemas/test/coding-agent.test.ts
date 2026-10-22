import { describe, expect, it } from '@effect/vitest'
import {
	type CodingAgent,
	CODING_AGENT_VALUES,
	CodingAgentEffectSchema,
	CodingAgentZodSchema,
	type EffectCodingAgent,
	isLaunchableCodingAgent,
	type ZodCodingAgent,
} from '@humanlayer/schemas/coding-agent'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

describe('CodingAgentSchema', () => {
	for (const codingAgent of CODING_AGENT_VALUES) {
		it.effect(`decodes ${codingAgent} with Effect`, () =>
			Effect.gen(function* () {
				expect(yield* Schema.decodeEffect(CodingAgentEffectSchema)(codingAgent)).toBe(codingAgent)
			}),
		)

		it(`parses ${codingAgent} with Zod`, () => {
			expect(CodingAgentZodSchema.parse(codingAgent)).toBe(codingAgent)
		})
	}

	it.effect('rejects invalid values with Effect', () =>
		Effect.gen(function* () {
			for (const value of ['unknown', '', 1, null, {}]) {
				expect((yield* Effect.exit(Schema.decodeUnknownEffect(CodingAgentEffectSchema)(value)))._tag).toBe(
					'Failure',
				)
			}
		}),
	)

	it('rejects invalid values with Zod', () => {
		for (const value of ['unknown', '', 1, null, {}]) {
			expect(CodingAgentZodSchema.safeParse(value).success).toBe(false)
		}
	})

	it('extracts equivalent canonical types from both schemas', () => {
		const fromEffect: EffectCodingAgent = 'fold'
		const fromZod: ZodCodingAgent = fromEffect
		const canonical: CodingAgent = fromZod

		expect(canonical).toBe('fold')
	})

	it('tells agents the daemon runs from ones mirrored from a terminal', () => {
		expect(['claude', 'codelayer', 'fold'].every(isLaunchableCodingAgent)).toBe(true)
		expect(['pi', 'opencode', 'codex', null, undefined].some(isLaunchableCodingAgent)).toBe(false)
	})
})
