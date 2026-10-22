import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { type SessionLabel, type SessionStatus, sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import * as Sentry from '@sentry/node'
import { and, eq, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { Effect, Option, Schema } from 'effect'

import { getTxId } from '../../../../db/get-tx-id'
import { canWriteTaskForSession } from '../../../../db/task-auth'
import { OnboardingService } from '../../../../effects/services/onboarding/onboarding.service'
import { stripNullBytes } from '../../../../lib/strip-null-bytes'
import logger from '../../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware, type Services } from '../../../base'

const RPI_SKILL_NAMES = [
	'create-research-questions',
	'iterate-research-questions',
	'create-research',
	'iterate-research',
	'create-prd',
	'iterate-prd',
	'create-tdd',
	'iterate-tdd',
	'create-design-discussion',
	'iterate-design-discussion',
	'create-structure-outline',
	'iterate-structure-outline',
	'create-plan',
	'iterate-plan',
	'setup-worktree',
	'implement-plan',
	'implement-outline',
	'iterate-implementation',
	'describe-pr',
] as const
const RpiSkillName = Schema.Literals(RPI_SKILL_NAMES)
type RpiSkillName = (typeof RPI_SKILL_NAMES)[number]

const SkillToolInput = Schema.Struct({
	skill: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
})

// Map RPI skills to labels - defined outside handler to avoid recreation
const skillToLabel: Record<RpiSkillName, SessionLabel> = {
	'create-research-questions': { name: 'rpi:research-questions', title: 'research-questions' },
	'iterate-research-questions': { name: 'rpi:research-questions', title: 'research-questions' },
	'create-research': { name: 'rpi:research', title: 'research' },
	'iterate-research': { name: 'rpi:research', title: 'research' },
	'create-prd': { name: 'rpi:design-prd', title: 'design-prd' },
	'iterate-prd': { name: 'rpi:design-prd', title: 'design-prd' },
	'create-tdd': { name: 'rpi:design-tdd', title: 'design-tdd' },
	'iterate-tdd': { name: 'rpi:design-tdd', title: 'design-tdd' },
	'create-design-discussion': { name: 'rpi:design', title: 'design' },
	'iterate-design-discussion': { name: 'rpi:design', title: 'design' },
	'create-structure-outline': { name: 'rpi:structure', title: 'structure' },
	'iterate-structure-outline': { name: 'rpi:structure', title: 'structure' },
	'create-plan': { name: 'rpi:plan', title: 'plan' },
	'iterate-plan': { name: 'rpi:plan', title: 'plan' },
	'setup-worktree': { name: 'rpi:worktree-setup', title: 'worktree-setup' },
	'implement-plan': { name: 'rpi:implementation', title: 'implementation' },
	'implement-outline': { name: 'rpi:implementation', title: 'implementation' },
	'iterate-implementation': { name: 'rpi:implementation', title: 'implementation' },
	'describe-pr': { name: 'rpi:describe-pr', title: 'describe-pr' },
}

// Map RPI skills to the Linear status they advance the linked issue into.
// Keyed off the BARE skill name (plugin prefix stripped) to match the
// `skillToLabel` convention above and share extraction via `extractSkillName`.
// Ported from the (now-retired) Claude Code client hook
// (claudecode/hooks/linear-advance-status-hook.ts). Skill-based advancement only —
// no document-write (`*-in-review`) path. `describe-pr` intentionally advances no status.
const SKILL_TO_STATUS: Record<RpiSkillName, string | undefined> = {
	'create-research-questions': 'questions-in-progress',
	'iterate-research-questions': 'questions-in-progress',
	'create-research': 'research-in-progress',
	'iterate-research': 'research-in-progress',
	'create-prd': undefined,
	'iterate-prd': undefined,
	'create-tdd': undefined,
	'iterate-tdd': undefined,
	'create-design-discussion': 'design-in-progress',
	'iterate-design-discussion': 'design-in-progress',
	'create-structure-outline': 'structure-in-progress',
	'iterate-structure-outline': 'structure-in-progress',
	'create-plan': 'plan-in-progress',
	'iterate-plan': 'plan-in-progress',
	'setup-worktree': 'in-dev',
	'implement-plan': 'in-dev',
	'implement-outline': 'in-dev',
	'iterate-implementation': 'in-dev',
	'describe-pr': undefined,
}

const EVENT_REPAIRABLE_SESSION_STATUSES: SessionStatus[] = [
	'lost',
	'waiting_for_usage_limit',
	'failed',
	'interrupted',
	'ready_for_input',
	'launching',
	'resuming',
]

function provesActiveExecution(eventType: string, role: string): boolean {
	return (
		(eventType === 'message' && role === 'assistant') ||
		(eventType === 'thinking' && role === 'assistant') ||
		(eventType === 'tool_call' && role === 'assistant') ||
		(eventType === 'tool_result' && role === 'user')
	)
}

/**
 * Extracts the normalized bare skill name from a Skill tool call.
 * Returns undefined if this isn't a Skill call or the skill name can't be parsed.
 * Shared by both the RPI label lookup and the Linear status-advance lookup so the
 * tool input is only parsed once.
 */
function extractSkillName(toolName: string | null | undefined, toolInputJson: unknown): RpiSkillName | undefined {
	const normalizedToolName = toolName?.toLowerCase()
	if (normalizedToolName !== 'skill' || !toolInputJson) {
		return undefined
	}

	try {
		// Handle both string and object inputs
		const rawToolInput: unknown = typeof toolInputJson === 'string' ? JSON.parse(toolInputJson) : toolInputJson
		const toolInput = Option.getOrUndefined(Schema.decodeUnknownOption(SkillToolInput)(rawToolInput))
		let skillName = toolInput?.skill ?? toolInput?.name
		if (!skillName) return undefined

		// Strip plugin prefix if present (e.g., "rpi:create-plan" -> "create-plan")
		if (skillName.includes(':')) {
			skillName = skillName.split(':').pop()
		}

		return Option.getOrUndefined(Schema.decodeUnknownOption(RpiSkillName)(skillName))
	} catch {
		// Invalid JSON - not an RPI skill
		return undefined
	}
}

/**
 * Create a conversation event for a session.
 *
 * Authorization:
 * - Daemon must be running this session (host_id check)
 * - User must have write permission on session (via task ACL or session ownership)
 */
export const createEventProcedure = daemonBase.sessions.events.create
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		// Parse the skill name ONCE before the transaction - parsing errors won't poison it.
		// Both the RPI label append and the Linear status-advance lookup reuse it.
		const skillName = extractSkillName(input.toolName, input.toolInputJson)
		const rpiLabel = skillName ? skillToLabel[skillName] : undefined
		const advanceStatus = skillName ? SKILL_TO_STATUS[skillName] : undefined
		const { userId, organizationId, hostId } = context.auth
		// Postgres rejects U+0000 in text and jsonb. Agents emit it when they read or write
		// code that mentions null bytes (see lib/strip-null-bytes.ts). Without this the insert
		// fails with 22P05, the daemon gets a 500, and the session dies (RIPTIDE-API-NE).
		const content = stripNullBytes(input.content)
		const toolInputJson = stripNullBytes(input.toolInputJson)
		const toolResultContent = stripNullBytes(input.toolResultContent)
		const { services } = context
		const { db } = services

		try {
			const txResult = await db.transaction(async (tx) => {
				// 1. Fetch session with auth-relevant fields
				const [session] = await tx
					.select({
						id: sessions.id,
						task_id: sessions.task_id,
						created_by: sessions.created_by,
						resource_owner_user_id: sessions.resource_owner_user_id,
						host_id: sessions.host_id,
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

				// Insert the event.
				//
				// CORE-1634: the daemon can re-send an insert with an `id` it already
				// persisted — the recovered-thinking replay re-inserts a streamed
				// thinking-block id, and the oRPC client's retry plugin can re-send a
				// write that already committed. Both hit `conversation_events_pkey`. Left
				// as a raw insert that raises a 500, the daemon turns it into a
				// session-fatal `status='failed'` (RIPTIDE-DAEMON-9A: 239 occ / 37 users).
				//
				// A pkey collision means "this exact event is already saved" (the replay
				// carries byte-identical content), so we make the insert idempotent:
				// ON CONFLICT (id) DO NOTHING, then short-circuit below. Note `id` defaults
				// to a fresh uuidv7 when the daemon sends none, so non-id-bearing inserts
				// never collide and are unaffected.
				const [event] = await tx
					.insert(conversationEvents)
					.values({
						id: input.eventId,
						session_id: input.sessionId,
						organization_id: context.auth.organizationId,
						resource_owner_user_id: session.resource_owner_user_id,
						task_id: session.task_id,
						coding_agent_session_id: input.codingAgentSessionId,
						coding_agent_event_id: input.codingAgentEventId,
						event_type: input.eventType,
						role: input.role,
						content,
						tool_call_id: input.toolCallId,
						tool_name: input.toolName,
						tool_input_json: toolInputJson,
						parent_tool_use_id: input.parentToolUseId,
						tool_result_for_id: input.toolResultForId,
						tool_result_content: toolResultContent,
						// Add token fields
						input_tokens: input.inputTokens,
						output_tokens: input.outputTokens,
					})
					.onConflictDoNothing({ target: conversationEvents.id })
					.returning()

				// Duplicate `id` → the event is already persisted (and its side effects —
				// num_events increment, session update, label append — already ran on the
				// first insert). Short-circuit idempotently: return the existing id + a
				// current txid, skipping the writes below so we don't double-count. A
				// collision is only possible when the daemon supplied `input.eventId`.
				if (!event) {
					const eventId = input.eventId
					if (!eventId) {
						throw new Error('duplicate conversation event has no eventId')
					}
					logger.info(
						{ sessionId: input.sessionId, eventId: input.eventId },
						'Duplicate conversation event id — idempotent no-op (CORE-1634)',
					)
					const txid = await getTxId(tx)
					return {
						eventId,
						txid,
						taskId: session.task_id,
						resourceOwnerUserId: session.resource_owner_user_id,
						duplicate: true,
					}
				}

				// Build session update fields. Re-read num_events inside the tx so the increment uses the
				// freshest value; a missing row (e.g. a concurrent delete) is a real error, not a silent crash.
				let nextNumEvents = 1
				if (session.id) {
					const [currentSession] = await tx
						.select({ num_events: sessions.num_events })
						.from(sessions)
						.where(eq(sessions.id, input.sessionId))
					if (!currentSession) {
						throw new Error(`Session ${input.sessionId} not found while incrementing num_events`)
					}
					nextNumEvents = currentSession.num_events + 1
				}
				const sessionUpdateFields: PgUpdateSetSource<typeof sessions> = {
					last_activity_at: BigInt(Date.now()),
					num_events: nextNumEvents,
				}
				if (provesActiveExecution(input.eventType, input.role)) {
					sessionUpdateFields.status = sql<SessionStatus>`CASE
						WHEN ${sessions.status} IN (${sql.join(
							EVENT_REPAIRABLE_SESSION_STATUSES.map((status) => sql`${status}`),
							sql`, `,
						)}) THEN 'running'
						ELSE ${sessions.status}
					END`
					sessionUpdateFields.error_message = sql<string | null>`CASE
						WHEN ${sessions.status} IN (${sql.join(
							EVENT_REPAIRABLE_SESSION_STATUSES.map((status) => sql`${status}`),
							sql`, `,
						)}) THEN NULL
						ELSE ${sessions.error_message}
					END`
				}

				// Update context window tokens if provided (only for top-level messages, not sub-agents)
				// Sub-agent messages have parentToolUseId set and have their own smaller token counts
				// which would incorrectly overwrite the session's context window
				if (input.inputTokens !== undefined && input.outputTokens !== undefined && !input.parentToolUseId) {
					sessionUpdateFields.context_window_tokens = input.inputTokens + input.outputTokens
				}

				await tx.update(sessions).set(sessionUpdateFields).where(eq(sessions.id, input.sessionId))

				// Append RPI label if detected (label was extracted before transaction started)
				// Drizzle double-serializes JSONB, so labels may be stored as a JSON string scalar.
				// Normalize with: CASE WHEN jsonb_typeof = 'string' THEN unwrap via #>> '{}' ELSE use as-is END
				if (rpiLabel) {
					logger.debug({ sessionId: input.sessionId, label: rpiLabel }, 'Appending RPI label to session')
					await tx.execute(sql`
					UPDATE sessions
					SET labels = CASE
						WHEN EXISTS (
							SELECT 1 FROM jsonb_array_elements(
								CASE WHEN jsonb_typeof(labels) = 'string' THEN (labels #>> '{}')::jsonb
								     ELSE COALESCE(labels, '[]'::jsonb) END
							) elem
							WHERE elem->>'name' = ${rpiLabel.name}
						)
						THEN CASE WHEN jsonb_typeof(labels) = 'string' THEN (labels #>> '{}')::jsonb ELSE labels END
						ELSE (CASE WHEN jsonb_typeof(labels) = 'string' THEN (labels #>> '{}')::jsonb
						           ELSE COALESCE(labels, '[]'::jsonb) END)
						     || jsonb_build_array(jsonb_build_object('name', ${rpiLabel.name}::text, 'title', ${rpiLabel.title}::text))
					END
					WHERE id = ${input.sessionId}
				`)
					logger.info({ sessionId: input.sessionId, label: rpiLabel }, 'RPI label appended to session')
				}

				const txid = await getTxId(tx)

				return {
					eventId: event.id,
					txid,
					taskId: session.task_id,
					resourceOwnerUserId: session.resource_owner_user_id,
					duplicate: false,
				}
			})

			// Fire-and-forget onboarding "implementation started" milestone. Only fires
			// when this event appended the implementation label (rpiLabel was extracted
			// before the transaction). The service no-ops for any other label, so this is
			// safe. Failures are swallowed to Sentry and never affect event persistence.
			if (!txResult.duplicate && rpiLabel?.name === 'rpi:implementation') {
				const onboardingSource = 'daemon.sessions.events.create'
				services.effectRuntime.runFork(
					Effect.gen(function* () {
						const onboarding = yield* OnboardingService
						yield* onboarding.recordImplementationStarted({
							userId: txResult.resourceOwnerUserId,
							sessionId: input.sessionId,
							taskId: txResult.taskId,
							label: rpiLabel,
							source: 'daemon_event_label',
						})
					}).pipe(
						Effect.catch((err) =>
							Effect.sync(() => {
								Sentry.captureException(err, {
									tags: { error_type: 'onboarding_detached_failure', source: onboardingSource },
									extra: {
										userId: txResult.resourceOwnerUserId,
										sessionId: input.sessionId,
										source: onboardingSource,
									},
								})
							}),
						),
					),
				)
			}

			// Best-effort Linear status advancement AFTER the transaction commits.
			// This must never affect event persistence, so it is fully swallowed.
			// Both agent harnesses (CodeLayer/Codex and Claude Code) funnel tool calls
			// through this procedure, so all of them advance Linear identically.
			if (!txResult.duplicate && advanceStatus && txResult.taskId) {
				await advanceLinearStatus(services, organizationId, txResult.taskId, advanceStatus)
			}

			return {
				eventId: txResult.eventId,
				transactionId: txResult.txid,
			}
		} catch (error: unknown) {
			logger.error(error, 'Failed to create event')
			throw error
		}
	})

/**
 * Best-effort advance of the Linear issue linked to a task into `advanceStatus`.
 *
 * Runs AFTER the event-create transaction commits, so any failure is swallowed
 * (logged at debug + reported to Sentry) and never propagates to event persistence.
 * Only fires when the task is linked to a Linear ticket. The shared
 * `linear.updateIssueStatus` service applies the existing `isMoreProgressed`
 * monotonic guard, so this can never move an issue backwards.
 */
async function advanceLinearStatus(
	services: Services,
	organizationId: string,
	taskId: string,
	advanceStatus: string,
): Promise<void> {
	try {
		const { db, linear } = services
		const [task] = await db
			.select({ ticketId: tasks.ticket_id, ticketProvider: tasks.ticket_provider })
			.from(tasks)
			.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
			.limit(1)

		const ticketId = task?.ticketId
		if (task?.ticketProvider !== 'linear' || !ticketId) {
			return
		}

		await linear.updateIssueStatus(organizationId, ticketId, advanceStatus)
		logger.info({ ticketId, advanceStatus }, 'Auto-advanced Linear issue status')
	} catch (error) {
		// The event already persisted — never propagate, but keep it visible.
		logger.debug({ error, taskId, advanceStatus }, 'Linear auto-advance failed (non-blocking)')
		Sentry.captureException(error, { tags: { error_type: 'linear_auto_advance_status' } })
	}
}
