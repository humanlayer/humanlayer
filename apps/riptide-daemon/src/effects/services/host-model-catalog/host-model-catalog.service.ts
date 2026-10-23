import type { HostModelCatalog } from '@humanlayer/schemas/zod/model-catalog'
import { Context, Effect, Option } from 'effect'

/**
 * What this host's runtimes can run right now: the installed Claude Code binary's model list and
 * the Codex backend's model list, probed at startup and on a schedule. Consumers read
 * the latest snapshot; a provider that could not be probed is recorded as unavailable with a
 * reason rather than failing the whole catalog, so the picker can fall back per provider.
 */
export class HostModelCatalogSource extends Context.Service<
	HostModelCatalogSource,
	{
		/** The latest probe result, or none before the first probe has finished. */
		readonly snapshot: Effect.Effect<Option.Option<HostModelCatalog>>
		/** Runs both probes now and returns the new snapshot. Concurrent calls share one run. */
		readonly refresh: Effect.Effect<HostModelCatalog>
		/** Resolves once the first probe has produced a snapshot. */
		readonly awaitFirstProbe: Effect.Effect<void>
		/**
		 * Probes immediately, then every 30 minutes, for as long as the fiber runs.
		 * The daemon forks this once at startup; constructing the service alone touches nothing.
		 */
		readonly run: Effect.Effect<never>
	}
>()('HostModelCatalogSource') {}

/** The latest catalog when the source is part of the runtime, none otherwise or before the first probe. */
export const hostModelCatalogSnapshot: Effect.Effect<Option.Option<HostModelCatalog>> = Effect.serviceOption(
	HostModelCatalogSource,
).pipe(
	Effect.flatMap(
		Option.match({
			onNone: () => Effect.succeedNone,
			onSome: (source) => source.snapshot,
		}),
	),
)
