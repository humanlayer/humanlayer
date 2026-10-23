import { describe, expect, it } from '@effect/vitest'
import { DaemonStage } from '@humanlayer/schemas/effect/daemon'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

describe('DaemonStage', () => {
	for (const stage of ['local', 'dev', 'beta', 'prod'] as const) {
		it.effect(`decodes ${stage}`, () =>
			Effect.gen(function* () {
				const input: unknown = stage
				expect(yield* Schema.decodeUnknownEffect(DaemonStage)(input)).toBe(stage)
			}),
		)
	}

	it.effect('rejects unsupported and non-string values', () =>
		Effect.gen(function* () {
			for (const value of ['stable', 'test', 1, null, {}]) {
				expect((yield* Effect.exit(Schema.decodeUnknownEffect(DaemonStage)(value)))._tag).toBe('Failure')
			}
		}),
	)
})
