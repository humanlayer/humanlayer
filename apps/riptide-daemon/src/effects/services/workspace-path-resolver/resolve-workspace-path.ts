import { Config, Effect, Path } from 'effect'

export const expandWorkspaceHomePath = (value: string, homeDirectory: string, pathService: Path.Path): string => {
	if (value === '~') return homeDirectory
	if (value.startsWith('~/')) return pathService.join(homeDirectory, value.slice(2))
	return value
}

export const resolveWorkspacePath = Effect.fn('workspace_path_resolver.resolve_path')(function* (input: {
	readonly path: string
}) {
	const homeDirectory = yield* Config.String('HOME')
	const pathService = yield* Path.Path
	return pathService.resolve(expandWorkspaceHomePath(input.path, homeDirectory, pathService))
})
