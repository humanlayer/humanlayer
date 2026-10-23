import { extractNextStepEffect } from '@humanlayer/ai/extract-next-step/effect'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { resolveEffectiveContextWindow } from '@humanlayer/schemas/effect/model-context'
import { isStructuredTaskWorkflow } from '@humanlayer/schemas/effect/taskconfiguration'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Clock, Effect } from 'effect'

import { getTxId } from '../../../db/get-tx-id'
import { rejectPendingApprovals } from '../../../db/reject-pending-approvals'
import { canWriteTaskForSession } from '../../../db/task-auth'
import { ExperimentAnalyticsService } from '../../../effects/services/experiment-analytics/experiment-analytics.service'
import { Sentry } from '../../../instrument'
import { buildAttributedPrompt } from '../../../lib/session-prompt-attribution'
import logger from '../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../base'
import { checkAutoAdvance } from './check-auto-advance'
import { mergeModelUsage } from './merge-model-usage'

/** Extended type that includes id for next step extraction */
type ConversationEventInputWithId = Pick<
	typeof conversationEvents.$inferSelect,
	'id' | 'role' | 'content' | 'event_type'
>

/**
 * How many applied usage-report keys to remember per session. A replayed report is only
 * double-counted if its key has already been evicted, so the bound just needs to exceed the
 * number of runs that can complete while a retry of an earlier report is still pending
 * (the daemon's oRPC client makes 5 attempts spaced 2s apart).
 */
const APPLIED_USAGE_REPORT_KEYS_LIMIT = 20

/**
 * Update a session's status and metadata.
 *
 * Authorization:
 * - Daemon must be running this session (host_id check)
 * - User must have write permission on session (via task ACL or session ownership)
 */
export const updateSessionProcedure = daemonBase.sessions.update
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { userId, organizationId, hostId } = context.auth
		const { services } = context
		const { db } = services

		try {
			const txResult = await db.transaction(async (tx) => {
				// 1. Fetch session with auth-relevant fields (and fields needed for model/usage updates)
				const [session] = await tx
					.select({
						id: sessions.id,
						task_id: sessions.task_id,
						created_by: sessions.created_by,
						resource_owner_user_id: sessions.resource_owner_user_id,
						host_id: sessions.host_id,
						provider: sessions.provider,
						coding_agent: sessions.coding_agent,
						total_cost_usd: sessions.total_cost_usd,
						model_usage: sessions.model_usage,
						applied_usage_report_keys: sessions.applied_usage_report_keys,
						status: sessions.status,
					})
					.from(sessions)
					.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, organizationId)))
					.limit(1)
					.for('no key update')

				if (!session) {
					throw errors.NOT_FOUND()
				}

				// 2. Verify daemon is running this session (host_id check)
				if (session.host_id !== hostId || session.created_by !== userId) {
					throw errors.FORBIDDEN()
				}

				// 3. Use task auth helper for permission check
				const canWrite = await canWriteTaskForSession(tx, session, userId, organizationId)
				if (!canWrite) {
					throw errors.FORBIDDEN()
				}

				// Build update object with only provided fields
				const updateFields: Record<string, unknown> = {}
				if (input.codingAgentSessionId !== undefined) {
					updateFields.coding_agent_session_id = input.codingAgentSessionId
				}
				if (input.status !== undefined) {
					updateFields.status = input.status
					if (input.status === 'launching' || input.status === 'running') {
						updateFields.last_activity_at = BigInt(Date.now())
					}
				}
				if (input.model !== undefined) {
					updateFields.model = input.model
				}
				if (input.resolvedModel !== undefined) {
					updateFields.resolved_model = input.resolvedModel
				}
				if (input.errorMessage !== undefined) {
					updateFields.error_message = input.errorMessage
				}
				if (input.errorReason !== undefined) {
					updateFields.error_reason = input.errorReason
				}
				if (input.contextWindowTokens !== undefined) {
					updateFields.context_window_tokens = input.contextWindowTokens
				}
				if (input.contextWindowLimit !== undefined) {
					updateFields.context_window_limit = input.contextWindowLimit
				}
				if (input.isCompacting !== undefined) {
					updateFields.is_compacting = input.isCompacting
				}
				// Usage reports are per-run totals (the SDK's cumulative counters reset when a session
				// is resumed with a fresh query), so accumulate them into the session totals instead of
				// overwriting. usageReportKey dedupes retry replays: the daemon's oRPC client retries
				// failed calls with an identical payload, and re-applying the same report would
				// double-count. A bounded list of recent keys (not just the last one) is kept because a
				// delayed retry can arrive after a newer run's report was applied — e.g. auto-continue
				// starts the next run while the previous report's response is still lost in transit.
				// Legacy daemons that omit the key keep the old overwrite semantics (which never
				// double-counts on retry because overwrites are idempotent).
				if (input.totalCostUsd !== undefined || input.modelUsage !== undefined) {
					const appliedKeys = session.applied_usage_report_keys ?? []
					if (input.usageReportKey === undefined) {
						if (input.totalCostUsd !== undefined) {
							updateFields.total_cost_usd = input.totalCostUsd
						}
						if (input.modelUsage !== undefined) {
							updateFields.model_usage = input.modelUsage
						}
					} else if (!appliedKeys.includes(input.usageReportKey)) {
						if (input.totalCostUsd !== undefined) {
							updateFields.total_cost_usd = (session.total_cost_usd ?? 0) + input.totalCostUsd
						}
						if (input.modelUsage !== undefined) {
							updateFields.model_usage = mergeModelUsage(session.model_usage ?? {}, input.modelUsage)
						}
						updateFields.applied_usage_report_keys = [...appliedKeys, input.usageReportKey].slice(
							-APPLIED_USAGE_REPORT_KEYS_LIMIT,
						)
					}
					// else: this exact report was already applied (retry replay) — skip it
				}

				// Recalculate context window limit only when no runtime value is provided.
				// The resolved model (from the agent's init event) is the ground truth when
				// the user-selected model isn't part of this update.
				const modelForLimit = input.model ?? input.resolvedModel
				if (input.contextWindowLimit === undefined && modelForLimit !== undefined) {
					updateFields.context_window_limit = resolveEffectiveContextWindow({
						provider: session.provider,
						model: modelForLimit,
						codingAgent: session.coding_agent,
					})
				}

				// Drain pending queued messages on completion or interrupt-and-send.
				//
				// completion (ready_for_input): all pending rows, batch preference applies
				// interrupt (interrupted): only rows flagged deliver_on_interrupt — these are
				//   messages the user sent via interrupt-and-send. Zero flagged rows means a
				//   plain interrupt; the session stays interrupted with no override.
				//
				// Note: input.status is NOT modified — only updateFields.status is overridden —
				// so that side effects keyed on the reported status (extraction, approval denial)
				// still fire correctly.
				const drainMode =
					input.status === 'ready_for_input'
						? ('completion' as const)
						: input.status === 'interrupted'
							? ('interrupt' as const)
							: null

				if (drainMode) {
					// Batch preference only applies in completion mode
					let batchDelivery = true
					if (drainMode === 'completion') {
						const [userSettingsRow] = await tx
							.select({ prefer_batch_queue_delivery: userSettings.prefer_batch_queue_delivery })
							.from(userSettings)
							.where(
								and(
									eq(userSettings.user_id, session.resource_owner_user_id),
									eq(userSettings.organization_id, organizationId),
								),
							)
							.limit(1)

						batchDelivery = userSettingsRow?.prefer_batch_queue_delivery ?? true
					}
					const pendingConditions = [
						eq(queuedMessages.organization_id, organizationId),
						eq(queuedMessages.resource_owner_user_id, session.resource_owner_user_id),
						eq(queuedMessages.session_id, input.sessionId),
						eq(queuedMessages.status, 'pending'),
					]
					// Interrupt mode: only flagged rows. Completion mode: all pending rows.
					if (drainMode === 'interrupt') {
						pendingConditions.push(eq(queuedMessages.deliver_on_interrupt, true))
					}

					let pendingQuery = tx
						.select({
							id: queuedMessages.id,
							content: queuedMessages.content,
							user_id: queuedMessages.user_id,
							author_display_name: queuedMessages.author_display_name,
							multiplayer_prompting_active: queuedMessages.multiplayer_prompting_active,
							created_at: queuedMessages.created_at,
						})
						.from(queuedMessages)
						.where(and(...pendingConditions))
						.orderBy(asc(queuedMessages.created_at))
						.$dynamic()

					// One-at-a-time limit only in completion mode
					if (drainMode === 'completion' && !batchDelivery) {
						pendingQuery = pendingQuery.limit(1)
					}

					const pendingQueuedMessages = await pendingQuery

					if (pendingQueuedMessages.length === 0) {
						logger.info(
							{ sessionId: input.sessionId, drainMode },
							drainMode === 'completion'
								? 'Auto-continue skipped — no pending messages'
								: 'Interrupt drain skipped — no flagged messages',
						)
					} else {
						const concatenatedPrompt = buildAttributedPrompt(
							pendingQueuedMessages.map((m) => ({
								content: m.content,
								authorDisplayName: m.author_display_name,
								multiplayerPromptingActive: m.multiplayer_prompting_active,
							})),
						)

						// Override the status to resuming and set the prompt
						updateFields.status = 'resuming'
						updateFields.prompt = concatenatedPrompt
						updateFields.num_events = sql`${sessions.num_events} + ${pendingQueuedMessages.length}`

						// Mark only the selected queued messages as delivered (respects one-at-a-time mode)
						await tx
							.update(queuedMessages)
							.set({ status: 'delivered', updated_at: BigInt(Date.now()) })
							.where(
								inArray(
									queuedMessages.id,
									pendingQueuedMessages.map((m) => m.id),
								),
							)

						// Insert a conversation event for each queued message
						// so they appear as separate user messages in the conversation stream
						for (const msg of pendingQueuedMessages) {
							await tx.insert(conversationEvents).values({
								id: msg.id,
								session_id: input.sessionId,
								organization_id: organizationId,
								resource_owner_user_id: session.resource_owner_user_id,
								task_id: session.task_id,
								event_type: 'message',
								role: 'user',
								content: msg.content,
								user_id: msg.user_id,
							})
						}

						logger.info(
							{
								sessionId: input.sessionId,
								messageCount: pendingQueuedMessages.length,
								drainMode,
								batchDelivery,
							},
							drainMode === 'completion'
								? 'Auto-continuing session with queued messages'
								: 'Delivering interrupt-and-send messages',
						)
					}
				}

				// Update session. A retry replay of a usage-only report leaves nothing to write
				// (the skipped usage fields were the whole payload), and drizzle throws on an
				// empty set() — the replay must be a successful no-op, not an error.
				if (Object.keys(updateFields).length > 0) {
					await tx.update(sessions).set(updateFields).where(eq(sessions.id, input.sessionId))
				}

				// If transitioning to interrupted, deny all pending approvals
				if (input.status === 'interrupted') {
					await rejectPendingApprovals(tx, {
						sessionId: input.sessionId,
						organizationId: context.auth.organizationId,
						hostId: context.auth.hostId,
						comment: 'Session interrupted by user',
					})
				}

				// Query conversation events for next step extraction
				let conversationEventsResult: ConversationEventInputWithId[] = []

				if (input.status === 'ready_for_input') {
					// Fetch root messages only; next-step extraction reads the last assistant message.
					const rawEvents = await tx
						.select({
							id: conversationEvents.id,
							role: conversationEvents.role,
							content: conversationEvents.content,
							event_type: conversationEvents.event_type,
						})
						.from(conversationEvents)
						.where(
							and(
								eq(conversationEvents.session_id, input.sessionId),
								eq(conversationEvents.organization_id, context.auth.organizationId),
								isNull(conversationEvents.parent_tool_use_id), // Exclude subagent events
								eq(conversationEvents.event_type, 'message'),
							),
						)
						.orderBy(asc(conversationEvents.created_at))
					conversationEventsResult = rawEvents
				}

				let firstTaskCompletedAt: bigint | null = null
				const reachedReadyForInput =
					input.status === 'ready_for_input' &&
					updateFields.status === 'ready_for_input' &&
					(session.status === 'launching' || session.status === 'running')
				if (reachedReadyForInput) {
					const completedAt = BigInt(Date.now())
					const [task] = session.task_id
						? await tx
								.select({ workflow_type: tasks.workflow_type })
								.from(tasks)
								.where(eq(tasks.id, session.task_id))
								.limit(1)
						: []
					const [milestone] = await tx
						.insert(userSettings)
						.values({
							user_id: userId,
							organization_id: organizationId,
							first_task_completed_at: completedAt,
						})
						.onConflictDoUpdate({
							target: [userSettings.user_id, userSettings.organization_id],
							set: {
								first_task_completed_at: completedAt,
								updated_at: completedAt,
							},
							where: isNull(userSettings.first_task_completed_at),
						})
						.returning({ first_task_completed_at: userSettings.first_task_completed_at })
					firstTaskCompletedAt = milestone?.first_task_completed_at ?? null

					if (task && isStructuredTaskWorkflow(task.workflow_type)) {
						await tx
							.insert(userSettings)
							.values({
								user_id: userId,
								organization_id: organizationId,
								first_structured_workflow_completed_at: completedAt,
							})
							.onConflictDoUpdate({
								target: [userSettings.user_id, userSettings.organization_id],
								set: { first_structured_workflow_completed_at: completedAt, updated_at: completedAt },
								where: isNull(userSettings.first_structured_workflow_completed_at),
							})
					}
				}

				// Count the session once, the first time it leaves the launch queue: the
				// daemon has picked up a newly created session and started processing it.
				// This is the onboarding experiment's denominator (sessions started per
				// arm) — a deliberate proxy that also counts sessions which later fail,
				// which is what makes it track the working-session rate.
				const startedFromLaunchQueue = session.status === 'ready_for_launch' && input.status !== undefined

				const txid = await getTxId(tx)
				return {
					success: true,
					txid,
					conversationEventsResult,
					session,
					firstTaskCompletedAt,
					startedFromLaunchQueue,
				}
			})

			if (txResult.startedFromLaunchQueue) {
				services.effectRuntime.runFork(
					Effect.gen(function* () {
						const analytics = yield* ExperimentAnalyticsService
						yield* analytics.recordCodingAgentSessionCreated({
							userId,
							sessionId: input.sessionId,
							taskId: txResult.session.task_id,
							codingAgent: txResult.session.coding_agent ?? 'claude',
							createdAt: yield* Clock.currentTimeMillis,
						})
					}),
				)
			}

			// Fire-and-forget AI extractions AFTER transaction completes
			if (input.status === 'ready_for_input' && txResult.conversationEventsResult.length > 0) {
				// Chain extraction → auto-advance (extraction must complete first so auto-advance
				// can read next_step_suggestions for artifact-less transitions)
				void runExtractionThenAutoAdvanceAsync(
					db,
					input.sessionId,
					context.auth.organizationId,
					context.auth.userId,
					txResult.conversationEventsResult,
					services.effectRuntime,
				)
			}

			return {
				success: txResult.success,
				transactionId: txResult.txid,
			}
		} catch (error: unknown) {
			logger.error(error, 'Failed to update session')
			throw error
		}
	})

/** Run extraction async - does not block the response */
async function runExtractionAsync(
	db: PostgresJsDatabase,
	sessionId: string,
	organizationId: string,
	userId: string,
	messageContent: string,
	eventId: string,
) {
	try {
		const extraction = await Effect.runPromise(
			extractNextStepEffect(messageContent).pipe(
				Effect.catch((error) =>
					Effect.succeed({
						parsedAt: Date.now(),
						extraction: { type: 'no_next_step' as const, reason: 'Extraction failed' },
						extractionError: error.message,
					}),
				),
			),
		)
		if (extraction.extractionError) {
			logger.error({ sessionId, error: extraction.extractionError }, 'Next step extraction failed')
			Sentry.captureException(new Error(extraction.extractionError), {
				tags: { error_type: 'next_step_extraction' },
				extra: { sessionId },
			})
		}
		// Only update if we found a next step - don't overwrite previous good extraction with no_next_step
		if (extraction.extraction.type === 'next_step_found') {
			// Dual-write: session level (existing)
			await db
				.update(sessions)
				.set({ next_step_suggestions: [extraction] })
				.where(
					and(
						eq(sessions.id, sessionId),
						eq(sessions.organization_id, organizationId),
						eq(sessions.created_by, userId),
					),
				)

			// Dual-write: event level (NEW)
			await db
				.update(conversationEvents)
				.set({ next_step_suggestion: extraction })
				.where(
					and(
						eq(conversationEvents.id, eventId),
						eq(conversationEvents.organization_id, organizationId),
						eq(conversationEvents.resource_owner_user_id, userId),
					),
				)
		}
	} catch (err) {
		logger.error({ err, sessionId }, 'Next step extraction failed')
		Sentry.captureException(err, {
			tags: { error_type: 'next_step_extraction' },
			extra: { sessionId },
		})
	}
}

/** Chain extraction → auto-advance: extraction must complete before auto-advance can read next_step_suggestions.
 *  No outer try/catch needed — both runExtractionAsync and checkAutoAdvance have complete
 *  internal error handling (try/catch + Sentry) and will never throw. */
async function runExtractionThenAutoAdvanceAsync(
	db: PostgresJsDatabase,
	sessionId: string,
	organizationId: string,
	userId: string,
	conversationEvents: ConversationEventInputWithId[],
	effectRuntime: import('../../../effects/app-runtime').AppRuntime,
) {
	// Step 1: Run extraction (has its own try/catch + Sentry — never throws)
	const lastAssistantMessage = conversationEvents
		.filter((e) => e.event_type === 'message' && e.role === 'assistant')
		.at(-1)

	if (lastAssistantMessage?.content && lastAssistantMessage.id) {
		await runExtractionAsync(
			db,
			sessionId,
			organizationId,
			userId,
			lastAssistantMessage.content,
			lastAssistantMessage.id,
		)
	}

	// Step 2: Run auto-advance (checkAutoAdvance has its own try/catch + Sentry — never throws)
	await checkAutoAdvance(db, sessionId, organizationId, effectRuntime)
}
