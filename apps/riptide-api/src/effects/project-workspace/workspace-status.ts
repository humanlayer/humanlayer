import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { tasks } from '@humanlayer/db/tables/tasks'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaceMaterializationIdentityKey } from '@humanlayer/schemas/effect/project-workspace'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { requireTaskReadPermission } from '../services/postgres/helpers'
import { PostgresDb } from '../services/postgres/postgres-db.service'
import { WorkspaceRepositoryProgressInvalid } from './errors'
import type { ProjectActorContext } from './project-operations'
import { readWorkspaceRepositoryActorSnapshotWithExecutor } from './workspace-reads'

interface GetProjectWorkspaceStatusInput {
	readonly actor: ProjectActorContext
	readonly taskId: string
}

export const getProjectWorkspaceStatus = Effect.fn('project_workspace.get_status')(function* (
	input: GetProjectWorkspaceStatusInput,
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
					.select({
						projectId: tasks.project_id,
						workspaceId: tasks.workspace_id,
						resourceOwnerUserId: tasks.resource_owner_user_id,
					})
					.from(tasks)
					.where(and(eq(tasks.organization_id, input.actor.organizationId), eq(tasks.id, input.taskId)))
					.limit(1),
			)
			if (!task || task.projectId === null || task.workspaceId === null || task.resourceOwnerUserId === null) {
				return yield* new WorkspaceRepositoryProgressInvalid({ message: 'Task has no project workspace' })
			}
			const projectId = task.projectId
			const workspaceId = task.workspaceId
			const resourceOwnerUserId = task.resourceOwnerUserId
			const hosts = yield* transaction.query(
				transaction.client
					.select({
						hostId: onlineHosts.host_id,
						hostName: onlineHosts.host_name,
						userId: onlineHosts.user_id,
					})
					.from(onlineHosts)
					.where(
						and(
							eq(onlineHosts.organization_id, input.actor.organizationId),
							eq(onlineHosts.user_id, resourceOwnerUserId),
						),
					),
			)
			const hostNames = new Map(hosts.map((host) => [workspaceMaterializationIdentityKey(host), host.hostName]))

			const statusRows = yield* transaction.query(
				transaction.client
					.select({
						repositoryIdentity: workspaceRepositoryStatusForUserForHost.repository_identity,
						hostId: workspaceRepositoryStatusForUserForHost.host_id,
					})
					.from(workspaceRepositoryStatusForUserForHost)
					.where(
						and(
							eq(workspaceRepositoryStatusForUserForHost.organization_id, input.actor.organizationId),
							eq(workspaceRepositoryStatusForUserForHost.project_id, projectId),
							eq(workspaceRepositoryStatusForUserForHost.workspace_id, workspaceId),
							eq(workspaceRepositoryStatusForUserForHost.user_id, resourceOwnerUserId),
						),
					)
					.orderBy(
						asc(workspaceRepositoryStatusForUserForHost.host_id),
						asc(workspaceRepositoryStatusForUserForHost.repository_identity),
					),
			)
			const repositories = yield* Effect.forEach(statusRows, (row) =>
				readWorkspaceRepositoryActorSnapshotWithExecutor(transaction, {
					organizationId: input.actor.organizationId,
					projectId,
					workspaceId,
					userId: resourceOwnerUserId,
					hostId: row.hostId,
					repositoryIdentity: row.repositoryIdentity,
				}),
			)
			const first = repositories[0]
			if (!first) {
				return yield* new WorkspaceRepositoryProgressInvalid({
					message: 'Workspace has no repository status rows',
				})
			}
			const materializationsByOwnerAndHost = new Map<
				string,
				{
					userId: string
					hostId: string
					hostName: string | null
					location: (typeof repositories)[number]['location']
					repositories: typeof repositories
				}
			>()
			for (const repository of repositories) {
				const key = workspaceMaterializationIdentityKey(repository.status)
				const materialization = materializationsByOwnerAndHost.get(key)
				if (materialization) {
					materialization.repositories.push(repository)
					continue
				}
				materializationsByOwnerAndHost.set(key, {
					userId: repository.status.userId,
					hostId: repository.status.hostId,
					hostName: hostNames.get(key) ?? null,
					location: repository.location,
					repositories: [repository],
				})
			}
			return { workspace: first.workspace, materializations: [...materializationsByOwnerAndHost.values()] }
		}),
	)
})
