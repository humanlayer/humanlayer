import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import type { RepositorySourcePreference } from '@humanlayer/schemas/effect/project-workspace'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { requireTaskEditPermission } from '../services/postgres/helpers'
import { PostgresDb, type PostgresTransaction } from '../services/postgres/postgres-db.service'
import {
	ProjectsV2Disabled,
	WorkspaceRepositoryProgressInvalid,
	WorkspaceRepositoryNothingToRetry,
	WorkspaceRepositorySkipNotAllowed,
	WorkspaceRepositorySourceRecoveryNotAllowed,
	WorkspaceRepositoryStatusChanged,
} from './errors'
import type { ProjectActorContext } from './project-operations'
import { upsertRepositorySourcePreferencesWithExecutor } from './repository-locations'
import { readWorkspaceRepositoryActorSnapshotWithExecutor } from './workspace-reads'

type RecoveryInput = {
	readonly actor: ProjectActorContext
	readonly taskId: string
	readonly hostId: string
	readonly repositoryIdentity: string
	readonly expectedUpdatedAt: number
}

const requireProjectsV2Enabled = (transaction: PostgresTransaction, actor: RecoveryInput['actor']) =>
	transaction
		.query(
			transaction.client
				.select({ enabled: userSettings.projects_v2_enabled })
				.from(userSettings)
				.where(
					and(eq(userSettings.organization_id, actor.organizationId), eq(userSettings.user_id, actor.userId)),
				)
				.limit(1),
		)
		.pipe(Effect.flatMap((rows) => (rows[0]?.enabled ? Effect.void : new ProjectsV2Disabled())))

const loadRecoveryTarget = Effect.fn('project_workspace.load_recovery_target')(function* (
	transaction: PostgresTransaction,
	input: RecoveryInput,
) {
	yield* requireProjectsV2Enabled(transaction, input.actor)
	yield* requireTaskEditPermission(transaction, {
		taskId: input.taskId,
		userId: input.actor.userId,
		organizationId: input.actor.organizationId,
	})
	const [task] = yield* transaction.query(
		transaction.client
			.select({ projectId: tasks.project_id, workspaceId: tasks.workspace_id })
			.from(tasks)
			.where(and(eq(tasks.organization_id, input.actor.organizationId), eq(tasks.id, input.taskId)))
			.limit(1),
	)
	if (!task || task.projectId === null || task.workspaceId === null) {
		return yield* new WorkspaceRepositoryProgressInvalid({ message: 'Task has no project workspace' })
	}
	const identity = {
		organizationId: input.actor.organizationId,
		projectId: task.projectId,
		workspaceId: task.workspaceId,
		userId: input.actor.userId,
		hostId: input.hostId,
		repositoryIdentity: input.repositoryIdentity,
	}
	const current = yield* readWorkspaceRepositoryActorSnapshotWithExecutor(transaction, identity)
	if (current.status.updatedAt !== input.expectedUpdatedAt) {
		return yield* new WorkspaceRepositoryStatusChanged({ snapshot: current })
	}
	return { current, identity }
})

const updateCurrentStatus = Effect.fn('project_workspace.update_recovery_status')(function* (
	transaction: PostgresTransaction,
	input: RecoveryInput,
	update: Partial<typeof workspaceRepositoryStatusForUserForHost.$inferInsert>,
) {
	const { current, identity } = yield* loadRecoveryTarget(transaction, input)
	const now = yield* Clock.currentTimeMillis
	const [updated] = yield* transaction.query(
		transaction.client
			.update(workspaceRepositoryStatusForUserForHost)
			.set({ ...update, updated_at: BigInt(Math.max(now, current.status.updatedAt + 1)) })
			.where(
				and(
					eq(workspaceRepositoryStatusForUserForHost.organization_id, identity.organizationId),
					eq(workspaceRepositoryStatusForUserForHost.project_id, identity.projectId),
					eq(workspaceRepositoryStatusForUserForHost.workspace_id, identity.workspaceId),
					eq(workspaceRepositoryStatusForUserForHost.user_id, identity.userId),
					eq(workspaceRepositoryStatusForUserForHost.host_id, identity.hostId),
					eq(workspaceRepositoryStatusForUserForHost.repository_identity, identity.repositoryIdentity),
					eq(workspaceRepositoryStatusForUserForHost.updated_at, BigInt(input.expectedUpdatedAt)),
				),
			)
			.returning({ updatedAt: workspaceRepositoryStatusForUserForHost.updated_at }),
	)
	if (!updated) {
		return yield* new WorkspaceRepositoryStatusChanged({
			snapshot: yield* readWorkspaceRepositoryActorSnapshotWithExecutor(transaction, identity),
		})
	}
	return yield* readWorkspaceRepositoryActorSnapshotWithExecutor(transaction, identity)
})

export const retryProjectWorkspaceRepositorySetup = Effect.fn('project_workspace.retry_repository_setup')(function* (
	input: RecoveryInput,
) {
	const postgres = yield* PostgresDb
	return yield* postgres.transaction((transaction) =>
		Effect.gen(function* () {
			const { current } = yield* loadRecoveryTarget(transaction, input)
			if (current.status.error === null) {
				return yield* new WorkspaceRepositoryNothingToRetry({ snapshot: current })
			}
			return yield* updateCurrentStatus(transaction, input, { error: null })
		}),
	)
})

/**
 * Replaces a failed frozen filesystem source before any repository setup work has succeeded.
 * Staying in the current generation is safe here: checking_source has no materialized output,
 * and the policy replacement plus error clear are committed atomically under updated_at CAS.
 */
export const recoverProjectWorkspaceRepositorySource = Effect.fn('project_workspace.recover_repository_source')(
	function* (input: RecoveryInput & { readonly source: RepositorySourcePreference }) {
		const postgres = yield* PostgresDb
		return yield* postgres.transaction((transaction) =>
			Effect.gen(function* () {
				const { current } = yield* loadRecoveryTarget(transaction, input)
				if (
					current.status.sourcePolicy !== 'filesystem_required' ||
					current.status.status !== 'checking_source' ||
					current.status.error?.stage !== 'checking_source'
				) {
					return yield* new WorkspaceRepositorySourceRecoveryNotAllowed({
						message: 'Repository source can only be changed after a required filesystem source check fails',
					})
				}
				yield* upsertRepositorySourcePreferencesWithExecutor(transaction, {
					organizationId: input.actor.organizationId,
					userId: input.actor.userId,
					hostId: input.hostId,
					sources: { [input.repositoryIdentity]: input.source },
				})
				return yield* updateCurrentStatus(transaction, input, {
					status: 'checking_source',
					error: null,
					repo_available: false,
					source_policy: input.source.kind === 'filesystem' ? 'filesystem_required' : 'managed_clone',
					source_kind: input.source.kind === 'filesystem' ? 'filesystem' : null,
					source_path: input.source.kind === 'filesystem' ? input.source.path.trim() : null,
				})
			}),
		)
	},
)

export const skipProjectWorkspaceRepositorySetupStep = Effect.fn('project_workspace.skip_repository_setup_step')(
	function* (input: RecoveryInput) {
		const postgres = yield* PostgresDb
		return yield* postgres.transaction((transaction) =>
			Effect.gen(function* () {
				const { current } = yield* loadRecoveryTarget(transaction, input)
				const error = current.status.error
				if (error === null) {
					return yield* new WorkspaceRepositorySkipNotAllowed({
						message: 'Repository has no setup error to skip',
					})
				}
				const skippedStage = current.status.status
				if (skippedStage !== 'copying_files' && skippedStage !== 'running_setup_command') {
					return yield* new WorkspaceRepositorySkipNotAllowed({
						message: `The ${current.status.status} step cannot be skipped`,
					})
				}
				const nextStatus = skippedStage === 'copying_files' ? 'running_setup_command' : 'done'
				const skippedAt = yield* Clock.currentTimeMillis
				return yield* updateCurrentStatus(transaction, input, {
					status: nextStatus,
					error: null,
					accepted_skips: [
						...current.status.acceptedSkips,
						{
							stage: skippedStage,
							message: error.message,
							skippedByUserId: input.actor.userId,
							skippedAt,
						},
					],
				})
			}),
		)
	},
)
