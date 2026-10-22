import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import {
	taskWorkspaceRoot,
	taskWorkspaceSessionDirectory,
} from '@humanlayer/riptide-api-contract/lib/task-workspace-path'
import type { WorkspaceLocation, WorkspaceSnapshot } from '@humanlayer/schemas/effect/project-workspace'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { PostgresTransaction } from '../services/postgres/postgres-db.service'
import { ProjectPersistenceUnavailable, RepositorySourcesRequired } from './errors'
import { readRepositoryLocationsWithExecutor, repositoryLocationsByIdentity } from './repository-locations'

type EnsureWorkspacePlacementInput = Pick<WorkspaceLocation, 'organizationId' | 'userId' | 'hostId'> & {
	readonly workspace: Pick<WorkspaceSnapshot, 'id' | 'projectId' | 'repositories'>
	readonly pathSegment: string
}

// A placement is created atomically with its repository intents. Existing placements, including
// parked errors and completed work, are never reset by another session or a replay.
export const ensureWorkspacePlacementWithExecutor = Effect.fn('project_workspace.ensure_placement')(function* (
	db: PostgresTransaction,
	input: EnsureWorkspacePlacementInput,
) {
	const table = workspaceLocationsForUserForHost
	const [created] = yield* db.query(
		db.client
			.insert(table)
			.values({
				organization_id: input.organizationId,
				project_id: input.workspace.projectId,
				workspace_id: input.workspace.id,
				user_id: input.userId,
				host_id: input.hostId,
				// HOME is resolved only by this user's daemon, never from another placement's path.
				file_path: taskWorkspaceRoot(input.pathSegment),
				setup_generation: 1n,
			})
			.onConflictDoNothing()
			.returning(),
	)
	if (created !== undefined) {
		const sources = repositoryLocationsByIdentity(
			yield* readRepositoryLocationsWithExecutor(db, {
				organizationId: input.organizationId,
				userId: input.userId,
				hostId: input.hostId,
				repositoryIdentities: input.workspace.repositories.map((repository) => repository.repositoryIdentity),
			}),
		)
		const missingRepositoryIdentities = input.workspace.repositories
			.map((repository) => repository.repositoryIdentity)
			.filter((repositoryIdentity) => !sources.has(repositoryIdentity))
		if (missingRepositoryIdentities.length > 0) {
			return yield* new RepositorySourcesRequired({
				projectId: input.workspace.projectId,
				workspaceId: input.workspace.id,
				hostId: input.hostId,
				missingRepositoryIdentities,
			})
		}
		const repositoryStatuses = yield* Effect.forEach(input.workspace.repositories, (repository) =>
			Effect.gen(function* () {
				const source = sources.get(repository.repositoryIdentity)
				if (source === undefined) return yield* Effect.die('Repository source preference disappeared')
				return {
					organization_id: input.organizationId,
					project_id: input.workspace.projectId,
					workspace_id: input.workspace.id,
					user_id: input.userId,
					host_id: input.hostId,
					repository_identity: repository.repositoryIdentity,
					repository_remote_url: repository.remoteUrl,
					status: 'setup_requested' as const,
					repo_available: false,
					source_policy:
						source.kind === 'filesystem' ? ('filesystem_required' as const) : ('managed_clone' as const),
					source_kind: source.kind === 'filesystem' ? ('filesystem' as const) : null,
					source_path: source.kind === 'filesystem' ? source.path : null,
					resolved_commit: repository.baseCommit ?? null,
					generation: created.setup_generation,
				}
			}),
		)
		yield* db.query(db.client.insert(workspaceRepositoryStatusForUserForHost).values(repositoryStatuses))
		return { filePath: created.file_path, setupGeneration: Number(created.setup_generation) }
	}
	const [existing] = yield* db.query(
		db.client
			.select()
			.from(table)
			.where(
				and(
					eq(table.organization_id, input.organizationId),
					eq(table.project_id, input.workspace.projectId),
					eq(table.workspace_id, input.workspace.id),
					eq(table.user_id, input.userId),
					eq(table.host_id, input.hostId),
				),
			)
			.limit(1),
	)
	if (existing === undefined) return yield* new ProjectPersistenceUnavailable({ operation: 'ensure_placement' })
	return { filePath: existing.file_path, setupGeneration: Number(existing.setup_generation) }
})

type ReadSessionDirectoryInput = Pick<WorkspaceLocation, 'organizationId' | 'userId' | 'hostId'> & {
	readonly workspace: Pick<WorkspaceSnapshot, 'id' | 'projectId' | 'repositories'>
	readonly placementFilePath: string
}

// The folder a session runs in on this host. Reads the default repository's saved worktree so
// tasks set up under an older folder naming scheme keep opening where their files are.
export const readSessionDirectoryWithExecutor = Effect.fn('project_workspace.read_session_directory')(function* (
	db: PostgresTransaction,
	input: ReadSessionDirectoryInput,
) {
	const { repositories } = input.workspace
	const defaultRepository = repositories.find((repository) => repository.default) ?? repositories[0]
	if (repositories.length === 1 || defaultRepository === undefined) return input.placementFilePath
	const table = workspaceRepositoryStatusForUserForHost
	const [status] = yield* db.query(
		db.client
			.select({ materialization: table.materialization })
			.from(table)
			.where(
				and(
					eq(table.organization_id, input.organizationId),
					eq(table.project_id, input.workspace.projectId),
					eq(table.workspace_id, input.workspace.id),
					eq(table.user_id, input.userId),
					eq(table.host_id, input.hostId),
					eq(table.repository_identity, defaultRepository.repositoryIdentity),
				),
			)
			.limit(1),
	)
	const savedFolder = status?.materialization?.path.split('/').findLast((segment) => segment.length > 0)
	if (savedFolder !== undefined) return `${input.placementFilePath}/${savedFolder}`
	// Set up here, but the daemon has not created the worktree yet; it names it the same way.
	return taskWorkspaceSessionDirectory(input.placementFilePath, repositories)
})
