import type {
	RepoWorkspaceSetupProgress,
	WorkspaceSetupError,
	WorkspaceSetupState,
	WorkspaceSpec,
	WorkspaceSpecRepo,
} from '@humanlayer/schemas/effect/workspace'
import { Effect, Path } from 'effect'

import type { DaemonTaskCapabilityError } from '@/effects/services/daemon-api/daemon-api.errors'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import type { WorkspaceSetupExecutorError } from '@/effects/services/workspace-setup-executor/workspace-setup-executor.errors'
import {
	WorkspaceSetupExecutor,
	type WorkspaceSetupExecutorRequirements,
} from '@/effects/services/workspace-setup-executor/workspace-setup-executor.service'
import { Sentry } from '@/instrument'
import { buildCompatibilityWorkspaceState } from '@/lib/workspace/build-workspace-state'
import { workspaceSetupStateAllowsSessionLaunch } from '@/lib/workspace/ledger'

import { WorkspaceConvergenceStateError } from './workspace-convergence.errors'

const STAGES = ['setup_requested', 'preflight', 'worktree', 'copy_globs', 'setup_command'] as const
const CONCURRENCY = 3

type WorkspaceSpecRepoInput = Omit<WorkspaceSpecRepo, 'copyGlobs'> & {
	readonly copyGlobs: readonly string[]
}
type WorkspaceSpecInput = Omit<WorkspaceSpec, 'repos'> & {
	readonly repos: readonly WorkspaceSpecRepoInput[]
}

export interface ConvergeWorkspaceInput {
	readonly spec: WorkspaceSpecInput
	readonly setupRowId: string
	readonly setupState: WorkspaceSetupState
	readonly taskId: string
	readonly sessionId?: string
	readonly hostId: string
}

type Stage = (typeof STAGES)[number]

type StageSuccess = {
	readonly repo: WorkspaceSpecRepoInput
	readonly progress: RepoWorkspaceSetupProgress
}

const updateLocalState = (state: WorkspaceSetupState, progress: RepoWorkspaceSetupProgress): WorkspaceSetupState => ({
	...state,
	repos: state.repos.map((repo) => (repo.localPath === progress.localPath ? { ...repo, ...progress } : repo)),
})

const findSpecRepo = (spec: WorkspaceSpecInput, localPath: string): WorkspaceSpecRepoInput | undefined =>
	spec.repos.find((repo) => repo.localPath === localPath)

type ParkableWorkspaceSetupError = WorkspaceSetupExecutorError | WorkspaceConvergenceStateError

type Mutable<T> = {
	-readonly [Key in keyof T]: T[Key]
}

const toWorkspaceSetupError = (error: ParkableWorkspaceSetupError): WorkspaceSetupError => {
	const workspaceError: Mutable<WorkspaceSetupError> = {
		localPath: error.localPath,
		stage: error.stage,
		message: error.message,
	}
	if (error.command !== undefined) workspaceError.command = error.command
	if (error.exitCode !== undefined) workspaceError.exitCode = error.exitCode
	if (error.stderr !== undefined) workspaceError.stderr = error.stderr
	return workspaceError
}

const runStage = (
	stage: Stage,
	repo: WorkspaceSpecRepoInput,
	current: RepoWorkspaceSetupProgress,
	input: ConvergeWorkspaceInput,
) =>
	Effect.gen(function* () {
		const executor = yield* WorkspaceSetupExecutor
		const pathService = yield* Path.Path
		const singleRepositoryName = input.spec.repos.length === 1 ? pathService.basename(repo.targetPath) : undefined
		const operationInput: {
			taskId: string
			hostId: string
			directory: string
			repo: WorkspaceSpecRepoInput
			singleRepositoryName?: string
		} = {
			taskId: input.taskId,
			hostId: input.hostId,
			directory: input.spec.directory,
			repo,
		}
		if (singleRepositoryName !== undefined) operationInput.singleRepositoryName = singleRepositoryName

		if (stage === 'setup_requested') {
			return { repo, progress: { ...current, status: 'preflight' } } satisfies StageSuccess
		}
		if (stage === 'preflight') {
			const facts = yield* executor.preflightRepo(operationInput)
			return {
				repo,
				progress: { ...current, status: 'worktree', preflight: facts },
			} satisfies StageSuccess
		}
		if (stage === 'worktree') {
			const resolvedSourceCommit = current.preflight?.resolvedSourceCommit
			if (resolvedSourceCommit === undefined) {
				return yield* Effect.fail(
					new WorkspaceConvergenceStateError({
						taskId: input.taskId,
						hostId: input.hostId,
						localPath: repo.localPath,
						stage: 'worktree',
						message: 'Workspace setup state is missing its pinned source commit',
					}),
				)
			}
			const facts = yield* executor.createOrAdoptWorktree({
				...operationInput,
				resolvedSourceCommit,
				branchRemote: current.preflight?.branchRemote,
			})
			const worktree: Mutable<NonNullable<RepoWorkspaceSetupProgress['worktree']>> = {
				targetPath: facts.targetPath,
			}
			if (facts.remoteName !== undefined) worktree.remoteName = facts.remoteName
			if (facts.remoteUrl !== undefined) worktree.remoteUrl = facts.remoteUrl
			if (facts.upstreamRef !== undefined) worktree.upstreamRef = facts.upstreamRef
			return {
				repo,
				progress: {
					...current,
					status: 'copy_globs',
					worktree,
				},
			} satisfies StageSuccess
		}
		if (stage === 'copy_globs') {
			const facts = yield* executor.copyConfiguredFiles(operationInput)
			return {
				repo,
				progress: { ...current, status: 'setup_command', copyGlobs: { filesCopied: [...facts.filesCopied] } },
			} satisfies StageSuccess
		}

		const facts = yield* executor.runSetupCommand(operationInput)
		const progress: Mutable<RepoWorkspaceSetupProgress> = {
			...current,
			status: 'done',
		}
		if (facts.command.length > 0) {
			progress.setupCommand = { command: facts.command, exitCode: facts.exitCode }
		}
		return {
			repo,
			progress,
		} satisfies StageSuccess
	})

/** Converges one durable workspace setup row until it completes or parks on a stage failure. */
export const convergeWorkspace = (
	input: ConvergeWorkspaceInput,
): Effect.Effect<
	void,
	DaemonTaskCapabilityError,
	WorkspaceSetupExecutor | WorkspaceSetupExecutorRequirements | DaemonApi
> => {
	const attributes: {
		task_id: string
		host_id: string
		setup_row_id: string
		session_id?: string
	} = {
		task_id: input.taskId,
		host_id: input.hostId,
		setup_row_id: input.setupRowId,
	}
	if (input.sessionId !== undefined) attributes.session_id = input.sessionId

	return Effect.gen(function* () {
		const api = yield* DaemonApi
		let state = input.setupState
		const parkError = (error: ParkableWorkspaceSetupError) => {
			const rowError = toWorkspaceSetupError(error)
			return Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { error_type: error._tag, stage: error.stage },
					extra: { taskId: error.taskId, hostId: error.hostId, localPath: error.localPath },
				}),
			).pipe(
				Effect.andThen(
					api.updateWorkspaceSetup({
						rowId: input.setupRowId,
						taskId: input.taskId,
						error: rowError,
					}),
				),
				Effect.as(undefined),
			)
		}

		for (const stage of STAGES) {
			const pending = state.repos.filter((repo) => repo.status === stage)
			if (pending.length === 0) continue

			const stageCompleted = yield* Effect.forEach(
				pending,
				(current) =>
					Effect.gen(function* () {
						const repo = findSpecRepo(input.spec, current.localPath)
						if (repo === undefined) {
							return yield* Effect.fail(
								new WorkspaceConvergenceStateError({
									taskId: input.taskId,
									hostId: input.hostId,
									localPath: current.localPath,
									stage,
									message:
										'Workspace setup state references a repository missing from the workspace spec',
								}),
							)
						}

						const outcome = yield* runStage(stage, repo, current, input)
						const launchWasAllowed = workspaceSetupStateAllowsSessionLaunch(state, input.spec)
						const nextState = updateLocalState(state, outcome.progress)
						const launchIsAllowed = workspaceSetupStateAllowsSessionLaunch(nextState, input.spec)
						const compatibilityState =
							!launchWasAllowed && launchIsAllowed
								? yield* buildCompatibilityWorkspaceState(input.spec, nextState)
								: undefined
						const { copyGlobs, ...progress } = outcome.progress
						const repoProgress: Mutable<
							NonNullable<Parameters<typeof api.updateWorkspaceSetup>[0]['repo']>
						> = {
							...progress,
						}
						if (copyGlobs !== undefined) {
							const copyGlobsProgress: Mutable<
								NonNullable<
									NonNullable<Parameters<typeof api.updateWorkspaceSetup>[0]['repo']>['copyGlobs']
								>
							> = {}
							if (copyGlobs.filesCopied !== undefined) {
								copyGlobsProgress.filesCopied = [...copyGlobs.filesCopied]
							}
							repoProgress.copyGlobs = copyGlobsProgress
						}

						state = nextState
						const updateInput: Mutable<Parameters<typeof api.updateWorkspaceSetup>[0]> = {
							rowId: input.setupRowId,
							taskId: input.taskId,
							repo: repoProgress,
						}
						if (compatibilityState !== undefined) updateInput.workspaceState = compatibilityState
						yield* api.updateWorkspaceSetup(updateInput)
					}),
				{ concurrency: CONCURRENCY, discard: true },
			).pipe(
				Effect.as(true),
				Effect.catchTags({
					WorkspaceConvergenceStateError: (error) => parkError(error).pipe(Effect.as(false)),
					WorkspaceCopyError: (error) => parkError(error).pipe(Effect.as(false)),
					WorkspacePreflightError: (error) => parkError(error).pipe(Effect.as(false)),
					WorkspaceSetupCommandError: (error) => parkError(error).pipe(Effect.as(false)),
					WorkspaceWorktreeError: (error) => parkError(error).pipe(Effect.as(false)),
				}),
			)
			if (!stageCompleted) return
		}
	}).pipe(
		Effect.annotateLogs(attributes),
		Effect.withSpan('workspace_setup.converge', {
			attributes,
		}),
	)
}
