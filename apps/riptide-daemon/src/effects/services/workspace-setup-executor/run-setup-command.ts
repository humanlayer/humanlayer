import { Clock, Effect, FileSystem } from 'effect'

import { WorkspacePathResolver } from '../workspace-path-resolver/workspace-path-resolver.service'
import { readWorkspaceProcessOutputExcerpt, runFileBackedWorkspaceSetupProcess } from './workspace-process-runner'
import { WorkspaceSetupCommandError, type WorkspaceSetupExecutorErrorFields } from './workspace-setup-executor.errors'
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

export const runWorkspaceSetupCommand = (input: WorkspaceRepoOperationInput) => {
	const attributes = workspaceSetupOperationAttributes(input, 'setup_command')
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const workspacePathResolver = yield* WorkspacePathResolver
		const command = input.repo.setupCommand
		if (command === undefined || command.trim().length === 0) return { command: '', exitCode: 0 }
		const targetDirectory = yield* workspacePathResolver.resolveTargetDirectory({
			targetPath: input.repo.targetPath,
		})
		const startedAt = yield* Clock.currentTimeMillis
		yield* Effect.logInfo('Workspace setup command started').pipe(
			Effect.annotateLogs({ ...attributes, command, working_directory: targetDirectory }),
		)
		const result = yield* runFileBackedWorkspaceSetupProcess({
			workspace: input,
			command,
			workingDirectory: targetDirectory,
		})
		if (result.exitCode !== 0) {
			const stderr = yield* readWorkspaceProcessOutputExcerpt(result.stderrLogPath).pipe(
				Effect.catchTag('PlatformError', () => Effect.succeed('')),
			)
			const stdout =
				stderr.trim().length === 0
					? yield* readWorkspaceProcessOutputExcerpt(result.stdoutLogPath).pipe(
							Effect.catchTag('PlatformError', () => Effect.succeed('')),
						)
					: ''
			const error: MutableWorkspaceSetupExecutorErrorFields = {
				...input,
				localPath: input.repo.localPath,
				stage: 'setup_command',
				message: 'Workspace setup command failed',
				command,
				workingDirectory: targetDirectory,
				exitCode: result.exitCode,
				stdoutLogPath: result.stdoutLogPath,
				stderrLogPath: result.stderrLogPath,
			}
			const excerpt = stderrExcerpt(stderr || stdout)
			if (excerpt !== undefined) error.stderr = excerpt
			return yield* Effect.fail(new WorkspaceSetupCommandError(error))
		}
		yield* Effect.all([fileSystem.remove(result.stdoutLogPath), fileSystem.remove(result.stderrLogPath)], {
			concurrency: 2,
			discard: true,
		}).pipe(
			Effect.catchTag('PlatformError', (error) =>
				Effect.logWarning('Failed to delete successful workspace setup command logs').pipe(
					Effect.annotateLogs({
						stdout_log_path: result.stdoutLogPath,
						stderr_log_path: result.stderrLogPath,
						error,
					}),
				),
			),
		)
		const completedAt = yield* Clock.currentTimeMillis
		yield* Effect.logInfo('Workspace setup command completed').pipe(
			Effect.annotateLogs({
				...attributes,
				command,
				working_directory: targetDirectory,
				exit_code: result.exitCode,
				elapsed_ms: completedAt - startedAt,
			}),
		)
		return { command, exitCode: result.exitCode }
	}).pipe(
		Effect.catchTag('PlatformError', (cause) =>
			Effect.gen(function* () {
				const workspacePathResolver = yield* WorkspacePathResolver
				const workingDirectory = yield* workspacePathResolver.resolveTargetDirectory({
					targetPath: input.repo.targetPath,
				})
				return yield* Effect.fail(
					new WorkspaceSetupCommandError({
						...input,
						localPath: input.repo.localPath,
						stage: 'setup_command',
						message: 'Failed while running workspace setup command',
						command: input.repo.setupCommand,
						workingDirectory,
						cause,
					}),
				)
			}),
		),
		Effect.tapError(observeWorkspaceSetupExecutorFailure),
		Effect.annotateLogs(attributes),
		Effect.withSpan('workspace_setup_executor.run_setup_command', { attributes }),
		Effect.scoped,
	)
}
