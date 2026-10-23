import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import {
	CheckClaudeInstalledError,
	ClaudeCheckError,
	ClaudeDiagnostic,
	ClaudeNotFoundError,
	ClaudeUpdateError,
	UpdateClaudeCodeError,
} from '../src/desktop-rpc.js'

describe('diagnostics contracts', () => {
	it('decodes Claude diagnostics and rejects unknown installation sources', async () => {
		const diagnostic = {
			path: '/Users/test/.local/bin/claude',
			version: '2.1.177 (Claude Code)',
			installationSource: 'native',
			isRecommendedPath: true,
			isVersionSupported: true,
		} as const

		await expect(Effect.runPromise(Schema.decodeUnknownEffect(ClaudeDiagnostic)(diagnostic))).resolves.toEqual(
			diagnostic,
		)
		await expect(
			Effect.runPromise(
				Schema.decodeUnknownEffect(ClaudeDiagnostic)({ ...diagnostic, installationSource: 'unknown-manager' }),
			),
		).rejects.toBeDefined()
	})

	it('round-trips every tagged diagnostics error', async () => {
		const checkErrors = [
			new ClaudeNotFoundError({ message: 'not found' }),
			new ClaudeCheckError({ message: 'check failed' }),
		]
		for (const error of checkErrors) {
			const encoded = await Effect.runPromise(Schema.encodeEffect(CheckClaudeInstalledError)(error))
			await expect(
				Effect.runPromise(Schema.decodeUnknownEffect(CheckClaudeInstalledError)(encoded)),
			).resolves.toEqual(error)
		}

		const updateErrors = [
			new ClaudeNotFoundError({ message: 'not found' }),
			new ClaudeUpdateError({ message: 'update failed' }),
		]
		for (const error of updateErrors) {
			const encoded = await Effect.runPromise(Schema.encodeEffect(UpdateClaudeCodeError)(error))
			await expect(
				Effect.runPromise(Schema.decodeUnknownEffect(UpdateClaudeCodeError)(encoded)),
			).resolves.toEqual(error)
		}
	})
})
