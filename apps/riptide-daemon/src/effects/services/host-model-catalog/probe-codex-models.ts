import {
	CODEX_API_URL,
	CODEX_DEFAULT_CLIENT_VERSION,
	CodexAuthStore,
	codexAuthenticatedClient,
	layerCodexAuth,
	layerCodexAuthStore,
} from '@humanlayer/fold-codex'
import type { HostModelCatalogEntry } from '@humanlayer/schemas/zod/model-catalog'
import { Config, Duration, Effect, Layer, Option, Schema } from 'effect'
import { HttpClient } from 'effect/http'

import { CodexModelProbeError } from './host-model-catalog.errors'

const PROBE_TIMEOUT = Duration.seconds(10)

const CodexReasoningLevel = Schema.Union([Schema.String, Schema.Struct({ effort: Schema.String })])
const CodexServiceTier = Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })])

/** The subset of the Codex backend's `/models` row the catalog reads; unknown fields pass through. */
export const CodexBackendModel = Schema.Struct({
	slug: Schema.String,
	display_name: Schema.optionalKey(Schema.String),
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	default_reasoning_level: Schema.optionalKey(Schema.NullOr(Schema.String)),
	supported_reasoning_levels: Schema.optionalKey(Schema.Array(CodexReasoningLevel)),
	visibility: Schema.optionalKey(Schema.String),
	priority: Schema.optionalKey(Schema.Number),
	service_tiers: Schema.optionalKey(Schema.Array(CodexServiceTier)),
	context_window: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	effective_context_window_percent: Schema.optionalKey(Schema.Number),
})
export type CodexBackendModel = typeof CodexBackendModel.Type

const CodexModelsResponse = Schema.Struct({ models: Schema.Array(CodexBackendModel) })

const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95

function effortOf(level: typeof CodexReasoningLevel.Type): string {
	return typeof level === 'string' ? level : level.effort
}

function tierOf(tier: typeof CodexServiceTier.Type): string {
	return typeof tier === 'string' ? tier : tier.id
}

export function codexBackendModelToCatalogEntry(model: CodexBackendModel, isDefault: boolean): HostModelCatalogEntry {
	const percent = model.effective_context_window_percent ?? DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT
	const contextWindow =
		typeof model.context_window === 'number' && model.context_window > 0
			? Math.floor((model.context_window * percent) / 100)
			: undefined
	const effortLevels = (model.supported_reasoning_levels ?? []).map(effortOf).filter((level) => level.length > 0)
	const defaultEffort = model.default_reasoning_level?.trim() || undefined
	return {
		provider: 'codex',
		value: model.slug,
		label: model.display_name?.trim() || model.slug,
		description: model.description ?? undefined,
		isDefault,
		hidden: model.visibility !== 'list',
		effortLevels,
		defaultEffort: defaultEffort !== undefined && effortLevels.includes(defaultEffort) ? defaultEffort : undefined,
		supportsFastMode: (model.service_tiers ?? []).map(tierOf).includes('priority'),
		supportsAutoMode: false,
		contextWindow,
	}
}

/** Sorted by the backend's priority; the first visible row is the default, as in the Codex CLI. */
export function codexBackendModelsToCatalog(models: ReadonlyArray<CodexBackendModel>): HostModelCatalogEntry[] {
	const sorted = [...models].sort(
		(a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER),
	)
	const defaultSlug = (sorted.find((model) => model.visibility === 'list') ?? sorted[0])?.slug
	return sorted.map((model) => codexBackendModelToCatalogEntry(model, model.slug === defaultSlug))
}

const customCodexBackendConfigured = Config.option(Config.String('CODELAYER_CODEX_BASE_URL')).pipe(
	Config.map((url) => Option.isSome(Option.filter(url, (value) => value.trim().length > 0))),
)

/** Where fold keeps the Codex login; defaults to `~/.fold/auth.json` inside fold-codex. */
const codexAuthStorePath = Config.option(Config.String('FOLD_AUTH_PATH')).pipe(
	Config.map((path) => Option.filter(path, (value) => value.trim().length > 0)),
)

const modelsUrl = `${CODEX_API_URL}/models?client_version=${CODEX_DEFAULT_CLIENT_VERSION}`

const fetchCodexModels = Effect.gen(function* () {
	const stored = yield* (yield* CodexAuthStore).load
	if (Option.isNone(stored)) return yield* new CodexModelProbeError({ reason: 'not_logged_in' })

	const client = yield* codexAuthenticatedClient(yield* HttpClient.HttpClient)
	const response = yield* client.get(modelsUrl).pipe(
		Effect.mapError((cause) => new CodexModelProbeError({ reason: 'transport', cause })),
		Effect.timeoutOption(PROBE_TIMEOUT),
		Effect.flatMap(
			Option.match({
				onNone: () => Effect.fail(new CodexModelProbeError({ reason: 'timeout' })),
				onSome: Effect.succeed,
			}),
		),
	)
	if (response.status === 401 || response.status === 403) {
		return yield* new CodexModelProbeError({ reason: 'unauthorized', status: response.status })
	}
	if (response.status !== 200) {
		return yield* new CodexModelProbeError({ reason: 'status', status: response.status })
	}
	const body = yield* response.json.pipe(
		Effect.mapError((cause) => new CodexModelProbeError({ reason: 'malformed_response', cause })),
	)
	const decoded = yield* Schema.decodeUnknownEffect(CodexModelsResponse)(body).pipe(
		Effect.mapError((cause) => new CodexModelProbeError({ reason: 'malformed_response', cause })),
	)
	return codexBackendModelsToCatalog(decoded.models)
})

/**
 * Asks the Codex backend which models the stored Codex login can use, with the same credential
 * store and refresh path sessions use. A custom backend is skipped: it is not the Codex catalog.
 */
export const probeCodexModels = Effect.fn('host_model_catalog.probe_codex')(function* () {
	if (yield* customCodexBackendConfigured) {
		return yield* new CodexModelProbeError({ reason: 'custom_backend' })
	}
	const authStore = layerCodexAuthStore(
		Option.match(yield* codexAuthStorePath, { onNone: () => ({}), onSome: (path) => ({ path }) }),
	)
	return yield* fetchCodexModels.pipe(Effect.provide(layerCodexAuth().pipe(Layer.provideMerge(authStore))))
})
