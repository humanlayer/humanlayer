import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { aclOperationsLog } from '@humanlayer/db/tables/acl-operations-log'
import { approvals } from '@humanlayer/db/tables/approvals'
import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifactOperationsLog } from '@humanlayer/db/tables/artifact-operations-log'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { codelayerAgentState } from '@humanlayer/db/tables/codelayer-agent-state'
import { codelayerAgentStateSnapshots } from '@humanlayer/db/tables/codelayer-agent-state-snapshots'
import { commits } from '@humanlayer/db/tables/commits'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { pullRequestSessions } from '@humanlayer/db/tables/pull-request-sessions'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessionUsageEvents } from '@humanlayer/db/tables/session-usage-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq, inArray, or } from 'drizzle-orm'
import { Effect } from 'effect'

import { Sentry } from '../../instrument'
import { getTransactionId } from '../services/postgres/helpers'
import type { PostgresDbError } from '../services/postgres/postgres-db.errors'
import { PostgresDb } from '../services/postgres/postgres-db.service'
import type { PostgresTransaction } from '../services/postgres/postgres-db.service'
import type { WorkosError } from '../services/workos/workos.errors'
import { WorkosService } from '../services/workos/workos.service'
import {
	TaskOwnerDatabaseFailureError,
	TaskOwnerReassignmentForbiddenError,
	TaskOwnerRecipientIneligibleError,
	TaskOwnerRecipientUnchangedError,
	TaskOwnerTaskNotFoundError,
	TaskOwnerWorkosFailureError,
} from './task-owner-reassignment.errors'

export interface ReassignTaskOwnerInput {
	readonly taskId: string
	readonly newOwnerUserId: string
	readonly actingUserId: string
	readonly organizationId: string
	readonly workosOrganizationId: string
	readonly actingUserIsOrganizationAdmin: boolean
}

export interface ReassignTaskOwnerResult {
	readonly taskId: string
	readonly previousOwnerUserId: string
	readonly newOwnerUserId: string
	readonly transactionId: string
}

const captureWorkosFailure = (input: ReassignTaskOwnerInput, error: WorkosError) =>
	Effect.logError('Task owner recipient membership lookup failed', error).pipe(
		Effect.annotateLogs({
			operation: 'task_owner.reassign',
			taskId: input.taskId,
			organizationId: input.organizationId,
			actingUserId: input.actingUserId,
			newOwnerUserId: input.newOwnerUserId,
		}),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { operation: 'task_owner.reassign', dependency: 'workos' },
					extra: {
						taskId: input.taskId,
						organizationId: input.organizationId,
						actingUserId: input.actingUserId,
						newOwnerUserId: input.newOwnerUserId,
					},
				}),
			),
		),
	)

const mapWorkosFailure = (input: ReassignTaskOwnerInput, error: WorkosError) =>
	captureWorkosFailure(input, error).pipe(
		Effect.andThen(
			Effect.fail(
				new TaskOwnerWorkosFailureError({
					taskId: input.taskId,
					newOwnerUserId: input.newOwnerUserId,
					organizationId: input.organizationId,
					cause: error,
				}),
			),
		),
	)

const captureDatabaseFailure = (input: ReassignTaskOwnerInput, error: PostgresDbError) =>
	Effect.logError('Task owner reassignment database transaction failed', error).pipe(
		Effect.annotateLogs({
			operation: 'task_owner.reassign',
			taskId: input.taskId,
			organizationId: input.organizationId,
			actingUserId: input.actingUserId,
			newOwnerUserId: input.newOwnerUserId,
			postgresErrorKind: error.kind,
			postgresErrorRetryable: error.retryable,
		}),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { operation: 'task_owner.reassign', dependency: 'postgres' },
					extra: {
						taskId: input.taskId,
						organizationId: input.organizationId,
						actingUserId: input.actingUserId,
						newOwnerUserId: input.newOwnerUserId,
						postgresErrorKind: error.kind,
						postgresErrorRetryable: error.retryable,
					},
				}),
			),
		),
	)

const mapDatabaseFailure = (input: ReassignTaskOwnerInput, error: PostgresDbError) =>
	captureDatabaseFailure(input, error).pipe(
		Effect.andThen(
			Effect.fail(
				new TaskOwnerDatabaseFailureError({
					taskId: input.taskId,
					newOwnerUserId: input.newOwnerUserId,
					organizationId: input.organizationId,
					retryable: error.retryable,
					cause: error,
				}),
			),
		),
	)

const updateTaskResourceOwnerSnapshots = (
	tx: PostgresTransaction,
	input: ReassignTaskOwnerInput,
	previousOwnerUserId: string,
) =>
	Effect.gen(function* () {
		const taskSessionIds = tx.client
			.select({ id: sessions.id })
			.from(sessions)
			.where(and(eq(sessions.task_id, input.taskId), eq(sessions.organization_id, input.organizationId)))
		const taskArtifacts = tx.client
			.select({ id: artifacts.id })
			.from(artifacts)
			.where(and(eq(artifacts.task_id, input.taskId), eq(artifacts.organization_id, input.organizationId)))
		const taskArtifactIds = tx.client
			.select({ id: artifacts.id })
			.from(artifacts)
			.where(and(eq(artifacts.task_id, input.taskId), eq(artifacts.organization_id, input.organizationId)))
		const taskArtifactOperations = tx.client
			.select({ id: artifactOperationsLog.id })
			.from(artifactOperationsLog)
			.where(
				and(
					eq(artifactOperationsLog.organization_id, input.organizationId),
					inArray(artifactOperationsLog.artifact_id, taskArtifacts),
				),
			)

		const [previousOwnerAcl] = yield* tx.query(
			tx.client
				.select({ id: taskUserAcl.id, permissionLevel: taskUserAcl.permission_level })
				.from(taskUserAcl)
				.where(
					and(
						eq(taskUserAcl.task_id, input.taskId),
						eq(taskUserAcl.organization_id, input.organizationId),
						eq(taskUserAcl.subject_user_id, previousOwnerUserId),
					),
				)
				.limit(1)
				.for('no key update'),
		)

		yield* tx.query(
			tx.client
				.update(tasks)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(and(eq(tasks.id, input.taskId), eq(tasks.organization_id, input.organizationId))),
		)
		yield* tx.query(
			tx.client
				.update(sessions)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(and(eq(sessions.task_id, input.taskId), eq(sessions.organization_id, input.organizationId))),
		)

		yield* tx.query(
			tx.client
				.update(conversationEvents)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(conversationEvents.organization_id, input.organizationId),
						or(
							eq(conversationEvents.task_id, input.taskId),
							inArray(conversationEvents.session_id, taskSessionIds),
						),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(approvals)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(approvals.organization_id, input.organizationId),
						or(eq(approvals.task_id, input.taskId), inArray(approvals.session_id, taskSessionIds)),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(queuedMessages)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(queuedMessages.organization_id, input.organizationId),
						or(
							eq(queuedMessages.task_id, input.taskId),
							inArray(queuedMessages.session_id, taskSessionIds),
						),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(sessionUsageEvents)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(sessionUsageEvents.organization_id, input.organizationId),
						or(
							eq(sessionUsageEvents.task_id, input.taskId),
							inArray(sessionUsageEvents.session_id, taskSessionIds),
						),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(commits)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(commits.organization_id, input.organizationId),
						or(eq(commits.task_id, input.taskId), inArray(commits.session_id, taskSessionIds)),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(pullRequests)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(pullRequests.organization_id, input.organizationId),
						or(eq(pullRequests.task_id, input.taskId), inArray(pullRequests.session_id, taskSessionIds)),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(pullRequestSessions)
				.set({ user_id: input.newOwnerUserId })
				.where(
					and(
						eq(pullRequestSessions.organization_id, input.organizationId),
						or(
							eq(pullRequestSessions.task_id, input.taskId),
							inArray(pullRequestSessions.session_id, taskSessionIds),
						),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(codelayerAgentState)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(codelayerAgentState.organization_id, input.organizationId),
						or(
							eq(codelayerAgentState.task_id, input.taskId),
							inArray(codelayerAgentState.session_id, taskSessionIds),
						),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(codelayerAgentStateSnapshots)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(codelayerAgentStateSnapshots.organization_id, input.organizationId),
						or(
							eq(codelayerAgentStateSnapshots.task_id, input.taskId),
							inArray(codelayerAgentStateSnapshots.session_id, taskSessionIds),
						),
					),
				),
		)

		yield* tx.query(
			tx.client
				.update(artifacts)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(and(eq(artifacts.task_id, input.taskId), eq(artifacts.organization_id, input.organizationId))),
		)
		yield* tx.query(
			tx.client
				.update(artifactVersions)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(artifactVersions.organization_id, input.organizationId),
						or(
							eq(artifactVersions.task_id, input.taskId),
							inArray(artifactVersions.artifact_id, taskArtifacts),
						),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(artifactOperationsLog)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(artifactOperationsLog.organization_id, input.organizationId),
						or(
							eq(artifactOperationsLog.task_id, input.taskId),
							inArray(artifactOperationsLog.id, taskArtifactOperations),
						),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(artifactComments)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(artifactComments.task_id, input.taskId),
						eq(artifactComments.organization_id, input.organizationId),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(diffComments)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(eq(diffComments.task_id, input.taskId), eq(diffComments.organization_id, input.organizationId)),
				),
		)
		yield* tx.query(
			tx.client
				.update(accessRequests)
				.set({ artifact_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(accessRequests.organization_id, input.organizationId),
						inArray(accessRequests.artifact_id, taskArtifactIds),
					),
				),
		)

		yield* tx.query(
			tx.client
				.update(taskUserAcl)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(eq(taskUserAcl.task_id, input.taskId), eq(taskUserAcl.organization_id, input.organizationId)),
				),
		)
		yield* tx.query(
			tx.client
				.update(taskOrganizationAcl)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(taskOrganizationAcl.task_id, input.taskId),
						eq(taskOrganizationAcl.organization_id, input.organizationId),
					),
				),
		)
		yield* tx.query(
			tx.client
				.update(aclOperationsLog)
				.set({ resource_owner_user_id: input.newOwnerUserId })
				.where(
					and(
						eq(aclOperationsLog.task_id, input.taskId),
						eq(aclOperationsLog.organization_id, input.organizationId),
					),
				),
		)

		if (!previousOwnerAcl) {
			const [createdAcl] = yield* tx.query(
				tx.client
					.insert(taskUserAcl)
					.values({
						task_id: input.taskId,
						subject_user_id: previousOwnerUserId,
						organization_id: input.organizationId,
						resource_owner_user_id: input.newOwnerUserId,
						permission_level: 'edit',
						granted_by: input.actingUserId,
					})
					.returning({ id: taskUserAcl.id }),
			)
			if (!createdAcl) {
				return yield* Effect.die('Previous owner edit ACL insert returned no row')
			}
			yield* tx.query(
				tx.client.insert(aclOperationsLog).values({
					acl_type: 'task_user_acl',
					acl_entry_id: createdAcl.id,
					task_id: input.taskId,
					organization_id: input.organizationId,
					target_user_id: previousOwnerUserId,
					target_organization_id: null,
					operation: 'create',
					performed_by: input.actingUserId,
					permission_level_before: null,
					permission_level_after: 'edit',
					resource_owner_user_id: input.newOwnerUserId,
				}),
			)
			return
		}

		if (previousOwnerAcl.permissionLevel !== 'edit') {
			yield* tx.query(
				tx.client
					.update(taskUserAcl)
					.set({
						permission_level: 'edit',
						resource_owner_user_id: input.newOwnerUserId,
						granted_by: input.actingUserId,
					})
					.where(eq(taskUserAcl.id, previousOwnerAcl.id)),
			)
			yield* tx.query(
				tx.client.insert(aclOperationsLog).values({
					acl_type: 'task_user_acl',
					acl_entry_id: previousOwnerAcl.id,
					task_id: input.taskId,
					organization_id: input.organizationId,
					target_user_id: previousOwnerUserId,
					target_organization_id: null,
					operation: 'update',
					performed_by: input.actingUserId,
					permission_level_before: previousOwnerAcl.permissionLevel,
					permission_level_after: 'edit',
					resource_owner_user_id: input.newOwnerUserId,
				}),
			)
		}
	})

export const reassignTaskOwner = Effect.fn('task_owner.reassign')(function* (input: ReassignTaskOwnerInput) {
	const workos = yield* WorkosService
	const postgres = yield* PostgresDb

	const memberships = yield* workos
		.listActiveOrganizationMemberships({
			userId: input.newOwnerUserId,
			organizationId: input.workosOrganizationId,
			limit: 1,
		})
		.pipe(
			Effect.catchTags({
				WorkosAlreadyInvitedError: (error) => mapWorkosFailure(input, error),
				WorkosRateLimitError: (error) => mapWorkosFailure(input, error),
				WorkosServerError: (error) => mapWorkosFailure(input, error),
				WorkosNetworkError: (error) => mapWorkosFailure(input, error),
				WorkosClientError: (error) => mapWorkosFailure(input, error),
			}),
		)

	if (memberships.length === 0) {
		return yield* Effect.fail(
			new TaskOwnerRecipientIneligibleError({
				taskId: input.taskId,
				newOwnerUserId: input.newOwnerUserId,
				organizationId: input.organizationId,
			}),
		)
	}

	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const [task] = yield* tx.query(
					tx.client
						.select({ resourceOwnerUserId: tasks.resource_owner_user_id })
						.from(tasks)
						.where(and(eq(tasks.id, input.taskId), eq(tasks.organization_id, input.organizationId)))
						.limit(1)
						.for('no key update'),
				)

				if (!task) {
					return yield* Effect.fail(
						new TaskOwnerTaskNotFoundError({
							taskId: input.taskId,
							organizationId: input.organizationId,
						}),
					)
				}

				if (task.resourceOwnerUserId !== input.actingUserId && !input.actingUserIsOrganizationAdmin) {
					return yield* Effect.fail(
						new TaskOwnerReassignmentForbiddenError({
							taskId: input.taskId,
							actingUserId: input.actingUserId,
							organizationId: input.organizationId,
						}),
					)
				}

				if (task.resourceOwnerUserId === input.newOwnerUserId) {
					return yield* Effect.fail(
						new TaskOwnerRecipientUnchangedError({
							taskId: input.taskId,
							ownerUserId: input.newOwnerUserId,
							organizationId: input.organizationId,
						}),
					)
				}

				yield* updateTaskResourceOwnerSnapshots(tx, input, task.resourceOwnerUserId)
				const transactionId = yield* getTransactionId(tx)

				return {
					taskId: input.taskId,
					previousOwnerUserId: task.resourceOwnerUserId,
					newOwnerUserId: input.newOwnerUserId,
					transactionId,
				} satisfies ReassignTaskOwnerResult
			}),
		)
		.pipe(
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapDatabaseFailure(input, error),
				PostgresDbTransactionError: (error) => mapDatabaseFailure(input, error),
			}),
		)
})
