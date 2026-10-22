import { tasks } from '@humanlayer/db/tables/tasks'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import {
	workspaceRepositoryStatusForUserForHost,
	workspaceRepositoryStatusSelectSchema,
} from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces, workspaceSelectSchema } from '@humanlayer/db/tables/workspaces'
import type {
	TaskWorkspaceContext,
	WorkspaceLocation,
	WorkspaceRepositoryStatus,
	WorkspaceSnapshot,
} from '@humanlayer/schemas/effect/project-workspace'
import * as Sentry from '@sentry/node'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { requireTaskReadPermission } from '../services/postgres/helpers'
import { PostgresDb, type PostgresTransaction } from '../services/postgres/postgres-db.service'
import { ProjectNotFound, WorkspaceRepositoryProgressInvalid } from './errors'
import type { RepositoryLocationScope } from './repository-locations'

interface ReadTaskWorkspaceContextInput {
	/** The daemon's own organization, user, and host; never a placement selected by the caller. */
	readonly actor: RepositoryLocationScope
	readonly taskId: string
}

type WorkspaceRow = (typeof workspaces)['$inferSelect']
type LocationRow = (typeof workspaceLocationsForUserForHost)['$inferSelect']
type StatusRow = (typeof workspaceRepositoryStatusForUserForHost)['$inferSelect']

const invalidStoredRecord = (message: string) =>
	Effect.fn('project_workspace.task_workspace_context.invalid_record')(function* (error: unknown) {
		yield* Effect.logError(error)
		yield* Effect.sync(() => Sentry.captureException(error))
		return yield* new WorkspaceRepositoryProgressInvalid({ message })
	})

const workspaceSnapshotFromRow = Effect.fn('project_workspace.task_workspace_context.parse_workspace')(function* (
	row: WorkspaceRow,
) {
	const parsed = workspaceSelectSchema.safeParse(row)
	if (!parsed.success) return yield* invalidStoredRecord('Stored workspace snapshot is invalid')(parsed.error)
	return {
		id: parsed.data.id,
		organizationId: parsed.data.organization_id,
		projectId: parsed.data.project_id,
		name: parsed.data.name,
		description: parsed.data.description,
		createdBy: parsed.data.created_by,
		resourceOwnerUserId: parsed.data.resource_owner_user_id,
		repositories: parsed.data.repositories,
		archived: parsed.data.archived,
		createdAt: Number(parsed.data.created_at),
		updatedAt: Number(parsed.data.updated_at),
	} satisfies WorkspaceSnapshot
})

const workspaceLocationFromRow = (row: LocationRow): WorkspaceLocation => ({
	organizationId: row.organization_id,
	projectId: row.project_id,
	workspaceId: row.workspace_id,
	userId: row.user_id,
	hostId: row.host_id,
	filePath: row.file_path,
	setupGeneration: Number(row.setup_generation),
	createdAt: Number(row.created_at),
	updatedAt: Number(row.updated_at),
})

const repositoryStatusFromRow = Effect.fn('project_workspace.task_workspace_context.parse_status')(function* (
	row: StatusRow,
) {
	const parsed = workspaceRepositoryStatusSelectSchema.safeParse(row)
	if (!parsed.success) {
		return yield* invalidStoredRecord('Stored workspace repository status is invalid')(parsed.error)
	}
	const status = parsed.data
	return {
		organizationId: status.organization_id,
		projectId: status.project_id,
		workspaceId: status.workspace_id,
		userId: status.user_id,
		hostId: status.host_id,
		repositoryIdentity: status.repository_identity,
		repositoryRemoteUrl: status.repository_remote_url,
		status: status.status,
		repoAvailable: status.repo_available,
		sourcePolicy: status.source_policy,
		sourceKind: status.source_kind,
		sourcePath: status.source_path,
		resolvedCommit: status.resolved_commit,
		materialization: status.materialization,
		branchPublishStatus: status.branch_publish_status,
		copyResult: status.copy_result,
		setupCommandResult: status.setup_command_result,
		acceptedSkips: status.accepted_skips,
		error: status.error,
		generation: Number(status.generation),
		currentBranch: status.current_branch,
		localHead: status.local_head,
		remoteHead: status.remote_head,
		aheadCount: status.ahead_count,
		behindCount: status.behind_count,
		dirty: status.dirty,
		gitStateCheckedAt: status.git_state_checked_at === null ? null : Number(status.git_state_checked_at),
		createdAt: Number(status.created_at),
		updatedAt: Number(status.updated_at),
	} satisfies WorkspaceRepositoryStatus
})

const readOwnMaterialization = Effect.fn('project_workspace.task_workspace_context.read_materialization')(function* (
	transaction: PostgresTransaction,
	input: ReadTaskWorkspaceContextInput,
	workspace: WorkspaceSnapshot,
) {
	const [location] = yield* transaction.query(
		transaction.client
			.select()
			.from(workspaceLocationsForUserForHost)
			.where(
				and(
					eq(workspaceLocationsForUserForHost.organization_id, input.actor.organizationId),
					eq(workspaceLocationsForUserForHost.project_id, workspace.projectId),
					eq(workspaceLocationsForUserForHost.workspace_id, workspace.id),
					eq(workspaceLocationsForUserForHost.user_id, input.actor.userId),
					eq(workspaceLocationsForUserForHost.host_id, input.actor.hostId),
				),
			)
			.limit(1),
	)
	if (location === undefined) return null
	// Only the placement's current generation describes usable worktrees; older rows are stale facts.
	const statusRows = yield* transaction.query(
		transaction.client
			.select()
			.from(workspaceRepositoryStatusForUserForHost)
			.where(
				and(
					eq(workspaceRepositoryStatusForUserForHost.organization_id, input.actor.organizationId),
					eq(workspaceRepositoryStatusForUserForHost.project_id, workspace.projectId),
					eq(workspaceRepositoryStatusForUserForHost.workspace_id, workspace.id),
					eq(workspaceRepositoryStatusForUserForHost.user_id, input.actor.userId),
					eq(workspaceRepositoryStatusForUserForHost.host_id, input.actor.hostId),
					eq(workspaceRepositoryStatusForUserForHost.generation, location.setup_generation),
				),
			)
			.orderBy(asc(workspaceRepositoryStatusForUserForHost.repository_identity)),
	)
	const repositories = yield* Effect.forEach(statusRows, repositoryStatusFromRow)
	return { location: workspaceLocationFromRow(location), repositories }
})

/**
 * Reads the immutable workspace snapshot behind a task together with the calling user/host's own
 * materialization. Any task reader may read the snapshot; the materialization is always the
 * caller's, so no daemon can observe or adopt another user's worktrees through this read.
 */
export const readTaskWorkspaceContext = Effect.fn('project_workspace.read_task_workspace_context')(function* (
	input: ReadTaskWorkspaceContextInput,
) {
	const postgres = yield* PostgresDb
	return yield* postgres.transaction((transaction) =>
		Effect.gen(function* () {
			yield* requireTaskReadPermission(transaction, {
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
			if (task === undefined || task.projectId === null || task.workspaceId === null) {
				return yield* new ProjectNotFound({ projectId: input.taskId })
			}
			const [workspaceRow] = yield* transaction.query(
				transaction.client
					.select()
					.from(workspaces)
					.where(
						and(
							eq(workspaces.organization_id, input.actor.organizationId),
							eq(workspaces.project_id, task.projectId),
							eq(workspaces.id, task.workspaceId),
						),
					)
					.limit(1),
			)
			if (workspaceRow === undefined) {
				return yield* new ProjectNotFound({ projectId: task.workspaceId })
			}
			const workspace = yield* workspaceSnapshotFromRow(workspaceRow)
			const materialization = yield* readOwnMaterialization(transaction, input, workspace)
			return { taskId: input.taskId, workspace, materialization } satisfies TaskWorkspaceContext
		}),
	)
})
