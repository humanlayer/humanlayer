import { Config, Context, Duration, Effect, Layer, Path } from 'effect'

interface RepositorySourceConfiguration {
	readonly root: string
	readonly cloneTimeout: Duration.Duration
	readonly gitEnvironment: Readonly<Record<string, string>>
}

// Internal configuration only; permits remain private to the cache layer.
export class RepositorySourceContext extends Context.Service<RepositorySourceContext, RepositorySourceConfiguration>()(
	'RepositorySourceContext',
) {}

export const RepositorySourceContextLive = Layer.effect(
	RepositorySourceContext,
	Effect.gen(function* () {
		const path = yield* Path.Path
		const home = yield* Config.String('HOME')
		const root = path.resolve(
			yield* Config.String('RIPTIDE_MANAGED_REPOSITORY_ROOT').pipe(
				Config.withDefault(path.join(home, '.humanlayer', 'repos')),
			),
		)
		const cloneTimeout = yield* Config.Duration('RIPTIDE_MANAGED_REPOSITORY_CLONE_TIMEOUT').pipe(
			Config.withDefault(Duration.minutes(10)),
		)
		return {
			root,
			cloneTimeout,
			gitEnvironment: {
				HOME: home,
				GIT_TERMINAL_PROMPT: '0',
				GCM_INTERACTIVE: 'never',
				SSH_ASKPASS_REQUIRE: 'never',
			},
		}
	}),
)

interface WorkspaceRepositoryRefsInput {
	readonly workspaceId: string
}

export const workspaceRepositoryRefs = (input: WorkspaceRepositoryRefsInput) => ({
	base: `refs/humanlayer/workspaces/${input.workspaceId}/base`,
	workspace: `refs/humanlayer/workspaces/${input.workspaceId}/workspace`,
})
