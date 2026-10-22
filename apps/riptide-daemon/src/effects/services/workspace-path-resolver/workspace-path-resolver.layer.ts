import { Effect, FileSystem, Layer, Path } from 'effect'
import * as Config from 'effect/Config'

import { expandWorkspaceHomePath } from './resolve-workspace-path'
import { WorkspacePathResolver } from './workspace-path-resolver.service'

export const WorkspacePathResolverLive = Layer.effect(
	WorkspacePathResolver,
	Effect.gen(function* () {
		const homeDirectory = yield* Config.String('HOME')
		const pathService = yield* Path.Path
		const fileSystem = yield* FileSystem.FileSystem

		return WorkspacePathResolver.of({
			resolveSourceDirectory: Effect.fn('workspace_path_resolver.resolve_source_directory')(function* (input) {
				const expandedDirectory = pathService.resolve(
					expandWorkspaceHomePath(input.directory, homeDirectory, pathService),
				)
				const sourceDirectory =
					input.localPath === '.'
						? expandedDirectory
						: pathService.resolve(expandedDirectory, input.localPath)
				if (input.localPath !== '.' || input.singleRepositoryName === undefined) return sourceDirectory

				if (
					yield* fileSystem
						.exists(pathService.join(sourceDirectory, '.git'))
						.pipe(Effect.orElseSucceed(() => false))
				)
					return sourceDirectory
				const nestedRepository = pathService.resolve(sourceDirectory, input.singleRepositoryName)
				if (
					yield* fileSystem
						.exists(pathService.join(nestedRepository, '.git'))
						.pipe(Effect.orElseSucceed(() => false))
				)
					return nestedRepository
				return sourceDirectory
			}),
			resolveTargetDirectory: Effect.fn('workspace_path_resolver.resolve_target_directory')((input) =>
				Effect.succeed(
					pathService.resolve(expandWorkspaceHomePath(input.targetPath, homeDirectory, pathService)),
				),
			),
		})
	}),
)
