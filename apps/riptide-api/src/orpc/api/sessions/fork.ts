import { codelayerAgentStateSnapshots } from '@humanlayer/db/tables/codelayer-agent-state-snapshots'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { foldSessionEvents } from '@humanlayer/db/tables/fold-session-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { decodeStoredLogEntry, SessionId, type LogEntry } from '@humanlayer/fold-core'
import {
	CodelayerForkMetadataSchema,
	FoldForkMetadataSchema,
	LegacyClaudeForkMetadataSchema,
} from '@humanlayer/riptide-api-contract/api/sessions/fork'
import type { LaunchableCodingAgent } from '@humanlayer/schemas/coding-agent'
import { ORPCError } from '@orpc/server'
import type { InferSelectModel } from 'drizzle-orm'
import { and, asc, desc, eq, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import { Effect, Match, Predicate, Schema } from 'effect'
import { uuidv7 } from 'uuidv7'

import { createSessionForLaunch } from '../../../db/create-session-for-launch'
import { getTxId } from '../../../db/get-tx-id'
import { validateHostOwnership } from '../../../db/host-auth'
import { checkSessionWritePermission } from '../../../db/task-auth'
import { tryEnsureSessionStreamHydrated } from '../../../effects/services/durable-streams/streams'
import { Sentry } from '../../../instrument'
import logger from '../../../logger'
import { type ApiContext, apiBaseOrgRequired, requiresBillingMiddleware } from '../../base'

type SessionRow = InferSelectModel<typeof sessions>
type ConversationEventRow = InferSelectModel<typeof conversationEvents>
type SnapshotRow = InferSelectModel<typeof codelayerAgentStateSnapshots>
type FoldSessionEventRow = InferSelectModel<typeof foldSessionEvents>
type DbTransaction = Parameters<Parameters<ApiContext['services']['db']['transaction']>[0]>[0]
type ForkErrors = {
	NOT_FOUND: (input: { data: { message: string } }) => ORPCError<string, unknown>
	FORBIDDEN: (input: { data: { message: string } }) => ORPCError<string, unknown>
	FORK_FAILED: (input: { data: { message: string } }) => ORPCError<string, unknown>
	INTERNAL_SERVER_ERROR: (input: Record<string, never>) => ORPCError<string, unknown>
}
type ForkInput = {
	id?: string
	eventId?: string
	sourceSessionId: string
	forkAtEventId: string
	text: string
	title: string | null
	archiveSource: boolean
}
type ForkContext = ApiContext & { auth: NonNullable<ApiContext['auth']> & { organizationId: string } }

const FORK_COPY_INSERT_BATCH_SIZE = 1000

const isSessionStartedEntry = Predicate.isTagged('session_started')

function getForkFailureMessage(error: ORPCError<string, unknown>): string {
	const data = error.data
	if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
		return data.message
	}
	return error.message
}

function captureForkFailedError({
	error,
	input,
	context,
	codingAgent,
}: {
	error: ORPCError<string, unknown>
	input: ForkInput
	context: ForkContext
	codingAgent: LaunchableCodingAgent
}) {
	if (error.code !== 'FORK_FAILED') return

	Sentry.captureException(error, {
		tags: {
			error_type: 'session_fork_failed',
			coding_agent: codingAgent,
			orpc_error_code: error.code,
		},
		contexts: {
			fork: {
				failure_message: getForkFailureMessage(error),
				source_session_id: input.sourceSessionId,
				fork_at_event_id: input.forkAtEventId,
				requested_session_id: input.id ?? null,
				requested_event_id: input.eventId ?? null,
				archive_source: input.archiveSource,
				organization_id: context.auth.organizationId,
				user_id: context.auth.userId,
			},
		},
	})
}

function escapeLike(str: string): string {
	return str.replace(/%/g, '\\%').replace(/_/g, '\\_')
}

async function buildForkTitle(tx: DbTransaction, organizationId: string, sourceTitle: string | null): Promise<string> {
	const rawBase = (sourceTitle ?? '').replace(/\s*\(fork(?:\s+\d+)?\)$/, '')
	const baseTitle = rawBase.trim()
	const escapedBase = escapeLike(baseTitle)
	const pattern = baseTitle ? `${escapedBase} (fork %)` : '(fork %)'
	const legacyPattern = baseTitle ? `${escapedBase} (fork)` : '(fork)'

	const existingForks = await tx
		.select({ title: sessions.title })
		.from(sessions)
		.where(
			and(
				eq(sessions.organization_id, organizationId),
				or(like(sessions.title, pattern), eq(sessions.title, legacyPattern)),
			),
		)

	let maxN = 0
	const numberedPattern = /\(fork\s+(\d+)\)$/
	for (const row of existingForks) {
		if (!row.title) continue
		const match = row.title.match(numberedPattern)
		const forkNum = match?.[1]
		if (forkNum !== undefined) {
			maxN = Math.max(maxN, Number.parseInt(forkNum, 10))
		} else if (row.title === legacyPattern || row.title.endsWith(' (fork)')) {
			maxN = Math.max(maxN, 1)
		}
	}

	return baseTitle ? `${baseTitle} (fork ${maxN + 1})` : `(fork ${maxN + 1})`
}

async function validateSourceSession(
	tx: DbTransaction,
	input: ForkInput,
	context: ForkContext,
	errors: ForkErrors,
): Promise<SessionRow> {
	const [sourceSessionTask] = await tx
		.select({ taskId: sessions.task_id })
		.from(sessions)
		.where(and(eq(sessions.id, input.sourceSessionId), eq(sessions.organization_id, context.auth.organizationId)))
		.limit(1)

	if (sourceSessionTask?.taskId) {
		await tx
			.select({ id: tasks.id })
			.from(tasks)
			.where(and(eq(tasks.id, sourceSessionTask.taskId), eq(tasks.organization_id, context.auth.organizationId)))
			.limit(1)
			.for('no key update')
	}

	const [sourceSession] = await tx
		.select()
		.from(sessions)
		.where(and(eq(sessions.id, input.sourceSessionId), eq(sessions.organization_id, context.auth.organizationId)))
		.for('no key update')

	if (!sourceSession) {
		throw errors.NOT_FOUND({ data: { message: 'Source session not found' } })
	}

	const writeCheck = await checkSessionWritePermission(
		tx,
		sourceSession,
		context.auth.userId,
		context.auth.organizationId,
	)
	if (!writeCheck.ok) {
		if (writeCheck.reason === 'not_found') {
			throw errors.NOT_FOUND({ data: { message: 'Source session not found' } })
		}
		throw errors.FORBIDDEN({ data: { message: 'Write permission required on source session' } })
	}

	const hostValid = await validateHostOwnership(
		tx,
		sourceSession.host_id,
		context.auth.userId,
		context.auth.organizationId,
	)
	if (!hostValid) {
		throw errors.FORBIDDEN({ data: { message: 'Host not found or not owned by user' } })
	}

	return sourceSession
}

async function getForkAtUserEvent(
	tx: DbTransaction,
	input: ForkInput,
	errors: ForkErrors,
): Promise<ConversationEventRow> {
	const [forkAtEvent] = await tx
		.select()
		.from(conversationEvents)
		.where(
			and(
				eq(conversationEvents.id, input.forkAtEventId),
				eq(conversationEvents.session_id, input.sourceSessionId),
				eq(conversationEvents.role, 'user'),
			),
		)

	if (!forkAtEvent) {
		throw errors.FORK_FAILED({
			data: { message: 'Fork point event not found or is not a user message in the source session' },
		})
	}

	return forkAtEvent
}

async function copyConversationBeforeFork(
	tx: DbTransaction,
	sourceSessionId: string,
	childSessionId: string,
	childResourceOwnerUserId: string,
	forkAtEvent: ConversationEventRow,
): Promise<Map<string, string>> {
	const sourceEvents = await tx
		.select()
		.from(conversationEvents)
		.where(
			and(
				eq(conversationEvents.session_id, sourceSessionId),
				lt(conversationEvents.created_at, forkAtEvent.created_at),
			),
		)
		.orderBy(asc(conversationEvents.created_at), asc(conversationEvents.id))

	const sourceEventIdToChildEventId = new Map<string, string>()
	if (sourceEvents.length === 0) return sourceEventIdToChildEventId

	const copiedEvents = sourceEvents.map((event) => {
		const childEventId = uuidv7()
		sourceEventIdToChildEventId.set(event.id, childEventId)
		return {
			id: childEventId,
			coding_agent_event_id: event.coding_agent_event_id,
			session_id: childSessionId,
			organization_id: event.organization_id,
			resource_owner_user_id: childResourceOwnerUserId,
			task_id: event.task_id,
			coding_agent_session_id: event.coding_agent_session_id,
			event_type: event.event_type,
			role: event.role,
			content: event.content,
			tool_call_id: event.tool_call_id,
			tool_name: event.tool_name,
			tool_input_json: event.tool_input_json,
			parent_tool_use_id: event.parent_tool_use_id,
			tool_result_for_id: event.tool_result_for_id,
			tool_result_content: event.tool_result_content,
			approval_status: null,
			approval_id: null,
			user_id: event.user_id,
			user_name: event.user_name,
			next_step_suggestion: event.next_step_suggestion,
			input_tokens: event.input_tokens,
			output_tokens: event.output_tokens,
			run_index: event.run_index,
			created_at: event.created_at,
			updated_at: event.updated_at,
		}
	})
	for (let i = 0; i < copiedEvents.length; i += FORK_COPY_INSERT_BATCH_SIZE) {
		await tx.insert(conversationEvents).values(copiedEvents.slice(i, i + FORK_COPY_INSERT_BATCH_SIZE))
	}
	return sourceEventIdToChildEventId
}

async function createForkedSession(
	tx: DbTransaction,
	input: ForkInput,
	context: ForkContext,
	sourceSession: SessionRow,
	forkMetadata: unknown,
): Promise<SessionRow> {
	return createSessionForLaunch(tx, {
		id: input.id,
		eventId: input.eventId,
		taskId: sourceSession.task_id,
		organizationId: context.auth.organizationId,
		resourceOwnerUserId: sourceSession.resource_owner_user_id,
		createdBy: context.auth.userId,
		title: input.title ?? (await buildForkTitle(tx, context.auth.organizationId, sourceSession.title)),
		prompt: input.text,
		workingDirectory: sourceSession.working_directory,
		hostId: sourceSession.host_id,
		codingAgent: sourceSession.coding_agent,
		provider: sourceSession.provider ?? 'anthropic',
		model: sourceSession.model ?? 'opus',
		effort: sourceSession.effort ?? undefined,
		fastMode: sourceSession.fast_mode ?? undefined,
		permissionsMode: sourceSession.permissions_mode,
		labels: sourceSession.labels ?? [],
		forkedFromSessionId: input.sourceSessionId,
		forkData: { fork: forkMetadata },
	})
}

async function forkClaudeSession(
	tx: DbTransaction,
	input: ForkInput,
	context: ForkContext,
	errors: ForkErrors,
	sourceSession: SessionRow,
	forkAtEvent: ConversationEventRow,
): Promise<SessionRow> {
	const [precedingEvent] = await tx
		.select({ coding_agent_event_id: conversationEvents.coding_agent_event_id })
		.from(conversationEvents)
		.where(
			and(
				eq(conversationEvents.session_id, input.sourceSessionId),
				lt(conversationEvents.created_at, forkAtEvent.created_at),
				isNotNull(conversationEvents.coding_agent_event_id),
			),
		)
		.orderBy(desc(conversationEvents.created_at), desc(conversationEvents.id))
		.limit(1)

	if (!precedingEvent?.coding_agent_event_id) {
		throw errors.FORK_FAILED({
			data: { message: 'Cannot fork: no preceding message with a coding agent event ID found' },
		})
	}
	if (!sourceSession.coding_agent_session_id) {
		throw errors.FORK_FAILED({ data: { message: 'Cannot fork: source session has no coding agent session ID' } })
	}

	const forkMetadata = LegacyClaudeForkMetadataSchema.parse({
		forkFromCodingAgentSessionId: sourceSession.coding_agent_session_id,
		forkAtCodingAgentEventId: precedingEvent.coding_agent_event_id,
	})
	const session = await createForkedSession(tx, input, context, sourceSession, forkMetadata)
	await copyConversationBeforeFork(tx, input.sourceSessionId, session.id, session.resource_owner_user_id, forkAtEvent)
	return session
}

async function forkCodelayerSession(
	tx: DbTransaction,
	input: ForkInput,
	context: ForkContext,
	errors: ForkErrors,
	sourceSession: SessionRow,
	forkAtEvent: ConversationEventRow,
): Promise<SessionRow> {
	if (forkAtEvent.run_index === null || forkAtEvent.run_index === undefined) {
		throw errors.FORK_FAILED({
			data: { message: 'Cannot fork CodeLayer session: selected event has no run index' },
		})
	}
	if (forkAtEvent.run_index <= 0) {
		throw errors.FORK_FAILED({ data: { message: 'Cannot fork CodeLayer session from the first user turn' } })
	}

	const sourceSnapshotRunIndex = forkAtEvent.run_index - 1
	const sourceSnapshots = await tx
		.select()
		.from(codelayerAgentStateSnapshots)
		.where(
			and(
				eq(codelayerAgentStateSnapshots.session_id, input.sourceSessionId),
				lte(codelayerAgentStateSnapshots.run_index, sourceSnapshotRunIndex),
				isNotNull(codelayerAgentStateSnapshots.state),
				isNull(codelayerAgentStateSnapshots.tombstoned_at),
			),
		)
		.orderBy(asc(codelayerAgentStateSnapshots.run_index))

	if (sourceSnapshots.length !== sourceSnapshotRunIndex + 1) {
		throw errors.FORK_FAILED({
			data: { message: 'Cannot fork CodeLayer session: required snapshot history is missing or expired' },
		})
	}

	const forkMetadata = CodelayerForkMetadataSchema.parse({
		agent: 'codelayer',
		sourceSessionId: input.sourceSessionId,
		forkAtEventId: input.forkAtEventId,
		forkAtRunIndex: forkAtEvent.run_index,
		sourceSnapshotRunIndex,
	})
	const session = await createForkedSession(tx, input, context, sourceSession, forkMetadata)
	const sourceEventIdToChildEventId = await copyConversationBeforeFork(
		tx,
		input.sourceSessionId,
		session.id,
		session.resource_owner_user_id,
		forkAtEvent,
	)
	await copyCodelayerSnapshots(
		tx,
		context.auth.organizationId,
		sourceSession,
		session,
		sourceSnapshots,
		sourceEventIdToChildEventId,
	)
	return session
}

async function copyCodelayerSnapshots(
	tx: DbTransaction,
	organizationId: string,
	sourceSession: SessionRow,
	childSession: SessionRow,
	sourceSnapshots: SnapshotRow[],
	sourceEventIdToChildEventId: Map<string, string>,
): Promise<void> {
	if (sourceSnapshots.length === 0) return
	const copiedSnapshots = sourceSnapshots.map((snapshot) => ({
		session_id: childSession.id,
		organization_id: organizationId,
		resource_owner_user_id: childSession.resource_owner_user_id,
		task_id: childSession.task_id,
		run_index: snapshot.run_index,
		root_user_event_id: snapshot.root_user_event_id
			? (sourceEventIdToChildEventId.get(snapshot.root_user_event_id) ?? null)
			: null,
		copied_from_snapshot_id: snapshot.id,
		state: snapshot.state,
		tombstoned_at: null,
		tombstone_reason: null,
		created_at: snapshot.created_at,
		updated_at: snapshot.updated_at,
	}))

	for (let i = 0; i < copiedSnapshots.length; i += FORK_COPY_INSERT_BATCH_SIZE) {
		await tx.insert(codelayerAgentStateSnapshots).values(copiedSnapshots.slice(i, i + FORK_COPY_INSERT_BATCH_SIZE))
	}
}

function decodeFoldEntriesForFork(
	rows: ReadonlyArray<FoldSessionEventRow>,
	errors: ForkErrors,
): ReadonlyArray<LogEntry> {
	try {
		return Effect.runSync(
			Effect.forEach(rows, (row) =>
				Schema.decodeUnknownEffect(Schema.Json)(row.event).pipe(Effect.flatMap(decodeStoredLogEntry)),
			),
		)
	} catch {
		throw errors.FORK_FAILED({
			data: { message: 'Cannot fork Fold session: source event log contains an invalid entry' },
		})
	}
}

async function copyFoldSessionEvents(
	tx: DbTransaction,
	childSessionId: string,
	childFoldSessionId: SessionId,
	sourceRows: ReadonlyArray<FoldSessionEventRow>,
	errors: ForkErrors,
): Promise<void> {
	const sourceEntries = decodeFoldEntriesForFork(sourceRows, errors)
	const sessionStartedEntries = sourceEntries.filter(isSessionStartedEntry)
	const sessionStarted = sessionStartedEntries[0]
	if (sessionStartedEntries.length !== 1 || sessionStarted?.seq !== 0) {
		throw errors.FORK_FAILED({
			data: { message: 'Cannot fork Fold session: source event log has an invalid session boundary' },
		})
	}

	const copiedEntries = sourceEntries.map((entry) =>
		isSessionStartedEntry(entry) ? { ...entry, sessionId: childFoldSessionId } : entry,
	)
	decodeFoldEntriesForFork(
		copiedEntries.map((event) => ({
			session_id: childSessionId,
			seq: event.seq,
			event_id: event.eventId,
			ts: event.ts,
			event,
		})),
		errors,
	)

	const copiedRows = copiedEntries.map((event) => ({
		session_id: childSessionId,
		seq: event.seq,
		event_id: event.eventId,
		ts: event.ts,
		event,
	}))
	for (let index = 0; index < copiedRows.length; index += FORK_COPY_INSERT_BATCH_SIZE) {
		await tx.insert(foldSessionEvents).values(copiedRows.slice(index, index + FORK_COPY_INSERT_BATCH_SIZE))
	}
}

async function forkFoldSession(
	tx: DbTransaction,
	input: ForkInput,
	context: ForkContext,
	errors: ForkErrors,
	sourceSession: SessionRow,
	forkAtEvent: ConversationEventRow,
): Promise<SessionRow> {
	const [precedingEvent] = await tx
		.select({ codingAgentEventId: conversationEvents.coding_agent_event_id })
		.from(conversationEvents)
		.where(
			and(
				eq(conversationEvents.session_id, input.sourceSessionId),
				lt(conversationEvents.created_at, forkAtEvent.created_at),
				isNotNull(conversationEvents.coding_agent_event_id),
			),
		)
		.orderBy(desc(conversationEvents.created_at), desc(conversationEvents.id))
		.limit(1)

	if (precedingEvent?.codingAgentEventId === undefined || precedingEvent.codingAgentEventId === null) {
		throw errors.FORK_FAILED({
			data: { message: 'Cannot fork Fold session: no preceding projected Fold event was found' },
		})
	}

	const [cutoffRow] = await tx
		.select()
		.from(foldSessionEvents)
		.where(
			and(
				eq(foldSessionEvents.session_id, input.sourceSessionId),
				eq(foldSessionEvents.event_id, precedingEvent.codingAgentEventId),
			),
		)
		.limit(1)
	if (cutoffRow === undefined) {
		throw errors.FORK_FAILED({
			data: { message: 'Cannot fork Fold session: the projected event is missing from the source Fold log' },
		})
	}

	const sourceRows = await tx
		.select()
		.from(foldSessionEvents)
		.where(and(eq(foldSessionEvents.session_id, input.sourceSessionId), lte(foldSessionEvents.seq, cutoffRow.seq)))
		.orderBy(asc(foldSessionEvents.seq))
	if (sourceRows.at(-1)?.event_id !== cutoffRow.event_id) {
		throw errors.FORK_FAILED({
			data: { message: 'Cannot fork Fold session: source event log does not end at the fork point' },
		})
	}

	const childFoldSessionId = SessionId.create()
	const forkMetadata = FoldForkMetadataSchema.parse({
		agent: 'fold',
		sourceSessionId: input.sourceSessionId,
		forkAtEventId: input.forkAtEventId,
		sourceFoldEventId: cutoffRow.event_id,
		sourceFoldSeq: cutoffRow.seq,
		childFoldSessionId,
	})
	const createdSession = await createForkedSession(tx, input, context, sourceSession, forkMetadata)
	const [session] = await tx
		.update(sessions)
		.set({ coding_agent_session_id: childFoldSessionId })
		.where(eq(sessions.id, createdSession.id))
		.returning()
	if (session === undefined) throw new Error('Failed to assign the child Fold session identity')

	await copyConversationBeforeFork(tx, input.sourceSessionId, session.id, session.resource_owner_user_id, forkAtEvent)
	await copyFoldSessionEvents(tx, session.id, childFoldSessionId, sourceRows, errors)
	return session
}

async function runForkTransaction({
	input,
	context,
	errors,
	codingAgent,
}: {
	input: ForkInput
	context: ForkContext
	errors: ForkErrors
	codingAgent: LaunchableCodingAgent
}) {
	let txResult: { txid: string; session: SessionRow }
	try {
		txResult = await context.services.db.transaction(async (tx) => {
			const sourceSession = await validateSourceSession(tx, input, context, errors)
			if (sourceSession.coding_agent !== codingAgent) {
				throw errors.FORK_FAILED({
					data: {
						message: `Source session coding agent is ${sourceSession.coding_agent}, not ${codingAgent}`,
					},
				})
			}

			const forkAtEvent = await getForkAtUserEvent(tx, input, errors)
			const session = await Match.value(codingAgent).pipe(
				Match.when('claude', () => forkClaudeSession(tx, input, context, errors, sourceSession, forkAtEvent)),
				Match.when('codelayer', () =>
					forkCodelayerSession(tx, input, context, errors, sourceSession, forkAtEvent),
				),
				Match.when('fold', () => forkFoldSession(tx, input, context, errors, sourceSession, forkAtEvent)),
				Match.exhaustive,
			)

			if (input.archiveSource) {
				await tx.update(sessions).set({ archived: true }).where(eq(sessions.id, input.sourceSessionId))
			}

			const txid = await getTxId(tx)
			return { txid, session }
		})
	} catch (error: unknown) {
		if (error instanceof ORPCError) {
			captureForkFailedError({ error, input, context, codingAgent })
		}
		throw error
	}

	logger.info(
		{
			sourceSessionId: input.sourceSessionId,
			newSessionId: txResult.session.id,
			archiveSource: input.archiveSource,
		},
		'Session forked successfully',
	)

	await tryEnsureSessionStreamHydrated(
		txResult.session.id,
		context.services.db,
		{ organizationId: context.auth.organizationId, userId: context.auth.userId },
		'fork',
	)

	return { transactionId: txResult.txid, session: txResult.session }
}

export const forkSessionProcedure = apiBaseOrgRequired.sessions.fork
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		try {
			return await runForkTransaction({ input, context, errors, codingAgent: 'claude' })
		} catch (error: unknown) {
			if (error instanceof ORPCError) throw error
			logger.error(error, 'Failed to fork session')
			throw errors.INTERNAL_SERVER_ERROR({})
		}
	})

export const forkSessionV2Procedure = apiBaseOrgRequired.sessions.v2.fork
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		try {
			const { codingAgent, ...forkInput } = input
			return await runForkTransaction({ input: forkInput, context, errors, codingAgent })
		} catch (error: unknown) {
			if (error instanceof ORPCError) throw error
			logger.error(error, 'Failed to fork session')
			throw errors.INTERNAL_SERVER_ERROR({})
		}
	})
