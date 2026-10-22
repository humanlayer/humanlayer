import {
	repositoryNameFromIdentity,
	WorkspaceRepositorySetupResult,
	type WorkspaceRepositoryActorSnapshot,
	type WorkspaceRepositorySetupError,
	type WorkspaceRepositorySetupStage,
} from '@humanlayer/schemas/effect/project-workspace'
import { Effect, Layer, Match, Path, type Config, type PlatformError } from 'effect'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import {
	ManagedRepositoryCache,
	type ManagedRepositoryCacheError,
} from '../managed-repository-cache/managed-repository-cache.service'
import { workspaceRepositoryRefs } from '../managed-repository-cache/repository-source-context'
import type { GitCommandRunnerError } from '../task-diff/errors'
import { GitCommandRunner } from '../task-diff/git-command-runner.service'
import { resolveWorkspacePath } from '../workspace-path-resolver/resolve-workspace-path'
import { copyWorkspaceRepositoryFiles } from './copy-workspace-repository-files'
import { RepositorySourceResolver } from './repository-source-resolver'
import { runWorkspaceRepositorySetupCommand } from './run-workspace-repository-setup-command'
import { observeWorkspaceRepositoryStageFailures } from './workspace-repository-actor-observability'
import {
	WorkspaceRepositoryActorOperations,
	WorkspaceRepositoryParked,
} from './workspace-repository-actor-operations.service'
import { WorkspaceRepositoryLocalOperationError } from './workspace-repository-local-operation-error'

interface RepositoryStageInput {
	readonly snapshot: WorkspaceRepositoryActorSnapshot
}

interface ReportRepositoryStageInput extends RepositoryStageInput {
	readonly result: WorkspaceRepositorySetupResult
}

interface LocalRepositoryStageInput extends RepositoryStageInput {
	readonly stage: WorkspaceRepositorySetupStage
}

type LocalStageFailure =
	| WorkspaceRepositoryLocalOperationError
	| ManagedRepositoryCacheError
	| GitCommandRunnerError
	| PlatformError.PlatformError
	| Config.ConfigError

const repositoryInput = (input: RepositoryStageInput) => ({
	repositoryIdentity: input.snapshot.repository.repositoryIdentity,
	remoteUrl: input.snapshot.repository.remoteUrl,
})

const resolveSourcePath = Effect.fn('workspace_repository.resolve_source_path')(function* (
	input: RepositoryStageInput,
) {
	const path = input.snapshot.status.sourcePath
	if (path === null)
		return yield* new WorkspaceRepositoryLocalOperationError({ message: 'Repository is missing its source path' })
	return yield* resolveWorkspacePath({ path })
})

const reportSetupResult = Effect.fn('workspace_repository.report_setup_result')(function* (
	input: ReportRepositoryStageInput,
) {
	const api = yield* DaemonApi
	const { snapshot, result } = input
	return yield* api
		.reportWorkspaceRepositoryResult({
			projectId: snapshot.status.projectId,
			workspaceId: snapshot.status.workspaceId,
			repositoryIdentity: snapshot.status.repositoryIdentity,
			generation: snapshot.status.generation,
			expectedUpdatedAt: snapshot.status.updatedAt,
			result,
		})
		.pipe(Effect.map(({ snapshot: committed }) => committed))
})

const runLocalStage = <R>(
	input: LocalRepositoryStageInput,
	local: Effect.Effect<WorkspaceRepositorySetupResult, LocalStageFailure, R>,
) =>
	local.pipe(
		observeWorkspaceRepositoryStageFailures({
			workspaceId: input.snapshot.workspace.id,
			repositoryIdentity: input.snapshot.repository.repositoryIdentity,
			stage: input.stage,
		}),
		Effect.catchTags({
			GitCommandIoError: (error) =>
				Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
			GitOutputLimitExceededError: (error) =>
				Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
			ManagedRepositoryCacheError: (error) =>
				Effect.fail(
					new WorkspaceRepositoryLocalOperationError({
						message: error.message,
						command: error.command,
						exitCode: error.exitCode,
						stderr: error.stderr,
					}),
				),
			GitCommandFailedError: (error) =>
				Effect.fail(
					new WorkspaceRepositoryLocalOperationError({
						message: error.message,
						command: error.argv.join(' '),
						exitCode: error.exitCode,
						stderr: error.stderr,
					}),
				),
			GitTimeoutError: (error) =>
				Effect.fail(
					new WorkspaceRepositoryLocalOperationError({
						message: error.message,
						command: error.argv.join(' '),
					}),
				),
			GitBinaryMissingError: (error) =>
				Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
			PlatformError: (error) =>
				Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
			ConfigError: (error) => Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
		}),
		Effect.catchTag('WorkspaceRepositoryLocalOperationError', (error) =>
			Effect.gen(function* () {
				const persisted: {
					-readonly [Key in keyof WorkspaceRepositorySetupError]: WorkspaceRepositorySetupError[Key]
				} = { stage: input.stage, message: error.message }
				if (error.command !== undefined) persisted.command = error.command
				if (error.exitCode !== undefined) persisted.exitCode = error.exitCode
				if (error.stderr !== undefined) persisted.stderr = error.stderr
				if (error.stdoutLogPath !== undefined) persisted.stdoutLogPath = error.stdoutLogPath
				if (error.stderrLogPath !== undefined) persisted.stderrLogPath = error.stderrLogPath
				const committed = yield* reportSetupResult({
					snapshot: input.snapshot,
					result: WorkspaceRepositorySetupResult.cases.StageFailed.make({
						stage: input.stage,
						error: persisted,
					}),
				})
				return yield* new WorkspaceRepositoryParked({ snapshot: committed })
			}),
		),
		Effect.flatMap((result) => reportSetupResult({ snapshot: input.snapshot, result })),
	)

const checkSourceResult = Effect.fn('workspace_repository.check_source')(function* (input: RepositoryStageInput) {
	const cache = yield* ManagedRepositoryCache
	const requestManagedClone = Effect.gen(function* () {
		const sourcePath = yield* cache.repositoryPath(repositoryInput(input))
		return WorkspaceRepositorySetupResult.cases.ManagedCloneRequested.make({ sourcePath })
	})
	if (input.snapshot.status.sourcePolicy === 'managed_clone') return yield* requestManagedClone

	const resolver = yield* RepositorySourceResolver
	const reusableSource = yield* resolver.findReusableSource({
		repositoryIdentity: input.snapshot.repository.repositoryIdentity,
		sourceCandidates: input.snapshot.sourceCandidates,
	})
	return yield* Match.value(reusableSource).pipe(
		Match.tagsExhaustive({
			Reusable: ({ source }) =>
				Effect.succeed(
					WorkspaceRepositorySetupResult.cases.SourceChecked.make({ repoAvailable: true, ...source }),
				),
			Rejected: ({ reason }) =>
				input.snapshot.status.sourcePolicy === 'filesystem_required'
					? Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: reason.message }))
					: requestManagedClone,
			NoCandidate: () =>
				input.snapshot.status.sourcePolicy === 'filesystem_required'
					? Effect.fail(
							new WorkspaceRepositoryLocalOperationError({
								message: 'Repository is missing its required filesystem source',
							}),
						)
					: requestManagedClone,
		}),
	)
})

const cloneSourceResult = Effect.fn('workspace_repository.clone_source')(function* (input: RepositoryStageInput) {
	const cache = yield* ManagedRepositoryCache
	const persistedSourcePath = yield* resolveSourcePath(input)
	const sourcePath = yield* cache.prepare({ ...repositoryInput(input), sourcePath: persistedSourcePath })
	return WorkspaceRepositorySetupResult.cases.ManagedCloneReady.make({ sourcePath })
})

const refreshSourceResult = Effect.fn('workspace_repository.refresh_source')(function* (input: RepositoryStageInput) {
	const cache = yield* ManagedRepositoryCache
	const { snapshot } = input
	const sourcePath = yield* resolveSourcePath(input)
	yield* cache.refresh({
		...repositoryInput(input),
		sourcePath,
		workspaceId: snapshot.workspace.id,
		defaultBranch: snapshot.repository.defaultBranch,
		workspaceBranch: snapshot.repository.branch,
	})
	return WorkspaceRepositorySetupResult.cases.SourceRefreshed.make({
		sourceKind: snapshot.status.sourceKind === 'managed_clone' ? 'managed_clone' : 'filesystem',
		sourcePath,
	})
})

const resolveCommitResult = Effect.fn('workspace_repository.resolve_commit')(function* (input: RepositoryStageInput) {
	const git = yield* GitCommandRunner
	const sourcePath = yield* resolveSourcePath(input)
	const pinnedCommit = input.snapshot.status.resolvedCommit ?? input.snapshot.repository.baseCommit
	const ref = pinnedCommit ?? workspaceRepositoryRefs({ workspaceId: input.snapshot.workspace.id }).base
	if (pinnedCommit === undefined) {
		const fetchedRef = yield* git.run(['show-ref', '--verify', '--quiet', ref], {
			cwd: sourcePath,
			okExitCodes: [0, 1],
		})
		if (fetchedRef.exitCode === 1) {
			yield* Effect.logWarning(
				'Workspace fetched base ref is missing; refreshing persisted source before resolving',
			).pipe(
				Effect.annotateLogs({
					workspace_id: input.snapshot.workspace.id,
					repository_identity: input.snapshot.repository.repositoryIdentity,
				}),
			)
			const cache = yield* ManagedRepositoryCache
			yield* cache.refresh({
				...repositoryInput(input),
				sourcePath,
				workspaceId: input.snapshot.workspace.id,
				defaultBranch: input.snapshot.repository.defaultBranch,
				workspaceBranch: input.snapshot.repository.branch,
			})
		}
	}
	const argv = ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]
	const result = yield* git.run(argv, { cwd: sourcePath, okExitCodes: [0, 1] })
	if (result.exitCode !== 0)
		return yield* new WorkspaceRepositoryLocalOperationError({
			// Unpublished commits from another user or host never reach this source; say so.
			message:
				pinnedCommit === undefined
					? `Workspace base ref ${ref} is not available in this source checkout after refresh`
					: `Pinned base commit ${pinnedCommit} is not available in this source checkout; commits that were never published to the remote are not transferred between users or hosts`,
			command: `git ${argv.join(' ')}`,
			exitCode: result.exitCode,
		})
	const resolvedCommit = result.stdout.trim()
	if (!/^[0-9a-f]{40}$/i.test(resolvedCommit))
		return yield* new WorkspaceRepositoryLocalOperationError({
			message: `Git returned an invalid commit for ${ref}`,
		})
	return WorkspaceRepositorySetupResult.cases.CommitResolved.make({ resolvedCommit })
})

const materializeResult = Effect.fn('workspace_repository.materialize')(function* (input: RepositoryStageInput) {
	const cache = yield* ManagedRepositoryCache
	const path = yield* Path.Path
	const { snapshot } = input
	const sourcePath = yield* resolveSourcePath(input)
	const resolvedCommit = snapshot.status.resolvedCommit
	if (resolvedCommit === null)
		return yield* new WorkspaceRepositoryLocalOperationError({ message: 'Repository commit was not resolved' })
	const configuredTarget =
		snapshot.workspace.repositories.length === 1
			? snapshot.location.filePath
			: path.join(snapshot.location.filePath, repositoryNameFromIdentity(snapshot.repository.repositoryIdentity))
	const targetPath = yield* resolveWorkspacePath({ path: configuredTarget })
	const materialization = yield* cache.materialize({
		...repositoryInput(input),
		sourcePath,
		targetPath,
		resolvedCommit,
		workspaceId: snapshot.workspace.id,
		branch: snapshot.repository.branch,
		sourceKind: snapshot.status.sourceKind === 'managed_clone' ? 'managed_clone' : 'filesystem',
	})
	return WorkspaceRepositorySetupResult.cases.WorktreeMaterialized.make({ materialization })
})

const publishBranchResult = Effect.fn('workspace_repository.publish_branch')(function* (input: RepositoryStageInput) {
	const cache = yield* ManagedRepositoryCache
	const { snapshot } = input
	if (snapshot.status.materialization === null)
		return yield* new WorkspaceRepositoryLocalOperationError({ message: 'Repository is not materialized' })
	const sourcePath = yield* resolveSourcePath(input)
	const materializationPath = yield* resolveWorkspacePath({ path: snapshot.status.materialization.path })
	return yield* cache
		.publishBranch({
			...repositoryInput(input),
			sourcePath,
			materializationPath,
			branch: snapshot.repository.branch,
		})
		.pipe(
			observeWorkspaceRepositoryStageFailures({
				workspaceId: snapshot.workspace.id,
				repositoryIdentity: snapshot.repository.repositoryIdentity,
				stage: 'publishing_branch',
			}),
			Effect.as(WorkspaceRepositorySetupResult.cases.BranchPublishFinished.make({ status: 'published' })),
			Effect.catchTag('ManagedRepositoryCacheError', () =>
				Effect.logWarning('Workspace branch could not be published; setup will continue').pipe(
					Effect.as(WorkspaceRepositorySetupResult.cases.BranchPublishFinished.make({ status: 'warning' })),
				),
			),
		)
})

export const WorkspaceRepositoryActorOperationsLive = Layer.succeed(
	WorkspaceRepositoryActorOperations,
	WorkspaceRepositoryActorOperations.of({
		start: (snapshot) =>
			reportSetupResult({
				snapshot,
				result: WorkspaceRepositorySetupResult.cases.SetupStarted.make({}),
			}),
		checkSource: (snapshot) =>
			runLocalStage({ snapshot, stage: 'checking_source' }, checkSourceResult({ snapshot })),
		cloneSource: (snapshot) =>
			runLocalStage({ snapshot, stage: 'cloning_source' }, cloneSourceResult({ snapshot })),
		refreshSource: (snapshot) =>
			runLocalStage({ snapshot, stage: 'refreshing_source' }, refreshSourceResult({ snapshot })),
		resolveCommit: (snapshot) =>
			runLocalStage({ snapshot, stage: 'resolving_commit' }, resolveCommitResult({ snapshot })),
		materialize: (snapshot) => runLocalStage({ snapshot, stage: 'materializing' }, materializeResult({ snapshot })),
		publishBranch: (snapshot) =>
			runLocalStage({ snapshot, stage: 'publishing_branch' }, publishBranchResult({ snapshot })),
		copyFiles: (snapshot) =>
			runLocalStage({ snapshot, stage: 'copying_files' }, copyWorkspaceRepositoryFiles({ snapshot })),
		runSetupCommand: (snapshot) =>
			runLocalStage(
				{ snapshot, stage: 'running_setup_command' },
				runWorkspaceRepositorySetupCommand({ snapshot }).pipe(Effect.scoped),
			),
	}),
)
