import { Effect, FileSystem, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import {
	isSafeWorkspaceRelativePath,
	normalizeWorkspaceRelativePath,
	workspacePathHasGlobMagic,
} from '../workspace-path-resolver/workspace-copy-path'
import { WorkspacePathResolver } from '../workspace-path-resolver/workspace-path-resolver.service'
import { renderWorkspaceCommand } from './workspace-process-runner'
import { WorkspaceCopyError, type WorkspaceSetupExecutorErrorFields } from './workspace-setup-executor.errors'
import {
	observeWorkspaceSetupExecutorFailure,
	workspaceSetupOperationAttributes,
} from './workspace-setup-executor.observability'
import type { WorkspaceRepoOperationInput } from './workspace-setup-executor.types'

type MutableWorkspaceSetupExecutorErrorFields = {
	-readonly [Key in keyof WorkspaceSetupExecutorErrorFields]: WorkspaceSetupExecutorErrorFields[Key]
}

const stderrExcerpt = (stderr: string): string | undefined => {
	const trimmed = stderr.trim()
	return trimmed.length === 0 ? undefined : trimmed.slice(-4_000)
}

export const copyConfiguredWorkspaceFiles = (input: WorkspaceRepoOperationInput) => {
	const attributes = workspaceSetupOperationAttributes(input, 'copy_globs')
	return Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const fileSystem = yield* FileSystem.FileSystem
		const pathService = yield* Path.Path
		const workspacePathResolver = yield* WorkspacePathResolver
		if (input.repo.copyGlobs.length === 0) return { filesCopied: [] }
		const sourceDirectory = yield* workspacePathResolver.resolveSourceDirectory({
			directory: input.directory,
			localPath: input.repo.localPath,
			singleRepositoryName: input.singleRepositoryName,
		})
		const targetDirectory = yield* workspacePathResolver.resolveTargetDirectory({
			targetPath: input.repo.targetPath,
		})
		const copiedPaths = new Set<string>()
		const copyRelativePath = (entry: string) =>
			Effect.gen(function* () {
				const normalizedEntry = normalizeWorkspaceRelativePath(entry)
				if (!isSafeWorkspaceRelativePath(normalizedEntry) || copiedPaths.has(normalizedEntry)) return undefined
				const sourcePath = pathService.join(sourceDirectory, normalizedEntry)
				if (!(yield* fileSystem.exists(sourcePath))) return undefined
				const info = yield* fileSystem.stat(sourcePath)
				if (info.type !== 'File') return undefined
				copiedPaths.add(normalizedEntry)
				const destinationPath = pathService.join(targetDirectory, normalizedEntry)
				yield* fileSystem.makeDirectory(pathService.dirname(destinationPath), { recursive: true })
				yield* fileSystem.copyFile(sourcePath, destinationPath)
				return normalizedEntry
			})

		const literalPaths = input.repo.copyGlobs.filter((pattern) => !workspacePathHasGlobMagic(pattern))
		yield* Effect.forEach(literalPaths, copyRelativePath, { concurrency: 8 })

		const globPatterns = input.repo.copyGlobs.filter(workspacePathHasGlobMagic)
		if (globPatterns.length > 0) {
			const args = [
				'ls-files',
				'-z',
				'--cached',
				'--others',
				'--exclude-standard',
				'--',
				...globPatterns.map((pattern) => `:(glob)${pattern}`),
			]
			const command = renderWorkspaceCommand('git', args)
			const handle = yield* spawner.spawn(
				ChildProcess.make('git', args, { cwd: sourceDirectory, extendEnv: true }),
			)
			const copyMatches = handle.stdout.pipe(
				Stream.flatMap((bytes) => Stream.fromIterable(bytes)),
				Stream.split((byte) => byte === 0),
				Stream.map((bytes) => new TextDecoder().decode(Uint8Array.from(bytes))),
				Stream.mapEffect(copyRelativePath, { concurrency: 8 }),
				Stream.runDrain,
			)
			const [, stderr, exitCode] = yield* Effect.all(
				[copyMatches, Stream.decodeText(handle.stderr).pipe(Stream.mkString), handle.exitCode],
				{ concurrency: 'unbounded' },
			)
			if (Number(exitCode) !== 0) {
				const error: MutableWorkspaceSetupExecutorErrorFields = {
					...input,
					localPath: input.repo.localPath,
					stage: 'copy_globs',
					message: 'Git failed to enumerate configured workspace files',
					command,
					workingDirectory: sourceDirectory,
					exitCode: Number(exitCode),
				}
				const excerpt = stderrExcerpt(stderr)
				if (excerpt !== undefined) error.stderr = excerpt
				return yield* Effect.fail(new WorkspaceCopyError(error))
			}
		}

		return { filesCopied: [...copiedPaths] }
	}).pipe(
		Effect.catchTag('PlatformError', (cause) =>
			Effect.gen(function* () {
				const workspacePathResolver = yield* WorkspacePathResolver
				const workingDirectory = yield* workspacePathResolver.resolveSourceDirectory({
					directory: input.directory,
					localPath: input.repo.localPath,
					singleRepositoryName: input.singleRepositoryName,
				})
				return yield* Effect.fail(
					new WorkspaceCopyError({
						...input,
						localPath: input.repo.localPath,
						stage: 'copy_globs',
						message: 'Failed to copy configured workspace files',
						workingDirectory,
						cause,
					}),
				)
			}),
		),
		Effect.tapError(observeWorkspaceSetupExecutorFailure),
		Effect.annotateLogs(attributes),
		Effect.withSpan('workspace_setup_executor.copy_configured_files', { attributes }),
		Effect.scoped,
	)
}
