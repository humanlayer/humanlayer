import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { tasks } from '@humanlayer/db/tables/tasks'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaces, workspaceSelectSchema } from '@humanlayer/db/tables/workspaces'
import type { RepositorySourceSelections, WorkspaceRepositories } from '@humanlayer/schemas/effect/project-workspace'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { requireTaskEditPermission, requireTaskReadPermission } from '../services/postgres/helpers'
import { PostgresDb, type PostgresTransaction } from '../services/postgres/postgres-db.service'
import { ProjectLocationInvalid, RepositorySourcesInvalid, WorkspaceRepositoryProgressInvalid } from './errors'
import type { ProjectActorContext } from './project-operations'
import {
	readRepositoryLocationsWithExecutor,
	repositoryLocationsByIdentity,
	upsertRepositorySourcePreferencesWithExecutor,
} from './repository-locations'
import { readSessionDirectoryWithExecutor } from './workspace-placement'

type WorkspaceSourceScope = {
	readonly actor: ProjectActorContext
	readonly taskId: string
	readonly hostId: string
}

const requireOwnedHost = Effect.fn('project_workspace.require_owned_source_host')(function* (
	transaction: PostgresTransaction,
	input: WorkspaceSourceScope,
) {
	const [host] = yield* transaction.query(
		transaction.client
			.select({ id: onlineHosts.host_id })
			.from(onlineHosts)
			.where(
				and(
					eq(onlineHosts.organization_id, input.actor.organizationId),
					eq(onlineHosts.user_id, input.actor.userId),
					eq(onlineHosts.host_id, input.hostId),
				),
			)
			.limit(1),
	)
	if (!host)
		return yield* new ProjectLocationInvalid({ message: 'The selected host is not registered for this user' })
})

const loadTaskWorkspace = Effect.fn('project_workspace.load_task_workspace_sources')(function* (
	transaction: PostgresTransaction,
	input: WorkspaceSourceScope,
) {
	const [task] = yield* transaction.query(
		transaction.client
			.select({ projectId: tasks.project_id, workspaceId: tasks.workspace_id })
			.from(tasks)
			.where(and(eq(tasks.organization_id, input.actor.organizationId), eq(tasks.id, input.taskId)))
			.limit(1),
	)
	if (!task?.projectId || !task.workspaceId) {
		return yield* new WorkspaceRepositoryProgressInvalid({ message: 'Task has no project workspace' })
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
	const workspace = workspaceSelectSchema.safeParse(workspaceRow)
	if (!workspace.success) {
		return yield* new WorkspaceRepositoryProgressInvalid({ message: 'Stored workspace snapshot is invalid' })
	}
	return {
		projectId: task.projectId,
		workspaceId: task.workspaceId,
		repositories: workspace.data.repositories,
	}
})

const projectWorkspaceRepositorySourcesProjection = Effect.fn('project_workspace.task_repository_sources_projection')(
	function* (
		transaction: PostgresTransaction,
		input: WorkspaceSourceScope,
		workspace: {
			readonly projectId: string
			readonly workspaceId: string
			readonly repositories: WorkspaceRepositories
		},
	) {
		const identities = workspace.repositories.map((repository) => repository.repositoryIdentity)
		const preferences = repositoryLocationsByIdentity(
			yield* readRepositoryLocationsWithExecutor(transaction, {
				...input.actor,
				hostId: input.hostId,
				repositoryIdentities: identities,
			}),
		)
		const [placement] = yield* transaction.query(
			transaction.client
				.select({ filePath: workspaceLocationsForUserForHost.file_path })
				.from(workspaceLocationsForUserForHost)
				.where(
					and(
						eq(workspaceLocationsForUserForHost.organization_id, input.actor.organizationId),
						eq(workspaceLocationsForUserForHost.project_id, workspace.projectId),
						eq(workspaceLocationsForUserForHost.workspace_id, workspace.workspaceId),
						eq(workspaceLocationsForUserForHost.user_id, input.actor.userId),
						eq(workspaceLocationsForUserForHost.host_id, input.hostId),
					),
				)
				.limit(1),
		)
		const sessionDirectory =
			placement === undefined
				? null
				: yield* readSessionDirectoryWithExecutor(transaction, {
						...input.actor,
						hostId: input.hostId,
						workspace: {
							id: workspace.workspaceId,
							projectId: workspace.projectId,
							repositories: workspace.repositories,
						},
						placementFilePath: placement.filePath,
					})
		const sources: RepositorySourceSelections = Object.fromEntries(
			identities.map((identity) => {
				const preference = preferences.get(identity)
				return [
					identity,
					preference?.kind === 'filesystem'
						? { kind: 'filesystem' as const, path: preference.path }
						: preference?.kind === 'managed_clone'
							? { kind: 'managed_clone' as const }
							: { kind: 'unknown' as const },
				]
			}),
		)
		return {
			taskId: input.taskId,
			hostId: input.hostId,
			projectId: workspace.projectId,
			workspaceId: workspace.workspaceId,
			placementExists: placement !== undefined,
			sessionDirectory,
			repositories: workspace.repositories,
			sources,
		}
	},
)

export const getProjectWorkspaceRepositorySources = Effect.fn('project_workspace.get_task_repository_sources')(
	function* (input: WorkspaceSourceScope) {
		const postgres = yield* PostgresDb
		return yield* postgres.transaction((transaction) =>
			Effect.gen(function* () {
				yield* requireTaskReadPermission(transaction, {
					taskId: input.taskId,
					userId: input.actor.userId,
					organizationId: input.actor.organizationId,
				})
				yield* requireOwnedHost(transaction, input)
				const workspace = yield* loadTaskWorkspace(transaction, input)
				return yield* projectWorkspaceRepositorySourcesProjection(transaction, input, workspace)
			}),
		)
	},
)

export const upsertProjectWorkspaceRepositorySources = Effect.fn('project_workspace.upsert_task_repository_sources')(
	function* (input: WorkspaceSourceScope & { readonly sources: RepositorySourceSelections }) {
		const postgres = yield* PostgresDb
		return yield* postgres.transaction((transaction) =>
			Effect.gen(function* () {
				yield* requireTaskEditPermission(transaction, {
					taskId: input.taskId,
					userId: input.actor.userId,
					organizationId: input.actor.organizationId,
				})
				yield* requireOwnedHost(transaction, input)
				const workspace = yield* loadTaskWorkspace(transaction, input)
				const allowed = new Set(workspace.repositories.map((repository) => repository.repositoryIdentity))
				const invalid = Object.keys(input.sources).find((identity) => !allowed.has(identity))
				if (invalid) {
					return yield* new RepositorySourcesInvalid({
						message: `Repository ${invalid} is not part of this workspace`,
					})
				}
				yield* upsertRepositorySourcePreferencesWithExecutor(transaction, {
					...input.actor,
					hostId: input.hostId,
					sources: input.sources,
				})
				return yield* projectWorkspaceRepositorySourcesProjection(transaction, input, workspace)
			}),
		)
	},
)
