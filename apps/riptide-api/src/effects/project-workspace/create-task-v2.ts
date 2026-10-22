import { artifacts } from '@humanlayer/db/tables/artifacts'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { projects, projectSelectSchema } from '@humanlayer/db/tables/projects'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskLaunches } from '@humanlayer/db/tables/task-launches'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { workspaces } from '@humanlayer/db/tables/workspaces'
import type { CreateTaskV2Input } from '@humanlayer/riptide-api-contract/api/tasks/v2/create'
import {
	taskWorkspaceRoot,
	taskWorkspaceSessionDirectory,
} from '@humanlayer/riptide-api-contract/lib/task-workspace-path'
import type { ProjectRepositories, WorkspaceRepositories } from '@humanlayer/schemas/effect/project-workspace'
import { hasRepositoryUrlCredentials } from '@humanlayer/schemas/effect/project-workspace'
import * as Sentry from '@sentry/node'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { hash } from 'ohash'

import type { PreparedTicketArtifactBundle } from '../../lib/linear-ticket-artifacts'
import { getTransactionId } from '../services/postgres/helpers'
import { PostgresDb, type PostgresTransaction } from '../services/postgres/postgres-db.service'
import { SessionTitleGeneration } from '../services/session-title-generation/session-title-generation.service'
import { TaskIntentClassifier } from '../services/task-intent-classifier/task-intent-classifier.service'
import { taskIntentLabels } from '../services/task-intent-classifier/task-intent-labels'
import {
	ProjectLocationInvalid,
	ProjectNotFound,
	ProjectPersistenceUnavailable,
	ProjectsV2Disabled,
	UnsupportedRecipeProfile,
} from './errors'
import { projectReadableByActor } from './project-authorization'
import type { ProjectActorContext } from './project-operations'
import { generateProjectWorkspaceId } from './project-workspace-id'
import { ensureWorkspacePlacementWithExecutor } from './workspace-placement'

export const createTaskV2 = Effect.fn('project_workspace.create_task_v2')(function* (
	input: CreateTaskV2Input & {
		readonly actor: ProjectActorContext
		readonly importedTicket?: PreparedTicketArtifactBundle
	},
) {
	const postgres = yield* PostgresDb
	if (input.repositories.some((repository) => hasRepositoryUrlCredentials(repository.remoteUrl))) {
		return yield* new ProjectLocationInvalid({ message: 'Repository URLs must not contain embedded credentials' })
	}

	const sessionId = input.sessionId ?? (yield* generateProjectWorkspaceId())
	const eventId = input.eventId ?? (yield* generateProjectWorkspaceId())
	const requestedTitle = input.firstSession.title?.trim() ? input.firstSession.title : null
	// Match directory-based launches, keeping the model call outside the transaction.
	const taskIntentClassifier = yield* TaskIntentClassifier
	const intent =
		input.firstSession.intent ??
		(input.workflowType === 'freeform' ? yield* taskIntentClassifier.classify(input.firstSession.text) : undefined)

	const result = yield* postgres.transaction((transaction) =>
		Effect.gen(function* () {
			yield* requireProjectsV2Enabled(transaction, input.actor)

			const [project] = yield* transaction.query(
				transaction.client
					.select()
					.from(projects)
					.where(
						and(
							projectReadableByActor(input.actor),
							eq(projects.id, input.projectId),
							eq(projects.archived, false),
						),
					)
					.limit(1),
			)
			if (!project) return yield* new ProjectNotFound({ projectId: input.projectId })

			const parsedProject = projectSelectSchema.safeParse(project)
			if (!parsedProject.success) {
				yield* Effect.logError(parsedProject.error)
				yield* Effect.sync(() => Sentry.captureException(parsedProject.error))
				return yield* new ProjectPersistenceUnavailable({ operation: 'parse_project' })
			}
			yield* validateWorkspaceRepositories(parsedProject.data.repositories, input.repositories)

			const [host] = yield* transaction.query(
				transaction.client
					.select({ hostId: onlineHosts.host_id })
					.from(onlineHosts)
					.where(
						and(
							eq(onlineHosts.organization_id, input.actor.organizationId),
							eq(onlineHosts.user_id, input.actor.userId),
							eq(onlineHosts.host_id, input.firstSession.hostId),
						),
					)
					.limit(1),
			)
			if (!host) {
				return yield* new ProjectLocationInvalid({
					message: 'The selected host is not registered for this user',
				})
			}

			const defaultRepo =
				input.defaultRepositoryIdentity !== undefined
					? input.repositories.find((r) => r.repositoryIdentity === input.defaultRepositoryIdentity)
					: input.repositories.find((r) => r.default)
			if (!defaultRepo) {
				return yield* new ProjectLocationInvalid({
					message: 'Default repository could not be determined',
				})
			}

			const workspaceId = input.workspaceId
			const taskId = input.taskId
			const hostId = input.firstSession.hostId
			const repositories = input.repositories.map((repository) => ({
				...repository,
				default: repository.repositoryIdentity === defaultRepo.repositoryIdentity,
			}))
			const defaultWorkingDirectory = taskWorkspaceSessionDirectory(taskWorkspaceRoot(input.slug), repositories)
			const taskValues = {
				organization_id: input.actor.organizationId,
				project_id: input.projectId,
				workspace_id: workspaceId,
				team_id: null,
				name: input.name,
				slug: input.slug,
				default_working_directory: defaultWorkingDirectory,
				external_task_id: null,
				created_by: input.actor.userId,
				resource_owner_user_id: input.actor.userId,
				archived: false,
				is_draft: false,
				setup_status: null,
				setup_details: null,
				ticket_id: input.ticketId ?? null,
				ticket_url: input.ticketUrl ?? null,
				ticket_description: input.ticketDescription ?? null,
				ticket_provider: input.ticketProvider ?? null,
				github_connection_id: input.githubConnectionId ?? null,
				ticket_repository_id: input.ticketRepositoryId ?? null,
				ticket_repository_full_name: input.ticketRepositoryFullName ?? null,
				workflow_type: input.workflowType,
				// V2 workspaces always materialize before the first session launches.
				worktree_timing: 'now' as const,
				workspace_state: null,
				workspace_spec: null,
				auto_advance_questions_to_research: input.autoAdvanceQuestionsToResearch,
				auto_advance_research_to_design: input.autoAdvanceResearchToDesign,
				auto_advance_plan_to_worktree: input.autoAdvancePlanToWorktree,
				auto_advance_worktree_to_implementation: input.autoAdvanceWorktreeToImplementation,
				auto_advance_implementation_to_pr: input.autoAdvanceImplementationToPr,
				created_with_experiment_flags: input.createdWithExperimentFlags ?? null,
			}

			const [existingTask] = yield* transaction.query(
				transaction.client
					.select()
					.from(tasks)
					.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, input.actor.organizationId)))
					.for('no key update')
					.limit(1),
			)
			const promotableDraft =
				existingTask?.resource_owner_user_id === input.actor.userId &&
				existingTask.is_draft &&
				!existingTask.archived
			if (existingTask && !promotableDraft) {
				const txId = yield* getTransactionId(transaction)
				return { result: 'already-exists' as const, transactionId: txId, taskId, workspaceId, sessionId }
			}

			const [workspace] = yield* transaction.query(
				transaction.client
					.insert(workspaces)
					.values({
						id: workspaceId,
						organization_id: input.actor.organizationId,
						project_id: input.projectId,
						name: input.name,
						created_by: input.actor.userId,
						resource_owner_user_id: input.actor.userId,
						repositories,
					})
					.onConflictDoNothing()
					.returning(),
			)

			if (!workspace) {
				const existing = yield* transaction.query(
					transaction.client
						.select({ id: workspaces.id })
						.from(workspaces)
						.where(
							and(
								eq(workspaces.id, workspaceId),
								eq(workspaces.organization_id, input.actor.organizationId),
							),
						)
						.limit(1),
				)
				if (!existing[0]) {
					return yield* new ProjectPersistenceUnavailable({ operation: 'create_workspace' })
				}
			}

			const [task] = existingTask
				? yield* transaction.query(
						transaction.client
							.update(tasks)
							.set(taskValues)
							.where(
								and(
									eq(tasks.id, taskId),
									eq(tasks.organization_id, input.actor.organizationId),
									eq(tasks.resource_owner_user_id, input.actor.userId),
									eq(tasks.is_draft, true),
									eq(tasks.archived, false),
								),
							)
							.returning(),
					)
				: yield* transaction.query(
						transaction.client
							.insert(tasks)
							.values({ id: taskId, ...taskValues })
							.onConflictDoUpdate({
								target: tasks.id,
								set: taskValues,
								setWhere: and(
									eq(tasks.organization_id, input.actor.organizationId),
									eq(tasks.resource_owner_user_id, input.actor.userId),
									eq(tasks.is_draft, true),
									eq(tasks.archived, false),
								),
							})
							.returning(),
					)

			if (!task) {
				const [claimedTask] = yield* transaction.query(
					transaction.client
						.select({ id: tasks.id })
						.from(tasks)
						.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, input.actor.organizationId)))
						.limit(1),
				)
				if (claimedTask) {
					const txId = yield* getTransactionId(transaction)
					return { result: 'already-exists' as const, transactionId: txId, taskId, workspaceId, sessionId }
				}
				return yield* new ProjectPersistenceUnavailable({ operation: 'create_task' })
			}

			const location = yield* ensureWorkspacePlacementWithExecutor(transaction, {
				...input.actor,
				hostId,
				workspace: { id: workspaceId, projectId: input.projectId, repositories },
				pathSegment: input.slug,
			})
			const placedWorkingDirectory = taskWorkspaceSessionDirectory(location.filePath, repositories)
			if (placedWorkingDirectory !== defaultWorkingDirectory) {
				yield* transaction.query(
					transaction.client
						.update(tasks)
						.set({ default_working_directory: placedWorkingDirectory })
						.where(eq(tasks.id, taskId)),
				)
			}

			yield* transaction.query(
				transaction.client
					.insert(taskOrganizationAcl)
					.values({
						task_id: taskId,
						organization_id: input.actor.organizationId,
						resource_owner_user_id: input.actor.userId,
						permission_level: 'edit',
						granted_by: input.actor.userId,
					})
					.onConflictDoNothing({
						target: [taskOrganizationAcl.organization_id, taskOrganizationAcl.task_id],
					}),
			)

			const trimmedTaskContent = input.taskContent.trim()
			const taskContent = input.importedTicket
				? [trimmedTaskContent, `See [${input.importedTicket.label}](./${input.importedTicket.fileName}).`]
						.filter(Boolean)
						.join('\n\n')
				: trimmedTaskContent
					? input.taskContent
					: ''
			if (taskContent) {
				yield* transaction.query(
					transaction.client.insert(artifacts).values({
						task_id: taskId,
						task_slug: task.slug,
						file_name: 'task.md',
						content: taskContent,
						content_hash: hash(taskContent),
						content_type: 'text/markdown',
						file_size_bytes: BigInt(Buffer.byteLength(taskContent, 'utf8')),
						storage_type: 'postgres',
						resource_owner_user_id: input.actor.userId,
						organization_id: input.actor.organizationId,
						created_by: input.actor.userId,
					}),
				)
			}
			if (input.importedTicket) {
				yield* transaction.query(
					transaction.client.insert(artifacts).values([
						{
							task_id: taskId,
							task_slug: task.slug,
							file_name: input.importedTicket.fileName,
							content: input.importedTicket.content,
							content_hash: input.importedTicket.contentHash,
							content_type: 'text/markdown',
							file_size_bytes: BigInt(Buffer.byteLength(input.importedTicket.content, 'utf8')),
							storage_type: 'postgres' as const,
							resource_owner_user_id: input.actor.userId,
							organization_id: input.actor.organizationId,
							created_by: input.actor.userId,
						},
						...input.importedTicket.images.map((image) => ({
							task_id: taskId,
							task_slug: task.slug,
							file_name: image.fileName,
							content: '',
							content_hash: image.contentHash,
							content_type: image.contentType,
							file_size_bytes: BigInt(image.fileSizeBytes),
							storage_type: 's3' as const,
							s3_key: image.s3Key,
							resource_owner_user_id: input.actor.userId,
							organization_id: input.actor.organizationId,
							created_by: input.actor.userId,
						})),
					]),
				)
			}
			if (input.attachments.length > 0) {
				yield* transaction.query(
					transaction.client.insert(artifacts).values(
						input.attachments.map((attachment) => ({
							task_id: taskId,
							task_slug: task.slug,
							file_name: attachment.fileName,
							content: '',
							content_hash: attachment.contentHash,
							content_type: attachment.contentType,
							file_size_bytes: BigInt(attachment.fileSizeBytes),
							storage_type: 's3' as const,
							s3_key: `${input.actor.organizationId}/${taskId}/${attachment.fileName}`,
							resource_owner_user_id: input.actor.userId,
							organization_id: input.actor.organizationId,
							created_by: input.actor.userId,
						})),
					),
				)
			}

			const [session] = yield* transaction.query(
				transaction.client
					.insert(sessions)
					.values({
						id: sessionId,
						task_id: taskId,
						organization_id: input.actor.organizationId,
						status: 'ready_for_launch',
						title: requestedTitle,
						prompt: input.firstSession.text,
						labels: taskIntentLabels(intent),
						coding_agent: input.firstSession.codingAgent,
						provider: input.firstSession.provider,
						model: input.firstSession.model,
						effort: input.firstSession.effort ?? null,
						fast_mode: input.firstSession.fastMode ?? false,
						working_directory: placedWorkingDirectory,
						host_id: hostId,
						permissions_mode: input.firstSession.permissionsMode,
						created_by: input.actor.userId,
						resource_owner_user_id: input.actor.userId,
						num_events: 1,
					})
					.onConflictDoNothing()
					.returning(),
			)

			if (!session) {
				return yield* new ProjectPersistenceUnavailable({ operation: 'create_session' })
			}

			yield* transaction.query(
				transaction.client.insert(conversationEvents).values({
					id: eventId,
					session_id: sessionId,
					organization_id: input.actor.organizationId,
					resource_owner_user_id: input.actor.userId,
					task_id: taskId,
					event_type: 'message',
					role: 'user',
					content: input.firstSession.text,
					user_id: input.actor.userId,
				}),
			)

			const txId = yield* getTransactionId(transaction)

			yield* transaction.query(
				transaction.client
					.insert(taskLaunches)
					.values({
						task_id: taskId,
						first_session_id: sessionId,
						launch_transaction_id: txId,
					})
					.onConflictDoNothing(),
			)

			return { result: 'created' as const, transactionId: txId, taskId, workspaceId, sessionId }
		}),
	)
	if (result.result === 'created' && requestedTitle === null && input.firstSession.text.trim()) {
		const titleGeneration = yield* SessionTitleGeneration
		yield* titleGeneration.scheduleGeneration({
			sessionId: result.sessionId,
			organizationId: input.actor.organizationId,
			userId: input.actor.userId,
			prompt: input.firstSession.text,
			ticketId: input.ticketId ?? null,
			taskName: input.name,
		})
	}
	return result
})

function requireProjectsV2Enabled(transaction: PostgresTransaction, actor: ProjectActorContext) {
	return transaction
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
}

function validateWorkspaceRepositories(
	projectRepositories: ProjectRepositories,
	workspaceRepositories: WorkspaceRepositories,
) {
	for (const workspaceRepository of workspaceRepositories) {
		const projectRepository = projectRepositories.find(
			(repository) => repository.repositoryIdentity === workspaceRepository.repositoryIdentity,
		)
		if (
			projectRepository === undefined ||
			projectRepository.remoteUrl !== workspaceRepository.remoteUrl ||
			projectRepository.defaultBranch !== workspaceRepository.defaultBranch ||
			projectRepository.autoPushBranch !== workspaceRepository.autoPushBranch ||
			projectRepository.setupCommand !== workspaceRepository.setupCommand ||
			projectRepository.copyGlobs.length !== workspaceRepository.copyGlobs.length ||
			projectRepository.copyGlobs.some((glob, index) => glob !== workspaceRepository.copyGlobs[index])
		) {
			return new UnsupportedRecipeProfile({
				message: `Repository ${workspaceRepository.repositoryIdentity} does not match the project recipe`,
			})
		}
	}
	return Effect.void
}
