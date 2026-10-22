import {
	WorkspaceRepositorySetupResult,
	type WorkspaceRepositoryActorSnapshot,
} from '@humanlayer/schemas/effect/project-workspace'
import { Clock, Effect, FileSystem, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { workspaceSetupLogDirectory } from '@/lib/log-paths'

import { resolveWorkspacePath } from '../workspace-path-resolver/resolve-workspace-path'
import { WorkspaceRepositoryLocalOperationError } from './workspace-repository-local-operation-error'

interface RunWorkspaceRepositorySetupCommandInput {
	readonly snapshot: WorkspaceRepositoryActorSnapshot
}

const sanitizeWorkspaceSetupLogFileNamePart = (value: string) => value.replaceAll(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)

export const runWorkspaceRepositorySetupCommand = Effect.fn('workspace_repository.run_setup_command')(function* (
	input: RunWorkspaceRepositorySetupCommandInput,
) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const snapshot = input.snapshot
	const materialization = snapshot.status.materialization
	if (materialization === null) {
		return yield* new WorkspaceRepositoryLocalOperationError({ message: 'Repository is not materialized' })
	}
	const materializationPath = yield* resolveWorkspacePath({ path: materialization.path })
	const command = snapshot.repository.setupCommand?.trim() ?? ''
	const completedAt = yield* Clock.currentTimeMillis
	const logName = `${sanitizeWorkspaceSetupLogFileNamePart(snapshot.workspace.id)}-${sanitizeWorkspaceSetupLogFileNamePart(snapshot.status.repositoryIdentity)}-${completedAt}`
	const stdoutLogPath = pathService.join(workspaceSetupLogDirectory, `${logName}.stdout.log`)
	if (command.length === 0) {
		return WorkspaceRepositorySetupResult.cases.SetupCommandFinished.make({
			result: { command: '', exitCode: 0, stdoutLogPath: null, stderrLogPath: null, completedAt },
		})
	}
	const stderrLogPath = pathService.join(workspaceSetupLogDirectory, `${logName}.stderr.log`)
	yield* fileSystem.makeDirectory(workspaceSetupLogDirectory, { recursive: true })
	yield* Effect.logInfo('Starting workspace setup command').pipe(
		Effect.annotateLogs({
			workspace_id: snapshot.workspace.id,
			repository_identity: snapshot.repository.repositoryIdentity,
		}),
	)
	const handle = yield* spawner.spawn(
		ChildProcess.make('sh', ['-c', command], {
			cwd: materializationPath,
			extendEnv: true,
			killSignal: 'SIGTERM',
			forceKillAfter: '2 seconds',
		}),
	)
	const [, , rawExitCode] = yield* Effect.all(
		[
			Stream.run(handle.stdout, fileSystem.sink(stdoutLogPath)),
			Stream.run(handle.stderr, fileSystem.sink(stderrLogPath)),
			handle.exitCode,
		],
		{ concurrency: 'unbounded' },
	)
	const exitCode = Number(rawExitCode)
	if (exitCode !== 0) {
		const stderr = (yield* fileSystem.readFileString(stderrLogPath)).trim().slice(-4_000)
		return yield* new WorkspaceRepositoryLocalOperationError({
			message: 'Workspace setup command failed',
			command,
			exitCode,
			stderr,
			stdoutLogPath,
			stderrLogPath,
		})
	}
	yield* Effect.logInfo('Workspace setup command completed').pipe(
		Effect.annotateLogs({
			workspace_id: snapshot.workspace.id,
			repository_identity: snapshot.repository.repositoryIdentity,
			stdout_log_path: stdoutLogPath,
			stderr_log_path: stderrLogPath,
		}),
	)
	return WorkspaceRepositorySetupResult.cases.SetupCommandFinished.make({
		result: {
			command,
			exitCode,
			stdoutLogPath,
			stderrLogPath,
			completedAt: yield* Clock.currentTimeMillis,
		},
	})
})
