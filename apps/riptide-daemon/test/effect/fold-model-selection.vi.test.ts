import { describe, expect, it } from '@effect/vitest'
import { Cause, ConfigProvider, Effect, Exit } from 'effect'

import { makeFoldModel } from '../../src/effects/services/fold-sessions/fold-model-selection'
import type { FoldModelSelection } from '../../src/effects/services/fold-sessions/fold-sessions.schemas'

const required = {
	CODELAYER_CODEX_BASE_URL: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses/',
	CODELAYER_CODEX_API_KEY: 'test-key',
}

const resolveModel = (selection: FoldModelSelection, configuration: Record<string, string>) =>
	makeFoldModel(selection).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(configuration))))

const codexSelection: FoldModelSelection = {
	provider: 'codex',
	model: 'gpt-5.6-sol',
	reasoning: 'medium',
}

describe('custom Fold Codex configuration', () => {
	it.effect('preserves canonical GPT-6 Sol and Luna Codex descriptors', () =>
		Effect.gen(function* () {
			for (const modelId of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna']) {
				const model = yield* resolveModel({ provider: 'codex', model: modelId, reasoning: 'max' }, {})

				expect(model.activeModel).toMatchObject({
					providerKind: 'codex',
					modelId,
					requestedReasoningLevel: 'max',
				})
			}
		}),
	)

	it.effect('uses saved Codex authentication when no custom settings exist', () =>
		Effect.gen(function* () {
			const model = yield* resolveModel(codexSelection, {})

			expect(model.activeModel.providerKind).toBe('codex')
		}),
	)

	it.effect('maps custom endpoint settings to an OpenAI-compatible model', () =>
		Effect.gen(function* () {
			const model = yield* resolveModel(codexSelection, {
				...required,
				CODELAYER_CODEX_API_KEY_HEADER: 'api-key',
				CODELAYER_CODEX_MODEL: 'azure-deployment',
				CODELAYER_CODEX_REASONING_SUMMARY: 'concise',
			})

			expect(model.activeModel).toMatchObject({
				providerKind: 'openai-compatible',
				modelId: 'azure-deployment',
				reasoningSummary: 'concise',
			})
			expect(model.provider).toMatchObject({
				_tag: 'openai-compatible',
				baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
				apiKeyHeader: 'api-key',
			})
		}),
	)

	it.effect('omits reasoning summaries by default for custom endpoints', () =>
		Effect.gen(function* () {
			const model = yield* resolveModel(codexSelection, required)

			expect(model.activeModel.providerKind).toBe('openai-compatible')
			if (model.activeModel.providerKind !== 'openai-compatible') return
			expect(model.activeModel.reasoningSummary).toBeUndefined()
		}),
	)

	it.effect('treats an empty reasoning summary as omitted', () =>
		Effect.gen(function* () {
			const model = yield* resolveModel(codexSelection, {
				...required,
				CODELAYER_CODEX_REASONING_SUMMARY: '',
			})

			expect(model.activeModel.providerKind).toBe('openai-compatible')
			if (model.activeModel.providerKind !== 'openai-compatible') return
			expect(model.activeModel.reasoningSummary).toBeUndefined()
		}),
	)

	it.effect('requires the base URL and API key when any custom setting exists', () =>
		Effect.gen(function* () {
			const missingBaseUrl = yield* resolveModel(codexSelection, {
				CODELAYER_CODEX_MODEL: 'deployment',
			}).pipe(Effect.exit)
			const missingApiKey = yield* resolveModel(codexSelection, {
				CODELAYER_CODEX_BASE_URL: required.CODELAYER_CODEX_BASE_URL,
			}).pipe(Effect.exit)

			expect(Exit.isFailure(missingBaseUrl)).toBe(true)
			expect(Exit.isFailure(missingApiKey)).toBe(true)
			if (Exit.isFailure(missingBaseUrl)) {
				expect(Cause.pretty(missingBaseUrl.cause)).toContain('CODELAYER_CODEX_BASE_URL')
			}
			if (Exit.isFailure(missingApiKey)) {
				expect(Cause.pretty(missingApiKey.cause)).toContain('CODELAYER_CODEX_API_KEY')
			}
		}),
	)

	it.effect('rejects unsupported reasoning summaries', () =>
		Effect.gen(function* () {
			const result = yield* resolveModel(codexSelection, {
				...required,
				CODELAYER_CODEX_REASONING_SUMMARY: 'unsupported',
			}).pipe(Effect.exit)

			expect(Exit.isFailure(result)).toBe(true)
			if (Exit.isFailure(result)) {
				expect(Cause.pretty(result.cause)).toContain('CODELAYER_CODEX_REASONING_SUMMARY')
			}
		}),
	)
})
