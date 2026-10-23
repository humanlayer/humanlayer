import { codexModel } from '@humanlayer/fold-codex'
import { OpenAiReasoningSummary, openaiModel } from '@humanlayer/fold-core'
import { xaiModel } from '@humanlayer/fold-xai'
import { Config, Effect, Option } from 'effect'

import type { FoldModelSelection } from './fold-sessions.schemas'

const CUSTOM_CODEX_VARIABLES = [
	'CODELAYER_CODEX_BASE_URL',
	'CODELAYER_CODEX_API_KEY',
	'CODELAYER_CODEX_API_KEY_HEADER',
	'CODELAYER_CODEX_MODEL',
	'CODELAYER_CODEX_REASONING_SUMMARY',
] as const

const customCodexSettings = Config.all({
	baseUrl: Config.String('CODELAYER_CODEX_BASE_URL').pipe(Config.map((url) => url.replace(/\/responses\/?$/, ''))),
	apiKey: Config.Redacted('CODELAYER_CODEX_API_KEY'),
	apiKeyHeader: Config.option(Config.String('CODELAYER_CODEX_API_KEY_HEADER')),
	model: Config.option(Config.String('CODELAYER_CODEX_MODEL')),
	reasoningSummary: Config.option(Config.schema(OpenAiReasoningSummary, 'CODELAYER_CODEX_REASONING_SUMMARY')),
})

// `Config.option` over the whole group would treat a partial setup as absent; any custom variable must
// instead require the base URL and API key.
const customCodexConfiguration = Config.all(
	CUSTOM_CODEX_VARIABLES.map((name) => Config.option(Config.String(name))),
).pipe(
	Config.flatMap((values) =>
		values.some(Option.isSome)
			? customCodexSettings.pipe(Config.map(Option.some))
			: Config.succeed(Option.none<Config.Success<typeof customCodexSettings>>()),
	),
)

export const makeFoldModel = Effect.fn('fold.make_model')(function* (selection: FoldModelSelection) {
	if (selection.provider === 'xai') return xaiModel({ model: selection.model, reasoning: selection.reasoning })

	const customCodex = yield* customCodexConfiguration
	if (Option.isNone(customCodex)) return codexModel({ model: selection.model, reasoning: selection.reasoning })

	const custom = customCodex.value
	return openaiModel({
		model: Option.getOrElse(custom.model, () => selection.model),
		apiKey: custom.apiKey,
		baseUrl: custom.baseUrl,
		apiKeyHeader: Option.getOrUndefined(custom.apiKeyHeader),
		reasoning: selection.reasoning,
		reasoningSummary: Option.getOrUndefined(custom.reasoningSummary),
	})
})
