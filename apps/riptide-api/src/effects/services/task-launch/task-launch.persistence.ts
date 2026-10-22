import { artifacts } from '@humanlayer/db/tables/artifacts'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { taskLaunches } from '@humanlayer/db/tables/task-launches'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { hash } from 'ohash'

import { createSessionForLaunch } from '../../../db/create-session-for-launch'
import { resolveOrgDefaultTaskShareLevel } from '../../../db/organization-settings'
import { activeTaskSlugIsAllocated, lockActiveTaskSlugAllocation } from '../../../db/task-slug-allocation'
import { upsertWorkspaceSetupRowForTaskSession } from '../../../db/upsert-workspace-setup-row-for-task-session'
import { getTransactionId } from '../postgres/helpers'
import { PostgresDb } from '../postgres/postgres-db.service'
import { taskIntentLabels } from '../task-intent-classifier/task-intent-labels'
import { TaskLaunchConflict, TaskLaunchForbidden, TaskLaunchUnavailable } from './task-launch.errors'
import type { LaunchTaskDraftInput, LaunchTaskDraftResult, TaskLaunchOutcome } from './task-launch.types'

type TaskRow = typeof tasks.$inferSelect

function taskValues(input: LaunchTaskDraftInput, createdAt: bigint) {
	return {
		name: input.name,
		slug: input.slug,
		default_working_directory: input.defaultWorkingDirectory,
		workspace_state: null,
		workspace_spec: input.workspaceSpec ?? null,
		organization_id: input.organizationId,
		created_by: input.userId,
		resource_owner_user_id: input.userId,
		created_at: createdAt,
		updated_at: createdAt,
		team_id: null,
		project_id: null,
		external_task_id: null,
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
		worktree_timing: input.worktreeTiming,
		auto_advance_questions_to_research: input.autoAdvanceQuestionsToResearch,
		auto_advance_research_to_design: input.autoAdvanceResearchToDesign,
		auto_advance_plan_to_worktree: input.autoAdvancePlanToWorktree,
		auto_advance_worktree_to_implementation: input.autoAdvanceWorktreeToImplementation,
		auto_advance_implementation_to_pr: input.autoAdvanceImplementationToPr,
		slack_notifications_muted: false,
		created_with_experiment_flags: input.createdWithExperimentFlags ?? null,
	}
}

function toResult({
	outcome,
	task,
	firstSessionId,
	transactionId,
}: {
	outcome: TaskLaunchOutcome
	task: TaskRow
	firstSessionId: string
	transactionId: string
}): LaunchTaskDraftResult {
	return { outcome, taskId: task.id, firstSessionId, transactionId, task }
}

/**
 * Atomically claims a task identity, materializes its first session, and records
 * the immutable launch result used by every replay.
 */
export const launchTaskDraftPersistence = Effect.fn('task_launch.persistence.launch_task_draft')(function* (
	input: LaunchTaskDraftInput,
) {
	const postgres = yield* PostgresDb
	return yield* postgres.transaction((tx) =>
		Effect.gen(function* () {
			const [existing] = yield* tx.query(
				tx.client
					.select()
					.from(tasks)
					.where(and(eq(tasks.id, input.draftId), eq(tasks.organization_id, input.organizationId)))
					.for('no key update')
					.limit(1),
			)

			if (existing && existing.resource_owner_user_id !== input.userId) {
				return yield* Effect.fail(
					new TaskLaunchForbidden({
						draftId: input.draftId,
						organizationId: input.organizationId,
						userId: input.userId,
					}),
				)
			}

			if (existing) {
				const [launch] = yield* tx.query(
					tx.client.select().from(taskLaunches).where(eq(taskLaunches.task_id, input.draftId)).limit(1),
				)
				if (launch) {
					return toResult({
						outcome: 'already-launched',
						task: existing,
						firstSessionId: launch.first_session_id,
						transactionId: launch.launch_transaction_id,
					})
				}
				if (!existing.is_draft || existing.archived) {
					return yield* Effect.fail(
						new TaskLaunchConflict({ draftId: input.draftId, reason: 'task-id-in-use' }),
					)
				}
			}

			yield* tx.run(() =>
				lockActiveTaskSlugAllocation(tx.client, {
					slug: input.slug,
					organizationId: input.organizationId,
				}),
			)
			if (
				yield* tx.run(() =>
					activeTaskSlugIsAllocated(tx.client, {
						slug: input.slug,
						taskId: input.draftId,
						organizationId: input.organizationId,
					}),
				)
			) {
				return yield* Effect.fail(new TaskLaunchConflict({ draftId: input.draftId, reason: 'slug-in-use' }))
			}

			const createdAt = BigInt(yield* Clock.currentTimeMillis)
			const values = taskValues(input, createdAt)
			let task: TaskRow
			let outcome: Extract<TaskLaunchOutcome, 'created' | 'promoted'>
			if (existing) {
				const [promoted] = yield* tx.query(
					tx.client.update(tasks).set(values).where(eq(tasks.id, input.draftId)).returning(),
				)
				if (!promoted) {
					return yield* Effect.fail(
						new TaskLaunchUnavailable({ draftId: input.draftId, cause: 'draft-update-missed' }),
					)
				}
				task = promoted
				outcome = 'promoted'
			} else {
				const [created] = yield* tx.query(
					tx.client
						.insert(tasks)
						.values({ id: input.draftId, ...values })
						.onConflictDoNothing({ target: tasks.id })
						.returning(),
				)
				if (!created) {
					const [claimed] = yield* tx.query(
						tx.client
							.select()
							.from(tasks)
							.where(and(eq(tasks.id, input.draftId), eq(tasks.organization_id, input.organizationId)))
							.for('no key update')
							.limit(1),
					)
					if (!claimed || claimed.resource_owner_user_id !== input.userId) {
						return yield* Effect.fail(
							new TaskLaunchForbidden({
								draftId: input.draftId,
								organizationId: input.organizationId,
								userId: input.userId,
							}),
						)
					}
					const [launch] = yield* tx.query(
						tx.client.select().from(taskLaunches).where(eq(taskLaunches.task_id, input.draftId)).limit(1),
					)
					if (launch) {
						return toResult({
							outcome: 'already-launched',
							task: claimed,
							firstSessionId: launch.first_session_id,
							transactionId: launch.launch_transaction_id,
						})
					}
					return yield* Effect.fail(
						new TaskLaunchConflict({ draftId: input.draftId, reason: 'task-id-in-use' }),
					)
				}
				task = created
				outcome = 'created'
			}

			const [host] = yield* tx.query(
				tx.client
					.select({ host_id: onlineHosts.host_id })
					.from(onlineHosts)
					.where(
						and(
							eq(onlineHosts.host_id, input.firstSession.hostId),
							eq(onlineHosts.user_id, input.userId),
							eq(onlineHosts.organization_id, input.organizationId),
						),
					)
					.limit(1),
			)
			if (!host) {
				return yield* Effect.fail(
					new TaskLaunchForbidden({
						draftId: input.draftId,
						organizationId: input.organizationId,
						userId: input.userId,
					}),
				)
			}

			const defaultTaskShareLevel = yield* tx.run(() =>
				resolveOrgDefaultTaskShareLevel(tx.client, input.organizationId),
			)
			yield* tx.query(
				tx.client
					.insert(taskOrganizationAcl)
					.values({
						organization_id: input.organizationId,
						task_id: task.id,
						resource_owner_user_id: input.userId,
						permission_level: defaultTaskShareLevel,
						granted_by: input.userId,
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
				yield* tx.query(
					tx.client.insert(artifacts).values({
						task_id: task.id,
						task_slug: task.slug,
						file_name: 'task.md',
						content: taskContent,
						content_hash: hash(taskContent),
						content_type: 'text/markdown',
						file_size_bytes: BigInt(Buffer.byteLength(taskContent, 'utf8')),
						storage_type: 'postgres',
						resource_owner_user_id: input.userId,
						organization_id: input.organizationId,
						created_by: input.userId,
					}),
				)
			}
			if (input.importedTicket) {
				yield* tx.query(
					tx.client.insert(artifacts).values([
						{
							task_id: task.id,
							task_slug: task.slug,
							file_name: input.importedTicket.fileName,
							content: input.importedTicket.content,
							content_hash: input.importedTicket.contentHash,
							content_type: 'text/markdown',
							file_size_bytes: BigInt(Buffer.byteLength(input.importedTicket.content, 'utf8')),
							storage_type: 'postgres' as const,
							resource_owner_user_id: input.userId,
							organization_id: input.organizationId,
							created_by: input.userId,
						},
						...input.importedTicket.images.map((image) => ({
							task_id: task.id,
							task_slug: task.slug,
							file_name: image.fileName,
							content: '',
							content_hash: image.contentHash,
							content_type: image.contentType,
							file_size_bytes: BigInt(image.fileSizeBytes),
							storage_type: 's3' as const,
							s3_key: image.s3Key,
							resource_owner_user_id: input.userId,
							organization_id: input.organizationId,
							created_by: input.userId,
						})),
					]),
				)
			}
			if (input.attachments.length > 0) {
				yield* tx.query(
					tx.client.insert(artifacts).values(
						input.attachments.map((attachment) => ({
							task_id: task.id,
							task_slug: task.slug,
							file_name: attachment.fileName,
							content: '',
							content_hash: attachment.contentHash,
							content_type: attachment.contentType,
							file_size_bytes: BigInt(attachment.fileSizeBytes),
							storage_type: 's3' as const,
							s3_key: `${input.organizationId}/${task.id}/${attachment.fileName}`,
							resource_owner_user_id: input.userId,
							organization_id: input.organizationId,
							created_by: input.userId,
						})),
					),
				)
			}

			yield* tx.run(() =>
				upsertWorkspaceSetupRowForTaskSession(tx.client, {
					organizationId: input.organizationId,
					taskId: task.id,
					hostId: input.firstSession.hostId,
					workspaceSpec: input.workspaceSpec ?? null,
				}),
			)
			const session = yield* tx.run(() =>
				createSessionForLaunch(tx.client, {
					id: input.firstSession.id,
					eventId: input.firstSession.eventId,
					taskId: task.id,
					organizationId: input.organizationId,
					resourceOwnerUserId: input.userId,
					createdBy: input.userId,
					title: input.firstSession.title?.trim() ? input.firstSession.title : null,
					prompt: input.firstSession.text,
					workingDirectory: input.firstSession.workingDirectory,
					hostId: input.firstSession.hostId,
					codingAgent: input.firstSession.codingAgent,
					provider: input.firstSession.provider,
					model: input.firstSession.model,
					effort: input.firstSession.effort ?? undefined,
					fastMode: input.firstSession.fastMode ?? undefined,
					permissionsMode: input.firstSession.permissionsMode,
					labels: taskIntentLabels(input.intent),
				}),
			)
			const transactionId = yield* getTransactionId(tx)
			yield* tx.query(
				tx.client.insert(taskLaunches).values({
					task_id: task.id,
					first_session_id: session.id,
					launch_transaction_id: transactionId,
				}),
			)
			return toResult({ outcome, task, firstSessionId: session.id, transactionId })
		}),
	)
})
