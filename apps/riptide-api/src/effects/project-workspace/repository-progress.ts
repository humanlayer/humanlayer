import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces } from '@humanlayer/db/tables/workspaces'
import type { ReportWorkspaceRepositoryResultInput as ReportWorkspaceRepositoryResultContractInput } from '@humanlayer/riptide-api-contract/daemon/project-workspaces/report-repository-result'
import type {
	WorkspaceRepositories,
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositorySetupResult,
	WorkspaceRepositorySetupStage,
} from '@humanlayer/schemas/effect/project-workspace'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect, Match, Predicate } from 'effect'

import { PostgresDb } from '../services/postgres/postgres-db.service'
import {
	WorkspaceRepositoryProgressInvalid,
	WorkspaceRepositoryStageFailed,
	WorkspaceRepositoryStatusChanged,
} from './errors'
import type { RepositoryLocationScope } from './repository-locations'
import {
	readWorkspaceRepositoryActorSnapshotWithExecutor,
	type WorkspaceRepositoryActorIdentity,
} from './workspace-reads'

export type ReportWorkspaceRepositoryResultInput = ReportWorkspaceRepositoryResultContractInput & {
	readonly actor: RepositoryLocationScope
}

type StatusUpdate = Partial<typeof workspaceRepositoryStatusForUserForHost.$inferInsert>

/** Validates and persists a setup stage transition for a workspace repository. */
export const advanceRepositorySetupStage = Effect.fn('project_workspace.advance_repository_setup_stage')(function* (
	input: ReportWorkspaceRepositoryResultInput,
) {
	const postgres = yield* PostgresDb
	const identity: WorkspaceRepositoryActorIdentity = {
		organizationId: input.actor.organizationId,
		projectId: input.projectId,
		workspaceId: input.workspaceId,
		userId: input.actor.userId,
		hostId: input.actor.hostId,
		repositoryIdentity: input.repositoryIdentity,
	}

	return yield* postgres.transaction((transaction) =>
		Effect.gen(function* () {
			if (Predicate.isTagged(input.result, 'CommitResolved')) {
				yield* transaction.query(
					transaction.client
						.select({ id: workspaces.id })
						.from(workspaces)
						.where(
							and(
								eq(workspaces.organization_id, identity.organizationId),
								eq(workspaces.project_id, identity.projectId),
								eq(workspaces.id, identity.workspaceId),
							),
						)
						.limit(1)
						.for('no key update'),
				)
			}

			const current = yield* readWorkspaceRepositoryActorSnapshotWithExecutor(transaction, identity)
			if (
				current.workspace.archived ||
				current.status.generation !== input.generation ||
				current.location.setupGeneration !== input.generation ||
				current.status.updatedAt !== input.expectedUpdatedAt
			) {
				return yield* new WorkspaceRepositoryStatusChanged({ snapshot: current })
			}

			const transition = yield* validateSetupTransition(current, input.result).pipe(
				Effect.catchTag('WorkspaceRepositoryStageFailed', (failure) =>
					Effect.succeed({
						update: { error: failure.error } satisfies StatusUpdate,
						stageFailure: true as const,
					}),
				),
			)
			let resolvedCommit: string | null | undefined =
				'stageFailure' in transition ? undefined : transition.update.resolved_commit
			if (Predicate.isTagged(input.result, 'CommitResolved')) {
				const repositories = setBaseCommitIfUnpinned(
					current.workspace.repositories,
					input.repositoryIdentity,
					input.result.resolvedCommit,
				)
				const pinned = repositories.find(
					(repository) => repository.repositoryIdentity === input.repositoryIdentity,
				)?.baseCommit
				if (!pinned) {
					return yield* new WorkspaceRepositoryProgressInvalid({
						message: 'Repository commit could not be pinned',
					})
				}
				resolvedCommit = pinned
				const now = yield* Clock.currentTimeMillis
				yield* transaction.query(
					transaction.client
						.update(workspaces)
						.set({
							repositories,
							updated_at: BigInt(Math.max(now, current.workspace.updatedAt + 1)),
						})
						.where(
							and(
								eq(workspaces.organization_id, identity.organizationId),
								eq(workspaces.project_id, identity.projectId),
								eq(workspaces.id, identity.workspaceId),
							),
						),
				)
			}

			const statusNow = yield* Clock.currentTimeMillis
			const nextUpdatedAt = BigInt(Math.max(statusNow, current.status.updatedAt + 1))
			const updated = yield* transaction.query(
				transaction.client
					.update(workspaceRepositoryStatusForUserForHost)
					.set({
						...transition.update,
						resolved_commit: resolvedCommit,
						updated_at: nextUpdatedAt,
					})
					.where(
						and(
							eq(workspaceRepositoryStatusForUserForHost.organization_id, identity.organizationId),
							eq(workspaceRepositoryStatusForUserForHost.project_id, identity.projectId),
							eq(workspaceRepositoryStatusForUserForHost.workspace_id, identity.workspaceId),
							eq(workspaceRepositoryStatusForUserForHost.user_id, identity.userId),
							eq(workspaceRepositoryStatusForUserForHost.host_id, identity.hostId),
							eq(
								workspaceRepositoryStatusForUserForHost.repository_identity,
								identity.repositoryIdentity,
							),
							eq(workspaceRepositoryStatusForUserForHost.generation, BigInt(input.generation)),
							eq(workspaceRepositoryStatusForUserForHost.updated_at, BigInt(input.expectedUpdatedAt)),
						),
					)
					.returning({ updatedAt: workspaceRepositoryStatusForUserForHost.updated_at }),
			)
			if (!updated[0]) {
				const latest = yield* readWorkspaceRepositoryActorSnapshotWithExecutor(transaction, identity)
				return yield* new WorkspaceRepositoryStatusChanged({ snapshot: latest })
			}

			// Automatic sources belong to this workspace status, never the user configuration.

			return yield* readWorkspaceRepositoryActorSnapshotWithExecutor(transaction, identity)
		}),
	)
})

/** Validates that the result is a legal transition from the current status and returns the DB column update. */
const validateSetupTransition = Effect.fn('project_workspace.validate_setup_transition')(function* (
	current: WorkspaceRepositoryActorSnapshot,
	result: WorkspaceRepositorySetupResult,
) {
	if (Predicate.isTagged(result, 'StageFailed')) {
		if (result.stage !== current.status.status || result.error.stage !== current.status.status) {
			return yield* invalidTransition(current.status.status, result._tag)
		}
		return yield* new WorkspaceRepositoryStageFailed({ error: result.error })
	}
	if (Predicate.isTagged(result, 'GitStateObserved')) {
		return yield* invalidTransition(current.status.status, result._tag)
	}
	if (current.status.sourcePolicy === 'filesystem_required' && Predicate.isTagged(result, 'ManagedCloneRequested')) {
		return yield* new WorkspaceRepositoryProgressInvalid({
			message: 'Managed clone fallback is forbidden by the frozen filesystem source policy',
		})
	}
	if (
		Predicate.isTagged(result, 'SourceChecked') &&
		(current.status.sourcePolicy === 'managed_clone' ||
			(current.status.sourcePolicy === 'filesystem_required' && result.sourceKind !== 'filesystem'))
	) {
		return yield* new WorkspaceRepositoryProgressInvalid({
			message: 'SourceChecked contradicts the frozen repository source policy',
		})
	}

	const rule = Match.value(result).pipe(
		Match.tagsExhaustive({
			SetupStarted: () => ({ from: 'setup_requested', to: 'checking_source' }) as const,
			ManagedCloneRequested: () => ({ from: 'checking_source', to: 'cloning_source' }) as const,
			SourceChecked: () => ({ from: 'checking_source', to: 'refreshing_source' }) as const,
			ManagedCloneReady: () => ({ from: 'cloning_source', to: 'refreshing_source' }) as const,
			SourceRefreshed: () => ({ from: 'refreshing_source', to: 'resolving_commit' }) as const,
			CommitResolved: () => ({ from: 'resolving_commit', to: 'materializing' }) as const,
			WorktreeMaterialized: () =>
				({
					from: 'materializing',
					to: current.repository.autoPushBranch ? 'publishing_branch' : 'copying_files',
				}) as const,
			BranchPublishFinished: () => ({ from: 'publishing_branch', to: 'copying_files' }) as const,
			FilesCopied: () => ({ from: 'copying_files', to: 'running_setup_command' }) as const,
			SetupCommandFinished: () => ({ from: 'running_setup_command', to: 'done' }) as const,
		}),
	)
	if (current.status.status !== rule.from) return yield* invalidTransition(current.status.status, result._tag)
	if (Predicate.isTagged(result, 'SourceChecked') && !result.repoAvailable) {
		return yield* new WorkspaceRepositoryProgressInvalid({
			message: 'SourceChecked must confirm that the repository is available',
		})
	}

	const ownedFields = Match.value(result).pipe(
		Match.tagsExhaustive({
			SetupStarted: () => ({}),
			ManagedCloneRequested: (value) => ({
				repo_available: false,
				source_kind: 'managed_clone' as const,
				source_path: value.sourcePath,
			}),
			SourceChecked: (value) => ({
				repo_available: value.repoAvailable,
				source_kind: value.sourceKind,
				source_path: value.sourcePath,
			}),
			ManagedCloneReady: (value) => ({
				repo_available: true,
				source_kind: 'managed_clone' as const,
				source_path: value.sourcePath,
			}),
			SourceRefreshed: (value) => ({ source_kind: value.sourceKind, source_path: value.sourcePath }),
			CommitResolved: (value) => ({ resolved_commit: value.resolvedCommit }),
			WorktreeMaterialized: (value) => ({ materialization: value.materialization }),
			BranchPublishFinished: (value) => ({ branch_publish_status: value.status }),
			FilesCopied: (value) => ({ copy_result: value.result }),
			SetupCommandFinished: (value) => ({ setup_command_result: value.result }),
		}),
	)
	const update: StatusUpdate = { status: rule.to, error: null, ...ownedFields }
	return { update }
})

const invalidTransition = (status: WorkspaceRepositorySetupStage, resultTag: string) =>
	new WorkspaceRepositoryProgressInvalid({
		message: `Result ${resultTag} is not valid while repository status is ${status}`,
	})

/** Sets the baseCommit on the matching repository entry if it hasn't been pinned yet. */
function setBaseCommitIfUnpinned(
	repositories: WorkspaceRepositories,
	repositoryIdentity: string,
	resolvedCommit: string,
): WorkspaceRepositories {
	return repositories.map((repository) =>
		repository.repositoryIdentity === repositoryIdentity && repository.baseCommit === undefined
			? { ...repository, baseCommit: resolvedCommit }
			: repository,
	)
}
