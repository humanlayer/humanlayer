import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import {
	workspaceRepositoryStatusForUserForHost,
	workspaceRepositoryStatusSelectSchema,
} from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces, workspaceSelectSchema } from '@humanlayer/db/tables/workspaces'
import type {
	RepositorySourceCandidate,
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositoryStatusIdentity,
} from '@humanlayer/schemas/effect/project-workspace'
import * as Sentry from '@sentry/node'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { PostgresDb, type PostgresTransaction } from '../services/postgres/postgres-db.service'
import { WorkspaceRepositoryProgressInvalid } from './errors'
import { readRepositoryLocationsWithExecutor, type RepositoryLocationScope } from './repository-locations'

export type WorkspaceRepositoryActorIdentity = WorkspaceRepositoryStatusIdentity & RepositoryLocationScope

const joinedSnapshotSelection = {
	workspace: workspaces,
	location: workspaceLocationsForUserForHost,
	status: workspaceRepositoryStatusForUserForHost,
}

const snapshotJoin = (db: PostgresTransaction) =>
	db.client
		.select(joinedSnapshotSelection)
		.from(workspaceRepositoryStatusForUserForHost)
		.innerJoin(
			workspaces,
			and(
				eq(workspaces.organization_id, workspaceRepositoryStatusForUserForHost.organization_id),
				eq(workspaces.project_id, workspaceRepositoryStatusForUserForHost.project_id),
				eq(workspaces.id, workspaceRepositoryStatusForUserForHost.workspace_id),
			),
		)
		.innerJoin(
			workspaceLocationsForUserForHost,
			and(
				eq(
					workspaceLocationsForUserForHost.organization_id,
					workspaceRepositoryStatusForUserForHost.organization_id,
				),
				eq(workspaceLocationsForUserForHost.project_id, workspaceRepositoryStatusForUserForHost.project_id),
				eq(workspaceLocationsForUserForHost.workspace_id, workspaceRepositoryStatusForUserForHost.workspace_id),
				eq(workspaceLocationsForUserForHost.user_id, workspaceRepositoryStatusForUserForHost.user_id),
				eq(workspaceLocationsForUserForHost.host_id, workspaceRepositoryStatusForUserForHost.host_id),
			),
		)

type JoinedSnapshotRow = Awaited<ReturnType<ReturnType<typeof snapshotJoin>['execute']>>[number]

export const getWorkspaceRepositoryStatusForUserForHost = Effect.fn(
	'project_workspace.get_workspace_repository_status_for_user_for_host',
)(function* (identity: WorkspaceRepositoryActorIdentity) {
	const db = yield* PostgresDb
	return yield* readWorkspaceRepositoryActorSnapshotWithExecutor(db, identity)
})

export const readWorkspaceRepositoryActorSnapshotWithExecutor = Effect.fn(
	'project_workspace.read_actor_snapshot_with_executor',
)(function* (db: PostgresTransaction, identity: WorkspaceRepositoryActorIdentity) {
	const rows = yield* db.query(
		snapshotJoin(db)
			.where(
				and(
					eq(workspaceRepositoryStatusForUserForHost.organization_id, identity.organizationId),
					eq(workspaceRepositoryStatusForUserForHost.project_id, identity.projectId),
					eq(workspaceRepositoryStatusForUserForHost.workspace_id, identity.workspaceId),
					eq(workspaceRepositoryStatusForUserForHost.user_id, identity.userId),
					eq(workspaceRepositoryStatusForUserForHost.host_id, identity.hostId),
					eq(workspaceRepositoryStatusForUserForHost.repository_identity, identity.repositoryIdentity),
				),
			)
			.limit(1),
	)
	const row = rows[0]
	if (!row) {
		return yield* new WorkspaceRepositoryProgressInvalid({ message: 'Workspace repository status was not found' })
	}
	const locations =
		row.status.source_policy === null
			? yield* readRepositoryLocationsWithExecutor(db, {
					...identity,
					repositoryIdentities: [identity.repositoryIdentity],
				})
			: []
	const sourceCandidates: RepositorySourceCandidate[] =
		row.status.source_policy === 'filesystem_required' &&
		row.status.source_kind === 'filesystem' &&
		row.status.source_path !== null
			? [{ sourceKind: 'filesystem', sourcePath: row.status.source_path }]
			: locations.flatMap((location) =>
					location.kind === 'filesystem'
						? [{ sourceKind: 'filesystem' as const, sourcePath: location.path }]
						: [],
				)
	return yield* parseWorkspaceRepositoryActorSnapshot(row, sourceCandidates)
})

const parseWorkspaceRepositoryActorSnapshot = Effect.fn('project_workspace.parse_actor_snapshot')(function* (
	rawRow: JoinedSnapshotRow,
	sourceCandidates: RepositorySourceCandidate[],
) {
	const workspace = workspaceSelectSchema.safeParse(rawRow.workspace)
	if (!workspace.success) {
		yield* Effect.logError(workspace.error)
		yield* Effect.sync(() => Sentry.captureException(workspace.error))
		return yield* new WorkspaceRepositoryProgressInvalid({
			message: 'Stored workspace repository snapshot is invalid',
		})
	}
	const status = workspaceRepositoryStatusSelectSchema.safeParse(rawRow.status)
	if (!status.success) {
		yield* Effect.logError(status.error)
		yield* Effect.sync(() => Sentry.captureException(status.error))
		return yield* new WorkspaceRepositoryProgressInvalid({
			message: 'Stored workspace repository snapshot is invalid',
		})
	}
	const row = { workspace: workspace.data, status: status.data, location: rawRow.location }
	const repository = row.workspace.repositories.find(
		(candidate) => candidate.repositoryIdentity === row.status.repository_identity,
	)
	if (!repository) {
		return yield* new WorkspaceRepositoryProgressInvalid({
			message: `Workspace snapshot is missing repository ${row.status.repository_identity}`,
		})
	}

	return {
		sourceCandidates,
		workspace: {
			id: row.workspace.id,
			organizationId: row.workspace.organization_id,
			projectId: row.workspace.project_id,
			name: row.workspace.name,
			description: row.workspace.description,
			createdBy: row.workspace.created_by,
			resourceOwnerUserId: row.workspace.resource_owner_user_id,
			repositories: row.workspace.repositories,
			archived: row.workspace.archived,
			createdAt: Number(row.workspace.created_at),
			updatedAt: Number(row.workspace.updated_at),
		},
		repository,
		location: {
			organizationId: row.location.organization_id,
			projectId: row.location.project_id,
			workspaceId: row.location.workspace_id,
			userId: row.location.user_id,
			hostId: row.location.host_id,
			filePath: row.location.file_path,
			setupGeneration: Number(row.location.setup_generation),
			createdAt: Number(row.location.created_at),
			updatedAt: Number(row.location.updated_at),
		},
		status: {
			organizationId: row.status.organization_id,
			projectId: row.status.project_id,
			workspaceId: row.status.workspace_id,
			userId: row.status.user_id,
			hostId: row.status.host_id,
			repositoryIdentity: row.status.repository_identity,
			repositoryRemoteUrl: row.status.repository_remote_url,
			status: row.status.status,
			repoAvailable: row.status.repo_available,
			sourcePolicy: row.status.source_policy,
			sourceKind: row.status.source_kind,
			sourcePath: row.status.source_path,
			resolvedCommit: row.status.resolved_commit,
			materialization: row.status.materialization,
			branchPublishStatus: row.status.branch_publish_status,
			copyResult: row.status.copy_result,
			setupCommandResult: row.status.setup_command_result,
			acceptedSkips: row.status.accepted_skips,
			error: row.status.error,
			generation: Number(row.status.generation),
			currentBranch: row.status.current_branch,
			localHead: row.status.local_head,
			remoteHead: row.status.remote_head,
			aheadCount: row.status.ahead_count,
			behindCount: row.status.behind_count,
			dirty: row.status.dirty,
			gitStateCheckedAt:
				row.status.git_state_checked_at === null ? null : Number(row.status.git_state_checked_at),
			createdAt: Number(row.status.created_at),
			updatedAt: Number(row.status.updated_at),
		},
	} satisfies WorkspaceRepositoryActorSnapshot
})
