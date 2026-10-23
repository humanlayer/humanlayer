import type { ModelInfo, query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import type { HostModelCatalogEntry } from '@humanlayer/schemas/zod/model-catalog'
import { Duration, Effect, Option } from 'effect'

import { ClaudeModelProbeError } from './host-model-catalog.errors'

export type ClaudeQueryFactory = typeof claudeQuery

const PROBE_TIMEOUT = Duration.seconds(10)

async function* emptyPrompt() {}

/** "1M" and "200K" are context windows, not versions. */
const CONTEXT_WINDOW_TOKEN = /\b\d+(?:\.\d+)?[MK]\b/gi
const CONTAINS_VERSION = /\d/

function carriesVersion(text: string): boolean {
	return CONTAINS_VERSION.test(text.replace(CONTEXT_WINDOW_TOKEN, ''))
}

// "Opus 5.5 with 1M context" and "Opus (1M context)" -> "Opus 5.5 [1m]" / "Opus [1m]", so the row
// stays on one line in the picker.
const CONTEXT_WINDOW_PHRASE = /\s*\(?(?:with\s+)?(\d+(?:\.\d+)?[MK])\s+context(?:\s+window)?\)?/i

function compactContextWindow(label: string): string {
	return label.replace(CONTEXT_WINDOW_PHRASE, (_match, size: string) => ` [${size.toLowerCase()}]`).trim()
}

/**
 * The CLI labels its aliases by family only ("Opus", "Opus (1M context)") and keeps the version
 * in the description ("Opus 5.5 with 1M context · Best for…"). The picker must show which version
 * an alias runs today, so the description's leading segment wins when the display name carries
 * no version.
 */
export function claudeModelLabel(info: Pick<ModelInfo, 'value' | 'displayName' | 'description'>): string {
	const displayName = info.displayName.trim()
	if (carriesVersion(displayName)) return compactContextWindow(displayName)
	const described = info.description?.split(' · ')[0]?.trim() ?? ''
	if (carriesVersion(described)) return compactContextWindow(described)
	return compactContextWindow(displayName) || info.value
}

export function claudeModelInfoToCatalogEntry(info: ModelInfo, isDefault: boolean): HostModelCatalogEntry {
	return {
		provider: 'anthropic',
		value: info.value,
		resolvedModel: info.resolvedModel,
		label: claudeModelLabel(info),
		description: info.description,
		isDefault,
		hidden: false,
		effortLevels: info.supportsEffort ? (info.supportedEffortLevels ?? []).filter((level) => level.length > 0) : [],
		supportsFastMode: info.supportsFastMode === true,
		supportsAutoMode: info.supportsAutoMode === true,
	}
}

/** The CLI's `default` row is an alias; the model it resolves to becomes the default entry. */
export function claudeModelInfosToCatalog(infos: ReadonlyArray<ModelInfo>): HostModelCatalogEntry[] {
	const defaultRow = infos.find((info) => info.value === 'default')
	return infos
		.filter((info) => info.value !== 'default')
		.map((info) =>
			claudeModelInfoToCatalogEntry(
				info,
				defaultRow !== undefined &&
					info.resolvedModel !== undefined &&
					info.resolvedModel === defaultRow.resolvedModel,
			),
		)
}

export interface ProbeClaudeModelsInput {
	readonly query: ClaudeQueryFactory
	readonly claudePath: string
	readonly cwd: string
}

/**
 * Spawns a throwaway Claude Code query against the installed binary, asks it which models it
 * offers, and closes it. The binary is the user's own install, so the answer tracks their
 * Claude Code version rather than the daemon's build.
 */
export const probeClaudeModels = Effect.fn('host_model_catalog.probe_claude')(function* (
	input: ProbeClaudeModelsInput,
) {
	const infos = yield* Effect.acquireUseRelease(
		Effect.try({
			try: () =>
				input.query({
					prompt: emptyPrompt(),
					options: { pathToClaudeCodeExecutable: input.claudePath, cwd: input.cwd },
				}),
			catch: (cause) => new ClaudeModelProbeError({ operation: 'spawn', cause }),
		}),
		(sdkQuery) =>
			Effect.tryPromise({
				try: () => sdkQuery.supportedModels(),
				catch: (cause) => new ClaudeModelProbeError({ operation: 'supported_models', cause }),
			}),
		(sdkQuery) => Effect.sync(() => sdkQuery.close()),
	).pipe(
		Effect.timeoutOption(PROBE_TIMEOUT),
		Effect.flatMap(
			Option.match({
				onNone: () => Effect.fail(new ClaudeModelProbeError({ operation: 'timeout' })),
				onSome: Effect.succeed,
			}),
		),
	)
	return claudeModelInfosToCatalog(infos)
})
