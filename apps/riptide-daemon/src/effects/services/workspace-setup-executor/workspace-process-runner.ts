import { Clock, Duration, Effect, FileSystem, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { workspaceSetupLogDirectory } from '@/lib/log-paths'

import { WorkspaceProcessError, type WorkspaceSetupExecutorErrorFields } from './workspace-setup-executor.errors'
import {
	observeWorkspaceSetupExecutorFailure,
	workspaceSetupOperationAttributes,
} from './workspace-setup-executor.observability'
import type { WorkspaceRepoOperationInput } from './workspace-setup-executor.types'

type MutableWorkspaceSetupExecutorErrorFields = {
	-readonly [Key in keyof WorkspaceSetupExecutorErrorFields]: WorkspaceSetupExecutorErrorFields[Key]
}

export type WorkspaceProcessStage = 'preflight' | 'worktree' | 'setup_command'

export type CapturedWorkspaceProcessInput = {
	readonly workspace: WorkspaceRepoOperationInput
	readonly stage: WorkspaceProcessStage
	readonly command: string
	readonly args: readonly string[]
	readonly workingDirectory?: string
	readonly env?: Readonly<Record<string, string | undefined>>
	readonly timeout?: Duration.Input
}

export type CapturedWorkspaceProcessResult = {
	readonly stdout: string
	readonly stderr: string
	readonly exitCode: number
}

export type FileBackedWorkspaceProcessInput = {
	readonly workspace: WorkspaceRepoOperationInput
	readonly command: string
	readonly workingDirectory: string
}

export type FileBackedWorkspaceProcessResult = {
	readonly exitCode: number
	readonly stdoutLogPath: string
	readonly stderrLogPath: string
}

export const renderWorkspaceCommand = (command: string, args: readonly string[]) =>
	[command, ...args.map((arg) => (arg.includes(' ') ? JSON.stringify(arg) : arg))].join(' ')

const safeLogPathPart = (value: string): string => value.replaceAll(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)

export const readWorkspaceProcessOutputExcerpt = (path: string) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		return yield* fileSystem.stream(path, { bytesToRead: 1_024 }).pipe(Stream.decodeText(), Stream.mkString)
	})

export const runCapturedWorkspaceProcess = Effect.fn('workspace_setup_executor.run_captured_process')(function* (
	input: CapturedWorkspaceProcessInput,
) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const renderedCommand = renderWorkspaceCommand(input.command, input.args)
	const environment =
		input.command === 'git'
			? {
					GIT_TERMINAL_PROMPT: '0',
					GCM_INTERACTIVE: 'Never',
					SSH_ASKPASS_REQUIRE: 'never',
					...input.env,
				}
			: input.env
	const timeout = input.timeout ?? (input.command === 'git' ? '5 minutes' : undefined)
	const handle = yield* spawner
		.spawn(
			ChildProcess.make(input.command, input.args, {
				cwd: input.workingDirectory,
				env: environment,
				extendEnv: true,
				killSignal: 'SIGTERM',
				forceKillAfter: '5 seconds',
			}),
		)
		.pipe(
			Effect.mapError((cause) => {
				const error: MutableWorkspaceSetupExecutorErrorFields = {
					...input.workspace,
					localPath: input.workspace.repo.localPath,
					stage: input.stage,
					message: 'Failed to start workspace setup process',
					command: renderedCommand,
					cause,
				}
				if (input.workingDirectory !== undefined) error.workingDirectory = input.workingDirectory
				return new WorkspaceProcessError(error)
			}),
		)
	const collectOutput = Effect.all(
		[
			Stream.decodeText(handle.stdout).pipe(Stream.mkString),
			Stream.decodeText(handle.stderr).pipe(Stream.mkString),
			handle.exitCode,
		],
		{ concurrency: 'unbounded' },
	)
	const [stdout, stderr, exitCode] = yield* (
		timeout === undefined ? collectOutput : collectOutput.pipe(Effect.timeout(timeout))
	).pipe(
		Effect.mapError((cause) => {
			const error: MutableWorkspaceSetupExecutorErrorFields = {
				...input.workspace,
				localPath: input.workspace.repo.localPath,
				stage: input.stage,
				message: 'Workspace setup process failed or timed out',
				command: renderedCommand,
				cause,
			}
			if (input.workingDirectory !== undefined) error.workingDirectory = input.workingDirectory
			return new WorkspaceProcessError(error)
		}),
	)
	return { stdout, stderr, exitCode: Number(exitCode) }
})

export const runFileBackedWorkspaceSetupProcess = Effect.fn('workspace_setup_executor.run_file_backed_process')(
	function* (input: FileBackedWorkspaceProcessInput) {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const fileSystem = yield* FileSystem.FileSystem
		const pathService = yield* Path.Path
		const startedAt = yield* Clock.currentTimeMillis
		const logName = [
			safeLogPathPart(input.workspace.taskId),
			safeLogPathPart(input.workspace.hostId),
			safeLogPathPart(input.workspace.repo.localPath),
			String(startedAt),
		].join('-')
		const stdoutLogPath = pathService.join(workspaceSetupLogDirectory, `${logName}.stdout.log`)
		const stderrLogPath = pathService.join(workspaceSetupLogDirectory, `${logName}.stderr.log`)
		yield* fileSystem.makeDirectory(workspaceSetupLogDirectory, { recursive: true })
		const handle = yield* spawner.spawn(
			ChildProcess.make('sh', ['-c', input.command], {
				cwd: input.workingDirectory,
				extendEnv: true,
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
		return { exitCode: Number(rawExitCode), stdoutLogPath, stderrLogPath }
	},
)

export const runCapturedWorkspaceProcessObserved = (input: CapturedWorkspaceProcessInput) =>
	runCapturedWorkspaceProcess(input).pipe(
		Effect.tapError(observeWorkspaceSetupExecutorFailure),
		Effect.withSpan('workspace_setup_executor.run_process', {
			attributes: {
				...workspaceSetupOperationAttributes(input.workspace, input.stage),
				command: renderWorkspaceCommand(input.command, input.args),
			},
		}),
		Effect.scoped,
	)
