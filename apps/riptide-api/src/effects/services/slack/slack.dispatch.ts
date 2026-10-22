import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import { slackNotificationThreads } from '@humanlayer/db/tables/slack-notification-threads'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect, Exit, Redacted } from 'effect'

import { Sentry } from '../../../instrument'
import { PostgresDb } from '../postgres/postgres-db.service'
import { resolveUserDisplayNames } from '../workos/display-name'
import { WorkosService } from '../workos/workos.service'
import { artifactTypeToSlackEventType, formatArtifactSlackMessage, formatCommentSlackMessage } from './format'
import { SlackIntegrationUnavailableError } from './slack.errors'
import {
	markSlackConnectionNeedsReauth,
	markSlackThreadDeliveryFailed,
	requireSlackConnection,
} from './slack.persistence'
import type {
	AutomationMessageBuilder,
	DeliveryContext,
	DeliverToAutomationInput,
	DispatchArtifactEventInput,
	DispatchCommentEventInput,
	EnsureSlackThreadRootInput,
	EnsureSlackThreadRootResult,
	MatchingAutomationRow,
	SlackEvent,
	SlackPostMessage,
	SlackProviderError,
	SlackThreadClaimReleaseContext,
} from './slack.types'

/**
 * Fans a task artifact event out to every enabled Slack automation in the organization, posting the
 * artifact as each automation thread's root on first delivery and as a threaded reply thereafter.
 */
export const dispatchArtifactEvent = (
	input: DispatchArtifactEventInput,
): Effect.Effect<void, never, PostgresDb | WorkosService> =>
	dispatchEventToAutomations(input.event, input.postMessage, (row, ownerName) => {
		const eventType = artifactTypeToSlackEventType(input.event.artifactType)
		if (!eventType || !row.automation.event_types.includes(eventType)) return null
		return formatArtifactSlackMessage(
			{
				event: input.event,
				appOrigin: input.appOrigin,
				taskName: row.task?.name,
				ownerName,
			},
			eventType,
		)
	})

/**
 * Fans a task comment event out to every enabled Slack automation subscribed to comments. The thread
 * root carries the task title, quote, and comment body; threaded replies stay lean.
 */
export const dispatchCommentEvent = (
	input: DispatchCommentEventInput,
): Effect.Effect<void, never, PostgresDb | WorkosService> =>
	dispatchEventToAutomations(input.event, input.postMessage, (row, commenterName) => {
		if (!row.automation.event_types.includes('comment')) return null
		return formatCommentSlackMessage({
			event: input.event,
			appOrigin: input.appOrigin,
			taskName: row.task?.name,
			commenterName,
		})
	})

/**
 * Shared delivery pipeline behind {@link dispatchArtifactEvent} and {@link dispatchCommentEvent}.
 *
 * Bails quietly when the organization has Slack disabled or no usable connection; otherwise loads
 * every enabled automation (joined to its task) and hands each one to {@link deliverToAutomation}.
 *
 * Dispatch is best-effort and never surfaces an error to its caller (`never` error channel): a single
 * delivery's failure is absorbed so the remaining automations still post, and any failed prerequisite
 * or unexpected defect is logged + reported to Sentry, then swallowed, by the outer net.
 */
const dispatchEventToAutomations = (
	event: SlackEvent,
	postMessage: SlackPostMessage,
	buildMessage: AutomationMessageBuilder,
): Effect.Effect<void, never, PostgresDb | WorkosService> => {
	const context = { organizationId: event.organizationId, taskId: event.taskId }
	return Effect.gen(function* () {
		const slackEnabled = yield* loadSlackIntegrationEnabled(event.organizationId)
		yield* Effect.annotateCurrentSpan({ slack_enabled: slackEnabled })
		if (!slackEnabled) return

		const connection = yield* requireSlackConnection(event.organizationId)
		const automations = yield* loadEnabledAutomationsForTask(event.organizationId, event.taskId)
		yield* Effect.annotateCurrentSpan({ automation_count: automations.length })
		const actorDisplayName = yield* resolveActorDisplayName(actorUserId(event))
		const botToken = Redacted.make(connection.bot_access_token)

		for (const row of automations) {
			yield* deliverToAutomation({ event, row, botToken, actorDisplayName, postMessage, buildMessage })
		}
	}).pipe(
		Effect.catchCause((cause) =>
			Effect.gen(function* () {
				yield* Effect.logError('Slack dispatch failed', cause).pipe(Effect.annotateLogs(context))
				yield* Effect.sync(() =>
					Sentry.captureException(cause, { tags: { error_type: 'slack_dispatch_failure' }, extra: context }),
				)
			}),
		),
	)
}

/**
 * Delivers one automation's message: applies the owner/mute filters, ensures the per-automation Slack
 * thread root exists, then posts the reply. The dispatch that creates the thread root has already
 * published the event as the root message, so it skips the reply. Any failure is absorbed by
 * {@link absorbDeliveryFailure} so a single bad channel never blocks the other automations.
 */
const deliverToAutomation = (input: DeliverToAutomationInput): Effect.Effect<void, never, PostgresDb> => {
	const { automation, task } = input.row
	const context: DeliveryContext = {
		organizationId: input.event.organizationId,
		taskId: input.event.taskId,
		automationId: automation.id,
		channelId: automation.channel_id,
	}
	return Effect.gen(function* () {
		if (!matchesOwnerFilter(automation.owner_user_ids, input.event.resourceOwnerUserId)) return
		// The task-level mute gates owner-filtered automations only; org-wide automations always post.
		// Read straight off the task row already joined into each automation row (no extra query).
		if (task?.slack_notifications_muted && isOwnerFiltered(automation.owner_user_ids)) return

		const message = input.buildMessage(input.row, input.actorDisplayName)
		if (!message) return

		const threadRoot = yield* ensureSlackThreadRoot({
			postMessage: input.postMessage,
			botToken: input.botToken,
			organizationId: input.event.organizationId,
			automationId: automation.id,
			channelId: automation.channel_id,
			taskId: input.event.taskId,
			rootBlocks: message.rootBlocks,
		})
		if (threadRoot.created) return

		yield* input.postMessage({
			botToken: input.botToken,
			channelId: automation.channel_id,
			blocks: message.replyBlocks,
			threadTs: threadRoot.rootTs,
			broadcast: message.broadcast,
		})
	}).pipe(
		Effect.withSpan('slack.dispatch.deliverToAutomation', {
			attributes: { automation_id: automation.id, channel_id: automation.channel_id },
		}),
		absorbDeliveryFailure(context),
	)
}

/** Reads whether the organization has the Slack integration toggled on. */
const loadSlackIntegrationEnabled = (
	organizationId: string,
): Effect.Effect<boolean, SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		return yield* pg
			.query(
				pg.client
					.select({ enabled: organizationSettings.slack_integration_enabled })
					.from(organizationSettings)
					.where(eq(organizationSettings.organization_id, organizationId))
					.limit(1),
			)
			.pipe(
				Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })),
				Effect.map(([settings]) => Boolean(settings?.enabled)),
			)
	})

/** Loads every enabled automation for the organization, joined to the event's task row. */
const loadEnabledAutomationsForTask = (
	organizationId: string,
	taskId: string,
): Effect.Effect<readonly MatchingAutomationRow[], SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		return yield* pg
			.query(
				pg.client
					.select({ automation: slackNotificationAutomations, task: tasks })
					.from(slackNotificationAutomations)
					.leftJoin(tasks, and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
					.where(
						and(
							eq(slackNotificationAutomations.organization_id, organizationId),
							eq(slackNotificationAutomations.enabled, true),
						),
					),
			)
			.pipe(Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })))
	})

/** Resolves the acting user's display name for message formatting; best-effort and never fails. */
const resolveActorDisplayName = (userId: string): Effect.Effect<string | null, never, WorkosService> =>
	Effect.gen(function* () {
		const displayNamesById = yield* resolveUserDisplayNames([userId])
		return displayNamesById.get(userId) ?? null
	})

/** The user whose name appears in the notification: the commenter for comments, else the resource owner. */
const actorUserId = (event: SlackEvent): string =>
	'commenterUserId' in event ? event.commenterUserId : event.resourceOwnerUserId

/**
 * Idempotently establishes the Slack thread root for an (automation, channel, task) tuple.
 *
 * The first concurrent dispatch claims the row, posts the root message, and marks the thread `ready`
 * (returning `created: true`); losers read the existing root and reply to it (`created: false`).
 * Implemented with `acquireUseRelease` so a claim winner that fails to publish deletes its `pending`
 * row, letting the next event re-claim instead of deadlocking.
 */
const ensureSlackThreadRoot = (
	input: EnsureSlackThreadRootInput,
): Effect.Effect<EnsureSlackThreadRootResult, SlackProviderError | SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb

		return yield* Effect.acquireUseRelease(
			// acquire (runs uninterruptibly): claim the thread row, or resolve undefined when another dispatch owns it.
			pg
				.query(
					pg.client
						.insert(slackNotificationThreads)
						.values({
							organization_id: input.organizationId,
							automation_id: input.automationId,
							task_id: input.taskId,
							channel_id: input.channelId,
							status: 'pending',
						})
						.onConflictDoNothing()
						.returning(),
				)
				.pipe(
					Effect.map((rows) => rows[0]),
					Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })),
				),
			// use: the winner publishes the root and marks the thread ready; everyone else replies to the existing root.
			(inserted) =>
				inserted
					? Effect.gen(function* () {
							const posted = yield* input.postMessage({
								botToken: input.botToken,
								channelId: input.channelId,
								blocks: input.rootBlocks,
							})
							yield* pg
								.query(
									pg.client
										.update(slackNotificationThreads)
										.set({
											root_thread_ts: posted.ts,
											root_message_ts: posted.ts,
											status: 'ready',
											last_error_code: null,
											updated_at: BigInt(yield* Clock.currentTimeMillis),
										})
										.where(eq(slackNotificationThreads.id, inserted.id)),
								)
								.pipe(Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })))
							return { rootTs: posted.ts, created: true }
						})
					: Effect.gen(function* () {
							const [existing] = yield* pg
								.query(
									pg.client
										.select()
										.from(slackNotificationThreads)
										.where(
											and(
												eq(slackNotificationThreads.automation_id, input.automationId),
												eq(slackNotificationThreads.channel_id, input.channelId),
												eq(slackNotificationThreads.task_id, input.taskId),
											),
										)
										.limit(1),
								)
								.pipe(Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })))

							if (existing?.root_thread_ts) return { rootTs: existing.root_thread_ts, created: false }
							return yield* Effect.fail(
								new SlackIntegrationUnavailableError({ cause: 'Slack thread root is pending' }),
							)
						}),
			// release: only the claim winner whose publish failed or was interrupted deletes its `pending` row,
			// so the next event re-claims instead of deadlocking. Guarded to `pending` so a thread that reached
			// `ready` is never removed; a cleanup failure is captured (log + Sentry), never masking the original error.
			(inserted, exit) =>
				inserted && Exit.isFailure(exit)
					? pg
							.query(
								pg.client
									.delete(slackNotificationThreads)
									.where(
										and(
											eq(slackNotificationThreads.id, inserted.id),
											eq(slackNotificationThreads.status, 'pending'),
										),
									),
							)
							.pipe(
								Effect.catchCause((cause) =>
									Effect.gen(function* () {
										const releaseContext: SlackThreadClaimReleaseContext = {
											organizationId: input.organizationId,
											taskId: input.taskId,
											automationId: input.automationId,
											channelId: input.channelId,
											threadId: inserted.id,
										}
										yield* Effect.logError('Slack thread claim release failed', cause).pipe(
											Effect.annotateLogs(releaseContext),
										)
										yield* Effect.sync(() =>
											Sentry.captureException(cause, {
												tags: { error_type: 'slack_thread_claim_release_failure' },
												extra: releaseContext,
											}),
										)
									}),
								),
							)
					: Effect.void,
		)
	}).pipe(
		Effect.tap((result) => Effect.annotateCurrentSpan({ created: result.created })),
		Effect.withSpan('slack.dispatch.ensureThreadRoot', {
			attributes: {
				automation_id: input.automationId,
				channel_id: input.channelId,
				task_id: input.taskId,
			},
		}),
	)

/** True when an automation has no owner filter, or the event's resource owner is in that filter. */
const matchesOwnerFilter = (ownerUserIds: readonly string[] | null, resourceOwnerUserId: string): boolean =>
	!ownerUserIds || ownerUserIds.length === 0 || ownerUserIds.includes(resourceOwnerUserId)

/** True when the automation targets specific owners (so the task owner's mute preference applies). */
const isOwnerFiltered = (ownerUserIds: readonly string[] | null): boolean => !!ownerUserIds && ownerUserIds.length > 0

/**
 * Absorbs a single automation's delivery failure back into the success channel so the dispatch loop
 * keeps going. Reports every failure (log + Sentry); the four errors with a remediation are then
 * persisted inline — revoked tokens and missing scopes flag the connection for reconnect, channel
 * problems mark the thread's delivery as failed for Settings guidance. A failed persistence write is
 * swallowed too (the Postgres layer logs its own error), so one bad automation never blocks the rest.
 */
const absorbDeliveryFailure =
	(context: DeliveryContext) =>
	<A, R>(
		delivery: Effect.Effect<A, SlackProviderError | SlackIntegrationUnavailableError, R>,
	): Effect.Effect<void, never, R | PostgresDb> =>
		delivery.pipe(
			Effect.asVoid,
			Effect.tapError((error) =>
				Effect.logError('Slack dispatch failed', error).pipe(Effect.annotateLogs(context)),
			),
			Effect.tapError((error) =>
				Effect.sync(() =>
					Sentry.captureException(error, { tags: { error_type: 'slack_dispatch_failure' }, extra: context }),
				),
			),
			Effect.catchTags({
				SlackTokenRevokedError: () => markSlackConnectionNeedsReauth(context.organizationId, 'token_revoked'),
				SlackMissingScopeError: () => markSlackConnectionNeedsReauth(context.organizationId, 'missing_scope'),
				SlackNotInChannelError: () =>
					markSlackThreadDeliveryFailed({
						automationId: context.automationId,
						channelId: context.channelId,
						taskId: context.taskId,
						errorCode: 'not_in_channel',
					}),
				SlackChannelNotFoundError: () =>
					markSlackThreadDeliveryFailed({
						automationId: context.automationId,
						channelId: context.channelId,
						taskId: context.taskId,
						errorCode: 'channel_not_found',
					}),
			}),
			Effect.catch(() => Effect.void),
		)
