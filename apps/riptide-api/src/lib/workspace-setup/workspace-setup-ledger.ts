import {
	WorkspaceSetupStages,
	type AcceptedWorkspaceSetupSkip,
	type RepoWorkspaceSetupProgress,
	type WorkspaceSetupError,
	type WorkspaceSetupStage,
	type WorkspaceSetupState,
	type WorkspaceSpec,
} from '@humanlayer/schemas/effect/workspace'
import { Effect } from 'effect'

import {
	WorkspaceSetupFinishedStateInvalidError,
	WorkspaceSetupRetryConflictError,
	WorkspaceSetupSkipNotAllowedError,
	WorkspaceSetupStaleIntentError,
} from '../../effects/services/workspace-setup/workspace-setup.errors'

/**
 * Creates the empty per-host setup ledger for a task workspace spec.
 *
 * The API uses this when a task/session is created before any daemon has run setup.
 * Every repo starts at `setup_requested`; the daemon advances each repo through the
 * ordered stage vocabulary exported by the shared Effect schema.
 */
export const makeInitialWorkspaceSetupState = (spec: WorkspaceSpec): WorkspaceSetupState => ({
	specVersion: spec.specVersion,
	repos: spec.repos.map(({ localPath }) => ({ localPath, status: 'setup_requested' })),
})

/**
 * Computes the denormalized row status from the per-repo ledger.
 *
 * The ledger is the coordination source of truth. The row status only answers
 * “where is this workspace overall?” for humans, logs, and query filters by
 * returning the earliest stage that any repo has not moved past.
 */
export const deriveWorkspaceSetupStatus = (state: WorkspaceSetupState): WorkspaceSetupStage => {
	if (state.repos.length === 0) return 'done'
	return WorkspaceSetupStages.find((stage) => state.repos.some((repo) => repo.status === stage)) ?? 'done'
}

/**
 * Accepts a client-supplied completed ledger only when it matches the task spec.
 *
 * The experiment-off path still runs setup in the Tauri form and sends the API a
 * finished ledger. This parser is the guard that keeps that completed client
 * result from claiming different repos, duplicate repos, or unfinished stages.
 */
export const parseFinishedWorkspaceSetupStateForSpec = ({
	spec,
	state,
	taskId,
	hostId,
}: {
	readonly spec: WorkspaceSpec
	readonly state: WorkspaceSetupState
	readonly taskId: string
	readonly hostId: string
}) => {
	return Effect.gen(function* () {
		const expectedPaths = spec.repos.map((repo) => repo.localPath)
		const actualPaths = state.repos.map((repo) => repo.localPath)
		const expectedLocalPaths = new Set(expectedPaths)
		const actualLocalPaths = new Set(actualPaths)
		if (
			state.specVersion !== spec.specVersion ||
			expectedLocalPaths.size !== expectedPaths.length ||
			actualLocalPaths.size !== actualPaths.length ||
			actualLocalPaths.size !== expectedLocalPaths.size ||
			actualPaths.some((localPath) => !expectedLocalPaths.has(localPath)) ||
			state.repos.some((repo) => repo.status !== 'done')
		) {
			return yield* Effect.fail(
				new WorkspaceSetupFinishedStateInvalidError({
					taskId,
					hostId,
					reason: 'Finished setup state does not match the workspace spec',
				}),
			)
		}
		return state
	})
}

const requireMatchingError = (
	state: WorkspaceSetupState,
	error: WorkspaceSetupError | null,
	localPath: string,
	stage: WorkspaceSetupStage,
	taskId: string,
	hostId: string,
): Effect.Effect<RepoWorkspaceSetupProgress, WorkspaceSetupRetryConflictError | WorkspaceSetupStaleIntentError> => {
	return Effect.gen(function* () {
		const repo = state.repos.find((candidate) => candidate.localPath === localPath)
		if (!repo) {
			return yield* Effect.fail(
				new WorkspaceSetupStaleIntentError({
					taskId,
					hostId,
					localPath,
					stage,
					reason: 'The workspace no longer contains the requested repository',
				}),
			)
		}
		if (!error || error.localPath !== localPath || error.stage !== stage || repo.status !== stage) {
			return yield* Effect.fail(
				new WorkspaceSetupRetryConflictError({
					taskId,
					hostId,
					localPath,
					stage,
				}),
			)
		}
		return repo
	})
}

/**
 * Clears a row-level setup error when the user retries the exact failed repo/stage.
 *
 * Retry is an intent, not a ledger replacement: the repo stays on the same stage
 * and the daemon picks the row back up after the current error is cleared.
 */
export const applyRetryIntentToWorkspaceSetupState = (input: {
	readonly state: WorkspaceSetupState
	readonly error: WorkspaceSetupError | null
	readonly localPath: string
	readonly stage: WorkspaceSetupStage
	readonly taskId: string
	readonly hostId: string
}) => {
	return requireMatchingError(
		input.state,
		input.error,
		input.localPath,
		input.stage,
		input.taskId,
		input.hostId,
	).pipe(Effect.as({ state: input.state, error: null }))
}

/**
 * Records a user-approved skip for optional stages and advances that repo.
 *
 * Only `copy_globs` and `setup_command` can be skipped. The accepted skip is a
 * history fact in the ledger; it is not represented as a fake stage state.
 */
export const applySkipIntentToWorkspaceSetupState = (input: {
	readonly state: WorkspaceSetupState
	readonly error: WorkspaceSetupError | null
	readonly localPath: string
	readonly stage: WorkspaceSetupStage
	readonly userId: string
	readonly now: number
	readonly taskId: string
	readonly hostId: string
}) => {
	return Effect.gen(function* () {
		if (input.stage !== 'copy_globs' && input.stage !== 'setup_command') {
			return yield* Effect.fail(
				new WorkspaceSetupSkipNotAllowedError({
					taskId: input.taskId,
					hostId: input.hostId,
					localPath: input.localPath,
					stage: input.stage,
				}),
			)
		}
		const repo = yield* requireMatchingError(
			input.state,
			input.error,
			input.localPath,
			input.stage,
			input.taskId,
			input.hostId,
		)
		const nextStage: WorkspaceSetupStage = input.stage === 'copy_globs' ? 'setup_command' : 'done'
		const repos = input.state.repos.map(
			(candidate): RepoWorkspaceSetupProgress =>
				candidate.localPath === repo.localPath ? { ...candidate, status: nextStage } : candidate,
		)
		const finishedAt = repos.every((candidate) => candidate.status === 'done')
			? (input.state.finishedAt ?? input.now)
			: input.state.finishedAt
		const acceptedSkipBase = {
			localPath: input.localPath,
			stage: input.stage,
			skippedByUserId: input.userId,
			skippedAt: input.now,
		}
		const acceptedSkipWithCommand = input.error?.command
			? { ...acceptedSkipBase, command: input.error.command }
			: acceptedSkipBase
		const acceptedSkip: AcceptedWorkspaceSetupSkip = input.error?.message
			? { ...acceptedSkipWithCommand, errorMessage: input.error.message }
			: acceptedSkipWithCommand
		const acceptedSkips = input.state.acceptedSkips ?? []
		const nextState: WorkspaceSetupState = {
			...input.state,
			repos,
			acceptedSkips: [...acceptedSkips, acceptedSkip],
		}
		if (finishedAt === undefined) {
			return { state: nextState, error: null }
		}
		return {
			state: {
				...nextState,
				finishedAt,
			},
			error: null,
		}
	})
}

/**
 * Merges one daemon progress update into the per-host setup ledger.
 *
 * Daemon updates are monotonic: a repo can stay on its current stage or advance
 * one stage at a time. The merge preserves facts learned by earlier stages while
 * accepting newly reported facts from the current update.
 */
export const applyDaemonProgressUpdateToWorkspaceSetupState = ({
	state,
	repo,
	taskId,
	hostId,
}: {
	readonly state: WorkspaceSetupState
	readonly repo: RepoWorkspaceSetupProgress
	readonly taskId: string
	readonly hostId: string
}) => {
	return Effect.gen(function* () {
		const current = state.repos.find((candidate) => candidate.localPath === repo.localPath)
		if (!current) {
			return yield* Effect.fail(
				new WorkspaceSetupStaleIntentError({
					taskId,
					hostId,
					localPath: repo.localPath,
					stage: repo.status,
					reason: 'Daemon update references an unknown repository',
				}),
			)
		}
		const currentIndex = WorkspaceSetupStages.indexOf(current.status)
		const nextIndex = WorkspaceSetupStages.indexOf(repo.status)
		if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
			return yield* Effect.fail(
				new WorkspaceSetupStaleIntentError({
					taskId,
					hostId,
					localPath: repo.localPath,
					stage: repo.status,
					reason: 'Daemon update attempted an invalid stage transition',
				}),
			)
		}
		const merged: RepoWorkspaceSetupProgress = {
			...current,
			...repo,
			preflight: repo.preflight ?? current.preflight,
			worktree: repo.worktree ?? current.worktree,
			copyGlobs: repo.copyGlobs ?? current.copyGlobs,
			setupCommand: repo.setupCommand ?? current.setupCommand,
		}
		return {
			...state,
			repos: state.repos.map((candidate) => (candidate.localPath === repo.localPath ? merged : candidate)),
		}
	})
}
