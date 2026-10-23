import { Context, Effect, Layer } from 'effect'
import * as FileSystem from 'effect/FileSystem'

import {
	ConfiguredRepoTelemetry,
	GitRootResolver,
	loadConfiguredRepoContextEffect,
	type ResolvedConfiguredRepoContext,
} from './load-configured-repo-context'

export class ConfiguredRepoContext extends Context.Service<
	ConfiguredRepoContext,
	{
		loadForWorkspace: (args: {
			cwd: string
			sessionId: string
			workspaceDirectories?: string[]
			workspaceSourcePath?: string
		}) => Effect.Effect<ResolvedConfiguredRepoContext>
	}
>()('ConfiguredRepoContext') {}

export const ConfiguredRepoContextLive = Layer.effect(
	ConfiguredRepoContext,
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const git = yield* GitRootResolver
		const telemetry = yield* ConfiguredRepoTelemetry

		const dependencies = Layer.mergeAll(
			Layer.succeed(FileSystem.FileSystem, fileSystem),
			Layer.succeed(GitRootResolver, git),
			Layer.succeed(ConfiguredRepoTelemetry, telemetry),
		)

		return {
			loadForWorkspace: (args) => loadConfiguredRepoContextEffect(args).pipe(Effect.provide(dependencies)),
		}
	}),
)

export type { ResolvedConfiguredRepoContext }

export async function loadConfiguredRepoContext(args: {
	cwd: string
	sessionId: string
	workspaceDirectories?: string[]
	workspaceSourcePath?: string
}): Promise<ResolvedConfiguredRepoContext> {
	const { configuredRepoContextRuntime } = await import('./runtime')
	const service = await configuredRepoContextRuntime.runPromise(ConfiguredRepoContext)
	return configuredRepoContextRuntime.runPromise(service.loadForWorkspace(args))
}
