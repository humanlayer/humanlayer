import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { workspaces, workspaceSelectSchema } from '@humanlayer/db/tables/workspaces'
import type { CreateSessionV2Input } from '@humanlayer/riptide-api-contract/api/sessions/v2/create'
import { resolveTaskWorkspacePathSegment } from '@humanlayer/riptide-api-contract/lib/task-workspace-path'
import * as Sentry from '@sentry/node'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { canWriteSession, checkTaskWritePermission } from '../../db/task-auth'
import { getTransactionId } from '../services/postgres/helpers'
import { PostgresDb } from '../services/postgres/postgres-db.service'
import { SessionTitleGeneration } from '../services/session-title-generation/session-title-generation.service'
import {
	ProjectLocationInvalid,
	ProjectNotFound,
	ProjectPersistenceUnavailable,
	ProjectsV2Disabled,
	ProjectMutationForbidden,
} from './errors'
import type { ProjectActorContext } from './project-operations'
import { generateProjectWorkspaceId } from './project-workspace-id'
import { ensureWorkspacePlacementWithExecutor, readSessionDirectoryWithExecutor } from './workspace-placement'

export const createSessionV2 = Effect.fn('project_workspace.create_session_v2')(function* (
	input: CreateSessionV2Input & {
		readonly actor: ProjectActorContext
	},
) {
	const postgres = yield* PostgresDb
	const sessionTitleGeneration = yield* SessionTitleGeneration
	const requestedTitle = input.title?.trim() ? input.title : null

	if (input.draftId && input.sessionId && input.draftId !== input.sessionId) {
		return yield* new ProjectLocationInvalid({ message: 'Draft and session IDs must match' })
	}
	const sessionId = input.draftId ?? input.sessionId ?? (yield* generateProjectWorkspaceId())
	const eventId = input.eventId ?? (yield* generateProjectWorkspaceId())

	const createdSession = yield* postgres
		.transaction((transaction) =>
			Effect.gen(function* () {
				const [settings] = yield* transaction.query(
					transaction.client
						.select()
						.from(userSettings)
						.where(
							and(
								eq(userSettings.organization_id, input.actor.organizationId),
								eq(userSettings.user_id, input.actor.userId),
							),
						)
						.limit(1),
				)
				if (settings?.projects_v2_enabled !== true) return yield* new ProjectsV2Disabled()
				const access = yield* transaction.run(() =>
					checkTaskWritePermission(
						transaction.client,
						input.taskId,
						input.actor.userId,
						input.actor.organizationId,
					),
				)
				if (!access.ok) {
					if (access.reason === 'not_found') return yield* new ProjectNotFound({ projectId: input.taskId })
					return yield* new ProjectMutationForbidden({ projectId: input.taskId })
				}
				const [task] = yield* transaction.query(
					transaction.client
						.select()
						.from(tasks)
						.where(
							and(
								eq(tasks.id, input.taskId),
								eq(tasks.organization_id, input.actor.organizationId),
								eq(tasks.workspace_id, input.workspaceId),
							),
						)
						.limit(1),
				)
				if (!task) {
					return yield* Effect.fail(new ProjectNotFound({ projectId: input.taskId }))
				}

				const [workspace] = yield* transaction.query(
					transaction.client
						.select()
						.from(workspaces)
						.where(
							and(
								eq(workspaces.id, input.workspaceId),
								eq(workspaces.organization_id, input.actor.organizationId),
							),
						)
						.limit(1),
				)
				if (!workspace) {
					return yield* Effect.fail(new ProjectNotFound({ projectId: input.workspaceId }))
				}
				const parsedWorkspace = workspaceSelectSchema.safeParse(workspace)
				if (!parsedWorkspace.success) {
					yield* Effect.logError(parsedWorkspace.error)
					yield* Effect.sync(() => Sentry.captureException(parsedWorkspace.error))
					return yield* new ProjectPersistenceUnavailable({ operation: 'parse_workspace' })
				}

				const [host] = yield* transaction.query(
					transaction.client
						.select({ hostId: onlineHosts.host_id })
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
				if (!host) {
					return yield* new ProjectLocationInvalid({
						message: 'The selected host is not registered for this user',
					})
				}

				const defaultRepo = parsedWorkspace.data.repositories.find((repository) => repository.default)
				if (!defaultRepo) {
					return yield* new ProjectLocationInvalid({
						message: 'Default repository could not be determined',
					})
				}
				if (
					input.defaultRepositoryIdentity !== undefined &&
					input.defaultRepositoryIdentity !== defaultRepo.repositoryIdentity
				) {
					return yield* new ProjectLocationInvalid({
						message: 'The workspace default repository is immutable',
					})
				}

				if (input.draftId !== undefined) {
					const [draft] = yield* transaction.query(
						transaction.client
							.select()
							.from(sessions)
							.where(
								and(
									eq(sessions.id, input.draftId),
									eq(sessions.organization_id, input.actor.organizationId),
								),
							)
							.for('no key update'),
					)
					if (!draft) return yield* new ProjectNotFound({ projectId: input.taskId })
					// Moving a draft needs access to its source as well as the destination task.
					const writable = yield* transaction.run(() =>
						canWriteSession(transaction.client, draft, input.actor.userId, input.actor.organizationId),
					)
					if (!writable) return yield* new ProjectMutationForbidden({ projectId: input.taskId })
					if (
						draft.status !== 'draft' &&
						(draft.task_id !== input.taskId || draft.host_id !== input.hostId)
					) {
						return yield* new ProjectLocationInvalid({ message: 'Session is no longer a draft' })
					}
				}

				const placementWorkspace = {
					id: workspace.id,
					projectId: workspace.project_id,
					repositories: parsedWorkspace.data.repositories,
				}
				const location = yield* ensureWorkspacePlacementWithExecutor(transaction, {
					...input.actor,
					hostId: input.hostId,
					workspace: placementWorkspace,
					pathSegment: resolveTaskWorkspacePathSegment(task.slug, workspace.id),
				})
				const workingDirectory = yield* readSessionDirectoryWithExecutor(transaction, {
					...input.actor,
					hostId: input.hostId,
					workspace: placementWorkspace,
					placementFilePath: location.filePath,
				})

				const values = {
					id: sessionId,
					task_id: input.taskId,
					organization_id: input.actor.organizationId,
					status: 'ready_for_launch' as const,
					title: requestedTitle,
					prompt: input.text,
					coding_agent: input.codingAgent,
					provider: input.provider,
					model: input.model,
					effort: input.effort ?? null,
					fast_mode: input.fastMode ?? false,
					working_directory: workingDirectory,
					host_id: input.hostId,
					permissions_mode: input.permissionsMode,
					created_by: input.actor.userId,
					resource_owner_user_id: task.resource_owner_user_id,
					num_events: 1,
				}
				const [session] = yield* transaction.query(
					input.draftId !== undefined
						? transaction.client
								.update(sessions)
								.set(values)
								.where(
									and(
										eq(sessions.id, sessionId),
										eq(sessions.organization_id, input.actor.organizationId),
										eq(sessions.created_by, input.actor.userId),
										eq(sessions.status, 'draft'),
									),
								)
								.returning()
						: transaction.client.insert(sessions).values(values).onConflictDoNothing().returning(),
				)

				if (!session) {
					const [existing] = yield* transaction.query(
						transaction.client
							.select({
								id: sessions.id,
								title: sessions.title,
								prompt: sessions.prompt,
								createdBy: sessions.created_by,
							})
							.from(sessions)
							.where(
								and(
									eq(sessions.id, sessionId),
									eq(sessions.organization_id, input.actor.organizationId),
									eq(sessions.created_by, input.actor.userId),
									eq(sessions.task_id, input.taskId),
									eq(sessions.host_id, input.hostId),
								),
							)
							.limit(1),
					)
					if (existing) {
						const txId = yield* getTransactionId(transaction)
						return {
							response: { result: 'already-exists' as const, transactionId: txId, sessionId },
							titleGeneration:
								existing.title === null && existing.prompt === input.text
									? {
											sessionId: existing.id,
											userId: existing.createdBy,
											ticketId: task.ticket_id,
											taskName: task.name,
										}
									: null,
						}
					}
					return yield* new ProjectPersistenceUnavailable({ operation: 'create_session' })
				}

				yield* transaction.query(
					transaction.client.insert(conversationEvents).values({
						id: eventId,
						session_id: sessionId,
						organization_id: input.actor.organizationId,
						resource_owner_user_id: task.resource_owner_user_id,
						task_id: input.taskId,
						event_type: 'message',
						role: 'user',
						content: input.text,
						user_id: input.actor.userId,
					}),
				)

				const txId = yield* getTransactionId(transaction)
				return {
					response: { result: 'created' as const, transactionId: txId, sessionId },
					titleGeneration: session.title
						? null
						: {
								sessionId: session.id,
								userId: session.created_by,
								ticketId: task.ticket_id,
								taskName: task.name,
							},
				}
			}),
		)
		.pipe(
			Effect.tapErrorTag('PostgresDbQueryError', (error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.tapErrorTag('PostgresDbTransactionError', (error) =>
				Effect.sync(() => Sentry.captureException(error)),
			),
		)

	// Match the legacy launch path: generate an empty title from the initial
	// prompt after the creation transaction commits.
	const titleGeneration = createdSession.titleGeneration
	if (titleGeneration && input.text) {
		yield* sessionTitleGeneration.scheduleGeneration({
			sessionId: titleGeneration.sessionId,
			organizationId: input.actor.organizationId,
			userId: titleGeneration.userId,
			prompt: input.text,
			ticketId: titleGeneration.ticketId,
			taskName: titleGeneration.taskName,
		})
	}

	return createdSession.response
})
