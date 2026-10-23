import { randomUUID } from 'node:crypto'

import * as Sentry from '@sentry/node'
import { Context, DateTime, Effect, Layer, Option, Result } from 'effect'

import type {
	ArchiveAccessRequestInput,
	BackfillRequesterUserIdInput,
	CreateAccessRequestInput,
	CreateAccessRequestOutput,
	SendInviteAndResolveRequestsInput,
} from '../../../lib/access-request-port'
import { retryDbTransient, retryWorkosTransient } from '../../retry-schedules'
import type { PostgresDb } from '../postgres/postgres-db.service'
import { ResendConfig } from '../resend/resend-config.service'
import { ResendService } from '../resend/resend.service'
import { WorkosService } from '../workos/workos.service'
import {
	backfillRequesterByEmail,
	findPendingRequestsByOrgEmail,
	insertOrReopenRequest,
	lookupArtifactWorkosOrgForAccessRequest,
	markRequestInvited,
	recordCancellationResults,
	recordNotificationFailure,
	recordNotificationResults,
	updateRequestToArchived,
} from './access-request-db'
import {
	AccessRequestUnavailableError,
	AccessRequestValidationError,
	type AlreadyRequestedAccessError,
	type FeatureDisabledError,
} from './access-request-errors'
import { DAY_MS, logError, parseReminderScheduledAt, type ReminderCancelResult } from './access-request-internal'
import {
	buildArtifactUrl,
	buildInviteUrl,
	buildOwnerName,
	buildRequesterDisplay,
	buildTaskUrl,
	notifyAdmin,
} from './access-request-notify'

/**
 * Input for the public-create entry point. The procedure passes the authoritative
 * `authUserId` (from the JWT) and, for anonymous callers, the client-supplied
 * `submittedEmail`. The service is the deep module that owns requester-email
 * resolution, the membership guardrail, and the underlying create flow.
 */
export type RequestArtifactAccessInput = {
	artifactId: string
	authUserId: string | null
	submittedEmail?: string
}

export class AccessRequestService extends Context.Service<
	AccessRequestService,
	{
		/**
		 * Public-create entry point. Resolves the requester email (authoritative WorkOS
		 * email for authed callers, `submittedEmail` for anonymous callers), applies the
		 * anti-enumeration membership guardrail, then inserts/reopens the request and
		 * fans out admin notifications. Exposes only access-request domain errors — the
		 * underlying `AccessRequestDbError` and WorkOS transport errors are mapped to
		 * `AccessRequestUnavailableError` (or short-circuited) at this boundary.
		 */
		requestArtifactAccess: (
			input: RequestArtifactAccessInput,
		) => Effect.Effect<
			CreateAccessRequestOutput,
			| AccessRequestValidationError
			| AlreadyRequestedAccessError
			| FeatureDisabledError
			| AccessRequestUnavailableError,
			PostgresDb
		>
		/**
		 * Lower-level create used by direct service tests. `requestArtifactAccess` builds
		 * on this after resolving the requester email and running the guardrail.
		 */
		createAccessRequest: (
			input: CreateAccessRequestInput,
		) => Effect.Effect<
			CreateAccessRequestOutput,
			AlreadyRequestedAccessError | FeatureDisabledError | AccessRequestUnavailableError,
			PostgresDb
		>
		sendInviteAndResolveRequests: (
			input: SendInviteAndResolveRequestsInput,
		) => Effect.Effect<void, AccessRequestUnavailableError, PostgresDb>
		backfillRequesterUserId: (
			input: BackfillRequesterUserIdInput,
		) => Effect.Effect<void, AccessRequestUnavailableError, PostgresDb>
		archiveRequest: (
			input: ArchiveAccessRequestInput,
		) => Effect.Effect<void, AccessRequestUnavailableError, PostgresDb>
	}
>()('AccessRequestService') {}

function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * DAY_MS)
}

function captureAndContinue(error: unknown): Effect.Effect<void> {
	return logError('background step', error)
}

export const AccessRequestServiceLive = Layer.effect(
	AccessRequestService,
	Effect.gen(function* () {
		const workos = yield* WorkosService
		const resend = yield* ResendService
		const resendConfig = yield* ResendConfig

		const lookupUser = (userId: string | null) =>
			userId
				? workos.getUser({ userId }).pipe(
						Effect.result,
						Effect.map((either) => (Result.isSuccess(either) ? either.success : null)),
					)
				: Effect.succeed(null)

		// Cancel a single scheduled reminder, recording the outcome per-reminder.
		// Failures are surfaced to logs/Sentry (not just swallowed into cancelError)
		// so a broken cancel — e.g. a Resend key lacking cancel permission — is observable.
		const cancelReminder = (reminder: { resendEmailId: string }): Effect.Effect<ReminderCancelResult> =>
			resend.cancelScheduled({ emailId: reminder.resendEmailId }).pipe(
				Effect.flatMap(() =>
					Effect.gen(function* () {
						return {
							reminderId: reminder.resendEmailId,
							canceledAt: DateTime.formatIso(yield* DateTime.now),
							cancelError: null,
						}
					}),
				),
				Effect.catch((error) =>
					logError(`cancelScheduled(${reminder.resendEmailId})`, error).pipe(
						Effect.as({
							reminderId: reminder.resendEmailId,
							canceledAt: null,
							cancelError: error instanceof Error ? error.message : String(error),
						}),
					),
				),
			)

		// Core create flow (insert/reopen + admin notification fan-out). Kept as a private
		// program so both the lower-level `createAccessRequest` method and the public
		// `requestArtifactAccess` entry point share exactly the same persistence and
		// notification behavior. Carries the underlying `AccessRequestDbError` in its
		// error channel; callers map it to `AccessRequestUnavailableError` at the boundary.
		const createAccessRequestProgram = (input: CreateAccessRequestInput) =>
			Effect.gen(function* () {
				const request = yield* retryDbTransient(insertOrReopenRequest(input))

				// Guard: if the requester already has a pending WorkOS invitation, an admin
				// has already invited them — don't re-notify admins. The caller surfaces a
				// "check your email" screen instead. Best-effort: if the WorkOS lookup fails,
				// fall through to the normal admin notification path.
				const alreadyInvited = yield* retryWorkosTransient(
					workos.hasPendingInvitation({
						workosOrganizationId: request.workosOrganizationId,
						email: request.requesterEmail,
					}),
				).pipe(Effect.catch(() => Effect.succeed(false)))

				if (alreadyInvited) {
					return { accessRequestId: request.id, alreadyInvited: true }
				}

				const scheduledAt = addDays(request.requestedAt, 3)

				const adminsResult = yield* retryWorkosTransient(
					workos.listActiveAdmins({ workosOrganizationId: request.workosOrganizationId }),
				).pipe(Effect.result)

				if (Result.isFailure(adminsResult)) {
					yield* retryDbTransient(recordNotificationFailure({ request, error: adminsResult.failure })).pipe(
						Effect.catch(captureAndContinue),
					)

					return { accessRequestId: request.id, alreadyInvited: false }
				}

				const admins = adminsResult.success

				const [requesterUser, ownerUser] = yield* Effect.all(
					[lookupUser(request.requesterUserId), lookupUser(request.artifact_owner_user_id)],
					{ concurrency: 2 },
				)

				const requesterDisplay = buildRequesterDisplay(requesterUser, request.requesterEmail)
				const requesterFirstName = requesterUser?.firstName ?? null
				const artifactOwnerName = buildOwnerName(ownerUser)
				const inviteUrl = buildInviteUrl(resendConfig.cloudOrigin, request.requesterEmail)
				const taskUrl = request.taskId ? buildTaskUrl(resendConfig.appOrigin, request.taskId) : null
				const artifactUrl = buildArtifactUrl(resendConfig.cloudOrigin, request.artifact_id)

				const results = yield* Effect.forEach(
					admins,
					(admin) =>
						notifyAdmin({
							request,
							admin,
							scheduledAt,
							requesterDisplay,
							requesterFirstName,
							artifactOwnerName,
							inviteUrl,
							taskUrl,
							artifactUrl,
							resend,
						}).pipe(Effect.result),
					{ concurrency: 3 },
				)

				yield* retryDbTransient(recordNotificationResults({ request, results })).pipe(
					Effect.catch(captureAndContinue),
				)

				return { accessRequestId: request.id, alreadyInvited: false }
			})

		return {
			requestArtifactAccess: (input) =>
				Effect.gen(function* () {
					// Authenticated callers: use their authoritative WorkOS email (email is not a
					// token claim, and trusting client-supplied input here would be spoofable).
					// Anonymous callers must provide an email in the request body.
					let requesterEmail: string | undefined
					if (input.authUserId) {
						const user = yield* workos.getUser({ userId: input.authUserId }).pipe(
							Effect.mapError(
								(cause) =>
									new AccessRequestUnavailableError({
										operation: 'resolve requester email',
										cause,
									}),
							),
						)
						requesterEmail = user.email
					} else {
						requesterEmail = input.submittedEmail
					}

					if (!requesterEmail) {
						return yield* Effect.fail(
							new AccessRequestValidationError({
								message: 'email is required for unauthenticated requests',
							}),
						)
					}

					// Membership guardrail: if the requester is already an active member of the
					// artifact's org they already have access, so writing a row and fanning admin
					// emails would be spurious. Short-circuit with a neutral "submitted" response
					// that's byte-for-byte indistinguishable from a genuine outsider's submission
					// (synthesized accessRequestId, alreadyInvited: false) so anonymous callers
					// can't enumerate org membership. A departed owner (membership no longer
					// active) is treated as a legitimate outsider and falls through.
					//
					// Best-effort: any WorkOS/DB error → fall through to the normal create flow
					// (fail-open), matching the artifacts/info.ts membership-lookup pattern.
					const resolvedEmail = requesterEmail
					const isActiveMember = yield* Effect.gen(function* () {
						let requesterUserId = input.authUserId
						if (!requesterUserId) {
							const users = yield* workos.listUsersByEmail({ email: resolvedEmail })
							requesterUserId = users[0]?.userId ?? null
						}

						if (!requesterUserId) return false

						const workosOrganizationId = yield* lookupArtifactWorkosOrgForAccessRequest(input.artifactId)
						if (!workosOrganizationId) return false

						const memberships = yield* workos.listActiveOrganizationMemberships({
							userId: requesterUserId,
							organizationId: workosOrganizationId,
							limit: 1,
						})
						return memberships.length > 0
					}).pipe(
						Effect.catch((error) =>
							Effect.gen(function* () {
								yield* Effect.logError('access-request guardrail membership lookup failed', error)
								yield* Effect.sync(() => {
									Sentry.captureException(error, { tags: { error_type: 'access_request_guardrail' } })
								})
								return false
							}),
						),
					)

					if (isActiveMember) {
						return { accessRequestId: randomUUID(), alreadyInvited: false }
					}

					return yield* createAccessRequestProgram({
						artifactId: input.artifactId,
						requesterEmail: resolvedEmail,
						requesterUserId: input.authUserId,
					})
				}).pipe(
					Effect.catchTag('AccessRequestDbError', (error) =>
						Effect.fail(
							new AccessRequestUnavailableError({ operation: 'request artifact access', cause: error }),
						),
					),
				),

			createAccessRequest: (input) =>
				createAccessRequestProgram(input).pipe(
					Effect.catchTag('AccessRequestDbError', (error) =>
						Effect.fail(
							new AccessRequestUnavailableError({ operation: 'create access request', cause: error }),
						),
					),
				),

			sendInviteAndResolveRequests: (input) =>
				Effect.gen(function* () {
					// Send invitation via WorkOS - treat AlreadyInvited as effective success.
					// If WorkOS fails for any reason, log and continue — the access request
					// resolution (DB updates) should proceed independently.
					yield* retryWorkosTransient(
						workos.sendInvitation({
							email: input.requesterEmail,
							organizationId: input.workosOrganizationId,
							inviterUserId: input.actingAdminUserId,
							roleSlug: input.roleSlug,
							expiresInDays: input.expiresInDays,
						}),
					).pipe(
						// Treat "already invited" client errors as effective success
						Effect.catchTag('WorkosClientError', (e) => {
							const msg = (e.cause instanceof Error ? e.cause.message : String(e.cause)).toLowerCase()
							if (msg.includes('already invited')) return Effect.succeed(null)
							return captureAndContinue(e)
						}),
						Effect.catchTag('WorkosAlreadyInvitedError', () => Effect.succeed(null)),
						Effect.catchTag('WorkosRateLimitError', (e) => captureAndContinue(e)),
						Effect.catchTag('WorkosServerError', (e) => captureAndContinue(e)),
						Effect.catchTag('WorkosNetworkError', (e) => captureAndContinue(e)),
					)

					// Find all pending access requests for this email in this org
					const pendingRows = yield* retryDbTransient(
						findPendingRequestsByOrgEmail({
							organizationId: input.organizationId,
							email: input.requesterEmail,
						}),
					)

					// For each pending row: cancel future reminders + mark as invited
					yield* Effect.forEach(
						pendingRows,
						(row) =>
							Effect.gen(function* () {
								const now = yield* DateTime.nowAsDate
								const futureReminders = row.scheduled_reminders.filter(
									(r) =>
										!r.canceledAt &&
										Option.exists(
											parseReminderScheduledAt(r.scheduledAt),
											(scheduledAt) => DateTime.toEpochMillis(scheduledAt) > now.getTime(),
										),
								)

								const cancelResults = yield* Effect.forEach(futureReminders, cancelReminder, {
									concurrency: 3,
								})

								yield* retryDbTransient(
									markRequestInvited({
										rowId: row.id,
										actingAdminUserId: input.actingAdminUserId,
										cancelResults,
										existingReminders: row.scheduled_reminders,
									}),
								)
							}),
						{ concurrency: 3 },
					)
				}).pipe(
					Effect.catchTag('AccessRequestDbError', (error) =>
						Effect.fail(
							new AccessRequestUnavailableError({
								operation: 'send invite and resolve requests',
								cause: error,
							}),
						),
					),
				),

			backfillRequesterUserId: (input) =>
				retryDbTransient(backfillRequesterByEmail(input)).pipe(
					Effect.asVoid,
					Effect.catchTag('AccessRequestDbError', (error) =>
						Effect.fail(
							new AccessRequestUnavailableError({
								operation: 'backfill requester user id',
								cause: error,
							}),
						),
					),
				),

			archiveRequest: (input) =>
				Effect.gen(function* () {
					const row = yield* retryDbTransient(updateRequestToArchived(input))

					const now = yield* DateTime.nowAsDate
					const futureReminders = row.scheduled_reminders.filter(
						(r) =>
							!r.canceledAt &&
							Option.exists(
								parseReminderScheduledAt(r.scheduledAt),
								(scheduledAt) => DateTime.toEpochMillis(scheduledAt) > now.getTime(),
							),
					)

					if (futureReminders.length === 0) return

					const cancelResults = yield* Effect.forEach(futureReminders, cancelReminder, {
						concurrency: 3,
					})

					yield* retryDbTransient(
						recordCancellationResults({
							rowId: row.id,
							cancelResults,
							existingReminders: row.scheduled_reminders,
						}),
					).pipe(Effect.catch(captureAndContinue))
				}).pipe(
					Effect.catchTag('AccessRequestDbError', (error) =>
						Effect.fail(new AccessRequestUnavailableError({ operation: 'archive request', cause: error })),
					),
				),
		}
	}),
)
