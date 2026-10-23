import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import type {
	AccessRequestInitialEmailAttempts,
	AccessRequestScheduledReminders,
} from '@humanlayer/db/zodschemas/access-request-email-metadata'
import { and, eq, sql } from 'drizzle-orm'
import { DateTime, Effect, Option, Result } from 'effect'

import type { ArchiveAccessRequestInput, CreateAccessRequestInput } from '../../../lib/access-request-port'
import { PostgresDb, type PostgresDbClient } from '../postgres/postgres-db.service'
import type { ResendError } from '../resend/resend-errors'
import type { WorkosError } from '../workos/workos.errors'
import { AccessRequestDbError, AlreadyRequestedAccessError, FeatureDisabledError } from './access-request-errors'
import {
	type ArchivedRow,
	type ArtifactLookupRow,
	DAY_MS,
	logError,
	parseReminderScheduledAt,
	type NotifyResult,
	type PendingRowForInvite,
	type ReminderCancelResult,
	type RequestRow,
} from './access-request-internal'

function applyCancellationResult(
	reminder: AccessRequestScheduledReminders[number],
	result: ReminderCancelResult,
): AccessRequestScheduledReminders[number] {
	const updatedReminder: AccessRequestScheduledReminders[number] = { ...reminder }
	if (result.canceledAt !== null) updatedReminder.canceledAt = result.canceledAt
	if (result.cancelError !== null) updatedReminder.cancelError = result.cancelError
	return updatedReminder
}

export function lookupArtifactForAccessRequest(
	artifactId: string,
): Effect.Effect<ArtifactLookupRow | undefined, AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [artifact] = yield* postgres
			.query(
				postgres.client
					.select({
						id: artifacts.id,
						organization_id: artifacts.organization_id,
						file_name: artifacts.file_name,
						resource_owner_user_id: artifacts.resource_owner_user_id,
						access_requests_enabled: organizationSettings.access_requests_enabled,
						workos_organization_id: organizations.workos_organization_id,
						organization_name: organizations.name,
						task_id: artifacts.task_id,
						task_name: tasks.name,
					})
					.from(artifacts)
					.leftJoin(organizationSettings, eq(organizationSettings.organization_id, artifacts.organization_id))
					.leftJoin(organizations, eq(organizations.id, artifacts.organization_id))
					.leftJoin(tasks, eq(tasks.id, artifacts.task_id))
					.where(eq(artifacts.id, artifactId))
					.limit(1),
			)
			.pipe(
				Effect.mapError((error) =>
					AccessRequestDbError.fromPostgresError('lookupArtifactForAccessRequest', error),
				),
			)
		return artifact
	})
}

/**
 * Best-effort lookup of an artifact's WorkOS organization id (joins
 * `artifacts ⨝ organizations`). Used by the access-request membership guardrail
 * in the create handler. Returns `null` when the artifact/org row is missing or
 * has no WorkOS org id. Promise-based (not Effect) so it can be awaited directly
 * in the oRPC handler alongside the SDK-shaped WorkOS adapter calls.
 *
 * Unlike the Effect helpers in this module it still takes a raw Drizzle client,
 * because the classic public-create handler calls it directly with
 * `context.services.db` (outside the Effect runtime). The `PostgresDbClient` type
 * here is the wrapped service's re-exported Drizzle client alias.
 */
export async function lookupArtifactWorkosOrg(db: PostgresDbClient, artifactId: string): Promise<string | null> {
	const [row] = await db
		.select({ workos_organization_id: organizations.workos_organization_id })
		.from(artifacts)
		.leftJoin(organizations, eq(organizations.id, artifacts.organization_id))
		.where(eq(artifacts.id, artifactId))
		.limit(1)
	return row?.workos_organization_id ?? null
}

export function lookupArtifactWorkosOrgForAccessRequest(
	artifactId: string,
): Effect.Effect<string | null, AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [row] = yield* postgres
			.query(
				postgres.client
					.select({ workos_organization_id: organizations.workos_organization_id })
					.from(artifacts)
					.leftJoin(organizations, eq(organizations.id, artifacts.organization_id))
					.where(eq(artifacts.id, artifactId))
					.limit(1),
			)
			.pipe(
				Effect.mapError((error) =>
					AccessRequestDbError.fromPostgresError('lookupArtifactWorkosOrgForAccessRequest', error),
				),
			)
		return row?.workos_organization_id ?? null
	})
}

export function upsertAccessRequestInTransaction(args: {
	artifact: ArtifactLookupRow
	requesterEmail: string
	now: Date
	input: CreateAccessRequestInput
}): Effect.Effect<RequestRow, AlreadyRequestedAccessError | AccessRequestDbError, PostgresDb> {
	const { artifact, requesterEmail, now, input } = args
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb

		return yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [lockedArtifact] = yield* tx.query(
						tx.client
							.select({
								id: artifacts.id,
								organizationId: artifacts.organization_id,
								fileName: artifacts.file_name,
								resourceOwnerUserId: artifacts.resource_owner_user_id,
								taskId: artifacts.task_id,
							})
							.from(artifacts)
							.where(eq(artifacts.id, input.artifactId))
							.limit(1)
							.for('no key update'),
					)

					if (!lockedArtifact) {
						return yield* Effect.fail(
							new AccessRequestDbError({
								operation: 'upsertAccessRequestInTransaction',
								cause: new Error('Artifact was removed before the access request could be saved'),
								retryable: false,
							}),
						)
					}

					const [existing] = yield* tx.query(
						tx.client
							.select()
							.from(accessRequests)
							.where(
								and(
									eq(accessRequests.artifact_id, input.artifactId),
									eq(accessRequests.requester_email, requesterEmail),
								),
							)
							.limit(1)
							.for('no key update'),
					)

					if (existing) {
						const retryAfter = DateTime.make(existing.requested_at.getTime() + DAY_MS)

						// Native invalid dates never satisfied the cooldown comparison. Keep that
						// policy for out-of-range stored dates rather than inventing a retry time.
						if (
							existing.status === 'pending' &&
							Option.isSome(retryAfter) &&
							now.getTime() < DateTime.toEpochMillis(retryAfter.value)
						) {
							return yield* Effect.fail(
								new AlreadyRequestedAccessError({
									retryAfter: DateTime.toDateUtc(retryAfter.value),
									existingRequestStatus: existing.status,
								}),
							)
						}

						const [updated] = yield* tx.query(
							tx.client
								.update(accessRequests)
								.set({
									status: 'pending',
									request_generation: existing.request_generation + 1,
									requested_at: now,
									reminder_scheduled_at: null,
									resolved_at: null,
									archived_at: null,
									notification_status: 'not_started',
									initial_email_attempts: [],
									scheduled_reminders: [],
									resolved_by_user_id: null,
									requester_user_id: input.requesterUserId ?? existing.requester_user_id,
									artifact_title_snapshot: lockedArtifact.fileName,
									artifact_owner_user_id: lockedArtifact.resourceOwnerUserId,
									updated_at: now,
								})
								.where(eq(accessRequests.id, existing.id))
								.returning({ id: accessRequests.id }),
						)

						if (!updated) {
							return yield* Effect.fail(
								new AccessRequestDbError({
									operation: 'upsertAccessRequestInTransaction',
									cause: new Error('Failed to update access request'),
									retryable: false,
								}),
							)
						}

						return {
							id: updated.id,
							request_generation: existing.request_generation + 1,
							artifact_id: lockedArtifact.id,
							artifact_title_snapshot: lockedArtifact.fileName,
							artifact_owner_user_id: lockedArtifact.resourceOwnerUserId,
							organization_id: lockedArtifact.organizationId,
							workosOrganizationId: artifact.workos_organization_id ?? '',
							organizationName: artifact.organization_name ?? '',
							requestedAt: now,
							requesterEmail,
							requesterUserId: input.requesterUserId ?? existing.requester_user_id,
							taskId: lockedArtifact.taskId ?? null,
							taskName: artifact.task_name,
						} satisfies RequestRow
					}

					const [created] = yield* tx.query(
						tx.client
							.insert(accessRequests)
							.values({
								organization_id: lockedArtifact.organizationId,
								artifact_id: lockedArtifact.id,
								artifact_title_snapshot: lockedArtifact.fileName,
								artifact_owner_user_id: lockedArtifact.resourceOwnerUserId,
								requester_user_id: input.requesterUserId,
								requester_email: requesterEmail,
								requested_at: now,
								updated_at: now,
								notification_status: 'not_started',
							})
							.returning({ id: accessRequests.id }),
					)

					if (!created) {
						return yield* Effect.fail(
							new AccessRequestDbError({
								operation: 'upsertAccessRequestInTransaction',
								cause: new Error('Failed to create access request'),
								retryable: false,
							}),
						)
					}

					return {
						id: created.id,
						request_generation: 1,
						artifact_id: lockedArtifact.id,
						artifact_title_snapshot: lockedArtifact.fileName,
						artifact_owner_user_id: lockedArtifact.resourceOwnerUserId,
						organization_id: lockedArtifact.organizationId,
						workosOrganizationId: artifact.workos_organization_id ?? '',
						organizationName: artifact.organization_name ?? '',
						requestedAt: now,
						requesterEmail,
						requesterUserId: input.requesterUserId ?? null,
						taskId: lockedArtifact.taskId ?? null,
						taskName: artifact.task_name,
					} satisfies RequestRow
				}),
			)
			.pipe(
				Effect.catchTags({
					PostgresDbQueryError: (error) =>
						Effect.fail(AccessRequestDbError.fromPostgresError('upsertAccessRequestInTransaction', error)),
					PostgresDbTransactionError: (error) =>
						Effect.fail(AccessRequestDbError.fromPostgresError('upsertAccessRequestInTransaction', error)),
				}),
			)
	})
}

export function insertOrReopenRequest(
	input: CreateAccessRequestInput,
): Effect.Effect<RequestRow, AlreadyRequestedAccessError | FeatureDisabledError | AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const requesterEmail = input.requesterEmail.trim().toLowerCase()
		const now = yield* DateTime.nowAsDate

		const artifact = yield* lookupArtifactForAccessRequest(input.artifactId)

		if (!artifact || artifact.access_requests_enabled === false) {
			return yield* Effect.fail(
				new FeatureDisabledError({ message: 'Access requests are not available for this artifact.' }),
			)
		}

		return yield* upsertAccessRequestInTransaction({ artifact, requesterEmail, now, input })
	})
}

export function recordNotificationFailure(args: {
	request: RequestRow
	error: WorkosError
}): Effect.Effect<void, AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb
		yield* postgres
			.query(
				postgres.client
					.update(accessRequests)
					.set({
						notification_status: 'failed',
						updated_at: yield* DateTime.nowAsDate,
					})
					.where(eq(accessRequests.id, args.request.id)),
			)
			.pipe(
				Effect.mapError((error) => AccessRequestDbError.fromPostgresError('recordNotificationFailure', error)),
			)
	})
}

export function recordNotificationResults(args: {
	request: RequestRow
	results: Array<Result.Result<NotifyResult, ResendError>>
}): Effect.Effect<void, AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb

		const initialAttempts: AccessRequestInitialEmailAttempts = []
		const scheduledReminders: AccessRequestScheduledReminders = []

		let successCount = 0
		let _failureCount = 0

		for (const result of args.results) {
			if (Result.isSuccess(result)) {
				const r = result.success
				if (r.ok) {
					successCount++
					initialAttempts.push({
						requestGeneration: args.request.request_generation,
						adminUserId: r.admin.userId,
						adminEmail: r.admin.email,
						resendEmailId: r.initialEmailId,
						sentAt: DateTime.formatIso(yield* DateTime.now),
					})
					scheduledReminders.push({
						requestGeneration: args.request.request_generation,
						adminUserId: r.admin.userId,
						adminEmail: r.admin.email,
						resendEmailId: r.reminderEmailId,
						scheduledAt: r.scheduledAt,
					})
				} else {
					_failureCount++
					initialAttempts.push({
						requestGeneration: args.request.request_generation,
						adminUserId: r.admin.userId,
						adminEmail: r.admin.email,
						error: r.error,
					})
				}
			} else {
				_failureCount++
			}
		}

		let notificationStatus: 'scheduled' | 'partial' | 'failed'
		if (args.results.length === 0) {
			notificationStatus = 'scheduled'
		} else if (successCount === args.results.length) {
			notificationStatus = 'scheduled'
		} else if (successCount > 0) {
			notificationStatus = 'partial'
		} else {
			notificationStatus = 'failed'
		}

		const firstReminder = scheduledReminders[0]
		let reminderScheduledAt: Date | null = null
		if (firstReminder) {
			const parsed = parseReminderScheduledAt(firstReminder.scheduledAt)
			if (Option.isNone(parsed)) {
				// Drizzle serializes timestamp Dates with toISOString(), which rejects an
				// invalid Date with RangeError. Fail at this persistence boundary instead
				// of replacing malformed provider metadata with null or the current time.
				return yield* Effect.fail(
					AccessRequestDbError.fromCause('recordNotificationResults', new RangeError('Invalid time value')),
				)
			}
			reminderScheduledAt = DateTime.toDateUtc(parsed.value)
		}

		yield* postgres
			.query(
				postgres.client
					.update(accessRequests)
					.set({
						notification_status: notificationStatus,
						initial_email_attempts: initialAttempts,
						scheduled_reminders: scheduledReminders,
						reminder_scheduled_at: reminderScheduledAt,
						updated_at: yield* DateTime.nowAsDate,
					})
					.where(eq(accessRequests.id, args.request.id)),
			)
			.pipe(
				Effect.mapError((error) => AccessRequestDbError.fromPostgresError('recordNotificationResults', error)),
			)
	})
}

export function updateRequestToArchived(
	input: ArchiveAccessRequestInput,
): Effect.Effect<ArchivedRow, AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* DateTime.nowAsDate
		const [updated] = yield* postgres
			.query(
				postgres.client
					.update(accessRequests)
					.set({
						status: 'archived',
						archived_at: now,
						resolved_by_user_id: input.archivedByUserId,
						updated_at: now,
					})
					.where(
						and(
							eq(accessRequests.id, input.accessRequestId),
							eq(accessRequests.organization_id, input.organizationId),
						),
					)
					.returning({
						id: accessRequests.id,
						scheduled_reminders: accessRequests.scheduled_reminders,
					}),
			)
			.pipe(Effect.mapError((error) => AccessRequestDbError.fromPostgresError('updateRequestToArchived', error)))

		if (!updated) {
			return yield* Effect.fail(
				new AccessRequestDbError({
					operation: 'updateRequestToArchived',
					cause: new Error(`Access request not found: ${input.accessRequestId}`),
					retryable: false,
				}),
			)
		}

		return updated
	}).pipe(Effect.tapError((error) => logError('updateRequestToArchived', error)))
}

export function recordCancellationResults(args: {
	rowId: string
	cancelResults: ReminderCancelResult[]
	existingReminders: AccessRequestScheduledReminders
}): Effect.Effect<void, AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		if (args.cancelResults.length === 0) return

		const postgres = yield* PostgresDb

		const cancelMap = new Map(args.cancelResults.map((r) => [r.reminderId, r]))

		const updatedReminders: AccessRequestScheduledReminders = args.existingReminders.map((reminder) => {
			const result = cancelMap.get(reminder.resendEmailId)
			if (!result) return reminder
			return applyCancellationResult(reminder, result)
		})

		yield* postgres
			.query(
				postgres.client
					.update(accessRequests)
					.set({
						scheduled_reminders: updatedReminders,
						// Archiving cancels the pending reminders, so the notification lifecycle is
						// done — mirror the invite path (markRequestInvited) which also sets 'canceled'.
						notification_status: 'canceled',
						updated_at: yield* DateTime.nowAsDate,
					})
					.where(eq(accessRequests.id, args.rowId)),
			)
			.pipe(
				Effect.mapError((error) => AccessRequestDbError.fromPostgresError('recordCancellationResults', error)),
			)
	})
}

export function findPendingRequestsByOrgEmail(input: {
	organizationId: string
	email: string
}): Effect.Effect<PendingRowForInvite[], AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const requesterEmail = input.email.trim().toLowerCase()
		return yield* postgres
			.query(
				postgres.client
					.select({
						id: accessRequests.id,
						scheduled_reminders: accessRequests.scheduled_reminders,
					})
					.from(accessRequests)
					.where(
						and(
							eq(accessRequests.organization_id, input.organizationId),
							eq(sql`lower(${accessRequests.requester_email})`, requesterEmail),
							eq(accessRequests.status, 'pending'),
						),
					),
			)
			.pipe(
				Effect.mapError((error) =>
					AccessRequestDbError.fromPostgresError('findPendingRequestsByOrgEmail', error),
				),
			)
	})
}

export function markRequestInvited(args: {
	rowId: string
	actingAdminUserId: string
	cancelResults: ReminderCancelResult[]
	existingReminders: AccessRequestScheduledReminders
}): Effect.Effect<void, AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* DateTime.nowAsDate

		const cancelMap = new Map(args.cancelResults.map((r) => [r.reminderId, r]))
		const updatedReminders: AccessRequestScheduledReminders = args.existingReminders.map((reminder) => {
			const result = cancelMap.get(reminder.resendEmailId)
			if (!result) return reminder
			return applyCancellationResult(reminder, result)
		})

		yield* postgres
			.query(
				postgres.client
					.update(accessRequests)
					.set({
						status: 'invited',
						resolved_at: now,
						resolved_by_user_id: args.actingAdminUserId,
						scheduled_reminders: updatedReminders,
						notification_status: 'canceled',
						updated_at: now,
					})
					.where(eq(accessRequests.id, args.rowId)),
			)
			.pipe(Effect.mapError((error) => AccessRequestDbError.fromPostgresError('markRequestInvited', error)))
	})
}

export function backfillRequesterByEmail(input: {
	email: string
	userId: string
}): Effect.Effect<void, AccessRequestDbError, PostgresDb> {
	return Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const requesterEmail = input.email.trim().toLowerCase()
		yield* postgres
			.query(
				postgres.client
					.update(accessRequests)
					.set({
						requester_user_id: input.userId,
						updated_at: yield* DateTime.nowAsDate,
					})
					.where(
						and(
							eq(sql`lower(${accessRequests.requester_email})`, requesterEmail),
							sql`${accessRequests.requester_user_id} IS NULL`,
						),
					),
			)
			.pipe(Effect.mapError((error) => AccessRequestDbError.fromPostgresError('backfillRequesterByEmail', error)))
	})
}
