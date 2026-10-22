import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { sessions, type SessionStatus } from '@humanlayer/db/tables/sessions'
import { and, asc, eq, ilike, inArray, isNotNull, like, lt, notExists, notInArray, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { Database } from './stale-daemons'

const BATCH_SIZE = 100
const MCP_EXEMPTION_MS = 20 * 60 * 1_000
const MAX_BASH_TIMEOUT_MS = 2_147_483_647
const MAX_LEGACY_FOLD_BASH_TIMEOUT_SECONDS = MAX_BASH_TIMEOUT_MS / 1_000

type LostSourceStatus = Extract<SessionStatus, 'running' | 'launching' | 'resuming' | 'interrupt_requested'>

export type LostSessionRule = {
	status: LostSourceStatus
	thresholdMs: number
	warning: string
}

export const LOST_SESSION_RULES: readonly LostSessionRule[] = [
	{
		status: 'running',
		thresholdMs: 10 * 60 * 1_000,
		warning:
			'This session is marked as running but has not sent an event in over 10 minutes. You can try resuming it by sending another message.',
	},
	{
		status: 'launching',
		thresholdMs: 2 * 60 * 1_000,
		warning:
			'This session has been launching without progress for over 2 minutes. You can try resuming it by sending another message.',
	},
	{
		status: 'resuming',
		thresholdMs: 60 * 1_000,
		warning:
			'This session has been resuming without progress for over 1 minute. You can try resuming it by sending another message.',
	},
	{
		status: 'interrupt_requested',
		thresholdMs: 30 * 1_000,
		warning:
			'This session has not acknowledged the interrupt request in over 30 seconds. You can try resuming it by sending another message.',
	},
]

type LostCandidate = {
	id: string
	hostId: string
	organizationId: string | null
	userId: string
	status: LostSourceStatus
	lastActivityAt: bigint
}

type LostCandidateWithCodingAgent = LostCandidate & {
	codingAgent: string
}

export type LostSessionTransition = LostCandidate & {
	thresholdMs: number
	activityAgeMs: bigint
	registrationStatus: 'online' | 'offline' | 'missing'
}

export type LostSessionBatchResult = {
	candidatesClaimed: number
	sessionsMarkedLost: number
	sessionsExemptedByOpenTools: number
	exemptedSessionIds: readonly string[]
	transitions: readonly LostSessionTransition[]
}

export type LostSessionReconciliationResult = {
	batchesCompleted: number
	sessionsMarkedLost: number
	sessionsExemptedByOpenTools: number
}

export type LostSessionBatchLog = {
	event: 'lost_session_batch_completed'
	candidatesClaimed: number
	sessionsMarkedLost: number
	sessionsExemptedByOpenTools: number
	transitions: readonly LostSessionTransition[]
}

export type LostSessionLogger = (entry: LostSessionBatchLog) => void

const defaultLogger: LostSessionLogger = (entry) => console.log(entry)

function isLostSourceStatus(status: SessionStatus): status is LostSourceStatus {
	return status === 'running' || status === 'launching' || status === 'resuming' || status === 'interrupt_requested'
}

function parseBashTimeoutMilliseconds(input: unknown, legacyTimeoutIsSeconds: boolean): number | undefined {
	if (typeof input === 'string') {
		try {
			return parseBashTimeoutMilliseconds(JSON.parse(input), legacyTimeoutIsSeconds)
		} catch {
			return undefined
		}
	}
	if (typeof input !== 'object' || input === null) {
		return undefined
	}
	if ('timeout_ms' in input) {
		const timeoutMilliseconds = input.timeout_ms
		if (
			typeof timeoutMilliseconds === 'number' &&
			Number.isFinite(timeoutMilliseconds) &&
			timeoutMilliseconds > 0 &&
			timeoutMilliseconds <= MAX_BASH_TIMEOUT_MS
		) {
			return timeoutMilliseconds
		}
		return undefined
	}
	if ('timeout' in input) {
		const legacyTimeout = input.timeout
		const maximum = legacyTimeoutIsSeconds ? MAX_LEGACY_FOLD_BASH_TIMEOUT_SECONDS : MAX_BASH_TIMEOUT_MS
		if (
			typeof legacyTimeout === 'number' &&
			Number.isFinite(legacyTimeout) &&
			legacyTimeout > 0 &&
			legacyTimeout <= maximum
		) {
			// Fold versions before timeout_ms declared timeout in seconds. Claude Code's Bash tool has
			// always declared the same legacy field in milliseconds.
			return legacyTimeoutIsSeconds ? legacyTimeout * 1_000 : legacyTimeout
		}
	}
	return undefined
}

function toolCallExemptsSession(
	call: {
		toolName: string | null
		toolInput: unknown
		createdAt: bigint
		codingAgent: string
	},
	now: bigint,
): boolean {
	const normalizedToolName = call.toolName?.toLowerCase()
	if (normalizedToolName === 'bash') {
		const timeoutMs = parseBashTimeoutMilliseconds(call.toolInput, call.codingAgent === 'fold')
		return timeoutMs !== undefined && call.createdAt + BigInt(Math.ceil(timeoutMs)) > now
	}
	if (call.toolName?.startsWith('mcp__')) {
		return call.createdAt + BigInt(MCP_EXEMPTION_MS) > now
	}
	return false
}

function candidateEligibilityCondition(now: bigint) {
	return or(
		...LOST_SESSION_RULES.map((rule) =>
			and(eq(sessions.status, rule.status), lt(sessions.last_activity_at, now - BigInt(rule.thresholdMs))),
		),
	)
}

async function findOpenToolExemptions(
	db: Parameters<Parameters<Database['transaction']>[0]>[0],
	candidates: readonly LostCandidateWithCodingAgent[],
	now: bigint,
): Promise<Set<string>> {
	const runningSessionIds = candidates.filter((candidate) => candidate.status === 'running').map(({ id }) => id)
	if (runningSessionIds.length === 0) {
		return new Set()
	}

	const results = alias(conversationEvents, 'tool_results')
	const unresolvedCalls = await db
		.select({
			sessionId: conversationEvents.session_id,
			toolName: conversationEvents.tool_name,
			toolInput: conversationEvents.tool_input_json,
			createdAt: conversationEvents.created_at,
		})
		.from(conversationEvents)
		.where(
			and(
				inArray(conversationEvents.session_id, runningSessionIds),
				eq(conversationEvents.event_type, 'tool_call'),
				isNotNull(conversationEvents.tool_call_id),
				or(ilike(conversationEvents.tool_name, 'bash'), like(conversationEvents.tool_name, 'mcp__%')),
				notExists(
					db
						.select({ id: results.id })
						.from(results)
						.where(
							and(
								eq(results.session_id, conversationEvents.session_id),
								eq(results.tool_result_for_id, conversationEvents.tool_call_id),
								isNotNull(results.tool_result_for_id),
							),
						),
				),
			),
		)

	const codingAgentsBySessionId = new Map(candidates.map(({ id, codingAgent }) => [id, codingAgent]))
	return new Set(
		unresolvedCalls
			.filter((call) =>
				toolCallExemptsSession(
					{ ...call, codingAgent: codingAgentsBySessionId.get(call.sessionId) ?? 'unknown' },
					now,
				),
			)
			.map((call) => call.sessionId),
	)
}

async function loadRegistrationStatuses(
	db: Parameters<Parameters<Database['transaction']>[0]>[0],
	transitions: readonly Omit<LostSessionTransition, 'registrationStatus'>[],
): Promise<Map<string, 'online' | 'offline'>> {
	if (transitions.length === 0) {
		return new Map()
	}
	const registrationConditions = transitions
		.filter((transition) => transition.organizationId !== null)
		.map((transition) =>
			and(
				eq(onlineHosts.host_id, transition.hostId),
				eq(onlineHosts.organization_id, transition.organizationId ?? ''),
				eq(onlineHosts.user_id, transition.userId),
			),
		)
	const registrationFilter = or(...registrationConditions)
	if (!registrationFilter) {
		return new Map()
	}
	const registrations = await db
		.select({
			hostId: onlineHosts.host_id,
			organizationId: onlineHosts.organization_id,
			userId: onlineHosts.user_id,
			status: onlineHosts.status,
		})
		.from(onlineHosts)
		.where(registrationFilter)

	return new Map(
		registrations.map((registration) => [
			`${registration.hostId}:${registration.organizationId}:${registration.userId}`,
			registration.status,
		]),
	)
}

export async function sweepLostSessionsBatch(
	db: Database,
	now: bigint,
	previouslyExemptedSessionIds: readonly string[] = [],
	logger: LostSessionLogger = defaultLogger,
): Promise<LostSessionBatchResult> {
	const result = await db.transaction(async (tx) => {
		const exclusion =
			previouslyExemptedSessionIds.length > 0
				? notInArray(sessions.id, [...previouslyExemptedSessionIds])
				: undefined
		const rows = await tx
			.select({
				id: sessions.id,
				hostId: sessions.host_id,
				organizationId: sessions.organization_id,
				userId: sessions.created_by,
				codingAgent: sessions.coding_agent,
				status: sessions.status,
				lastActivityAt: sessions.last_activity_at,
			})
			.from(sessions)
			.where(and(candidateEligibilityCondition(now), exclusion))
			.orderBy(asc(sessions.status), asc(sessions.last_activity_at), asc(sessions.id))
			.limit(BATCH_SIZE)
			.for('update', { skipLocked: true })

		const candidates: LostCandidateWithCodingAgent[] = rows.flatMap((row) =>
			isLostSourceStatus(row.status) ? [{ ...row, status: row.status }] : [],
		)
		if (candidates.length === 0) {
			return {
				candidatesClaimed: 0,
				sessionsMarkedLost: 0,
				sessionsExemptedByOpenTools: 0,
				exemptedSessionIds: [],
				transitions: [],
			}
		}

		const exemptedSessionIds = await findOpenToolExemptions(tx, candidates, now)
		const transitionRows: Omit<LostSessionTransition, 'registrationStatus'>[] = []

		for (const rule of LOST_SESSION_RULES) {
			const eligibleIds = candidates
				.filter((candidate) => candidate.status === rule.status && !exemptedSessionIds.has(candidate.id))
				.map(({ id }) => id)
			if (eligibleIds.length === 0) {
				continue
			}
			const cutoff = now - BigInt(rule.thresholdMs)
			const updated = await tx
				.update(sessions)
				.set({ status: 'lost', error_message: rule.warning, updated_at: now })
				.where(
					and(
						inArray(sessions.id, eligibleIds),
						eq(sessions.status, rule.status),
						lt(sessions.last_activity_at, cutoff),
					),
				)
				.returning({
					id: sessions.id,
					hostId: sessions.host_id,
					organizationId: sessions.organization_id,
					userId: sessions.created_by,
					lastActivityAt: sessions.last_activity_at,
				})

			transitionRows.push(
				...updated.map((row) => ({
					...row,
					status: rule.status,
					thresholdMs: rule.thresholdMs,
					activityAgeMs: now - row.lastActivityAt,
				})),
			)
		}

		const registrationStatuses = await loadRegistrationStatuses(tx, transitionRows)
		const transitions: LostSessionTransition[] = transitionRows.map((transition) => {
			const registrationStatus: LostSessionTransition['registrationStatus'] =
				transition.organizationId === null
					? 'missing'
					: (registrationStatuses.get(
							`${transition.hostId}:${transition.organizationId}:${transition.userId}`,
						) ?? 'missing')
			return { ...transition, registrationStatus }
		})

		return {
			candidatesClaimed: candidates.length,
			sessionsMarkedLost: transitions.length,
			sessionsExemptedByOpenTools: exemptedSessionIds.size,
			exemptedSessionIds: [...exemptedSessionIds],
			transitions,
		}
	})

	if (result.candidatesClaimed > 0) {
		logger({ event: 'lost_session_batch_completed', ...result })
	}
	return result
}

export async function reconcileLostSessions(
	db: Database,
	now: bigint,
	sweepBatch: typeof sweepLostSessionsBatch = sweepLostSessionsBatch,
	logger: LostSessionLogger = defaultLogger,
): Promise<LostSessionReconciliationResult> {
	let batchesCompleted = 0
	let sessionsMarkedLost = 0
	const exemptedSessionIds = new Set<string>()

	while (true) {
		const batch = await sweepBatch(db, now, [...exemptedSessionIds], logger)
		if (batch.candidatesClaimed === 0) {
			return {
				batchesCompleted,
				sessionsMarkedLost,
				sessionsExemptedByOpenTools: exemptedSessionIds.size,
			}
		}
		batchesCompleted += 1
		sessionsMarkedLost += batch.sessionsMarkedLost
		for (const sessionId of batch.exemptedSessionIds) {
			exemptedSessionIds.add(sessionId)
		}
	}
}
