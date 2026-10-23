import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import { ORPCError } from '@orpc/server'
import type { InferSelectModel } from 'drizzle-orm'
import { and, asc, eq } from 'drizzle-orm'

import { createSessionForLaunch } from '../../../db/create-session-for-launch'
import { getTxId } from '../../../db/get-tx-id'
import { validateHostOwnership } from '../../../db/host-auth'
import { checkSessionWritePermission } from '../../../db/task-auth'
import { tryEnsureSessionStreamHydrated } from '../../../effects/services/durable-streams/streams'
import { renderConversationTranscript } from '../../../lib/render-conversation-transcript'
import logger from '../../../logger'
import { type ApiContext, apiBaseOrgRequired, requiresBillingMiddleware } from '../../base'

type SessionRow = InferSelectModel<typeof sessions>
type DbTransaction = Parameters<Parameters<ApiContext['services']['db']['transaction']>[0]>[0]
type HandoffContext = ApiContext & { auth: NonNullable<ApiContext['auth']> & { organizationId: string } }
type HandoffErrors = {
	NOT_FOUND: (input: { data: { message: string } }) => ORPCError<string, unknown>
	FORBIDDEN: (input: { data: { message: string } }) => ORPCError<string, unknown>
	HANDOFF_FAILED: (input: { data: { message: string } }) => ORPCError<string, unknown>
	INTERNAL_SERVER_ERROR: (input: Record<string, never>) => ORPCError<string, unknown>
}
type HandoffInput = {
	id?: string
	eventId?: string
	sourceSessionId: string
	codingAgent: Extract<CodingAgent, 'claude' | 'codelayer'>
	provider: string
	model: string
	effort?: string | null
	fastMode?: boolean
	includeToolCalls: boolean
	title: string | null
}

const HANDOFF_ELIGIBLE_STATUSES = new Set(['ready_for_input', 'interrupted'])

function agentLabel(agent: string): string {
	if (agent === 'claude') return 'Claude Code'
	if (agent === 'codelayer') return 'Codex'
	return agent
}

async function validateSourceSession(
	tx: DbTransaction,
	input: HandoffInput,
	context: HandoffContext,
	errors: HandoffErrors,
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

	if (sourceSession.archived) {
		throw errors.HANDOFF_FAILED({
			data: { message: 'The session is archived. Unarchive it before handing off.' },
		})
	}

	if (!HANDOFF_ELIGIBLE_STATUSES.has(sourceSession.status)) {
		throw errors.HANDOFF_FAILED({
			data: { message: 'Interrupt the source session or wait for input before handing off' },
		})
	}

	return sourceSession
}

function handoffTitle(sourceTitle: string | null, codingAgent: string): string | null {
	if (!sourceTitle) return null
	return `${sourceTitle} (${agentLabel(codingAgent)})`
}

async function buildHandoffPrompt(
	tx: DbTransaction,
	sourceSession: SessionRow,
	includeToolCalls: boolean,
	errors: HandoffErrors,
): Promise<string> {
	const events = await tx
		.select({
			event_type: conversationEvents.event_type,
			role: conversationEvents.role,
			content: conversationEvents.content,
			tool_name: conversationEvents.tool_name,
			tool_input_json: conversationEvents.tool_input_json,
			tool_result_content: conversationEvents.tool_result_content,
		})
		.from(conversationEvents)
		.where(eq(conversationEvents.session_id, sourceSession.id))
		.orderBy(asc(conversationEvents.created_at), asc(conversationEvents.id))

	const transcript = renderConversationTranscript(events, { includeToolCalls })
	if (!transcript) {
		throw errors.HANDOFF_FAILED({ data: { message: 'The session has no conversation to hand off.' } })
	}
	const source = agentLabel(sourceSession.coding_agent)

	return [
		`This session was handed off from ${source}. The full prior conversation follows, in order. Continue the work from where it left off, in the same worktree.`,
		'',
		transcript,
	].join('\n')
}

async function runHandoffTransaction({
	input,
	context,
	errors,
}: {
	input: HandoffInput
	context: HandoffContext
	errors: HandoffErrors
}) {
	const txResult = await context.services.db.transaction(async (tx) => {
		const sourceSession = await validateSourceSession(tx, input, context, errors)
		const prompt = await buildHandoffPrompt(tx, sourceSession, input.includeToolCalls, errors)

		const session = await createSessionForLaunch(tx, {
			id: input.id,
			eventId: input.eventId,
			taskId: sourceSession.task_id,
			organizationId: context.auth.organizationId,
			resourceOwnerUserId: sourceSession.resource_owner_user_id,
			createdBy: context.auth.userId,
			title: input.title ?? handoffTitle(sourceSession.title, input.codingAgent),
			prompt,
			workingDirectory: sourceSession.working_directory,
			hostId: sourceSession.host_id,
			codingAgent: input.codingAgent,
			provider: input.provider,
			model: input.model,
			effort: input.effort ?? undefined,
			fastMode: input.fastMode ?? undefined,
			permissionsMode: sourceSession.permissions_mode,
			labels: sourceSession.labels ?? [],
			handoffSourceSessionId: sourceSession.id,
		})

		const txid = await getTxId(tx)
		return { txid, session }
	})

	logger.info(
		{ sourceSessionId: input.sourceSessionId, newSessionId: txResult.session.id, codingAgent: input.codingAgent },
		'Session handed off successfully',
	)

	await tryEnsureSessionStreamHydrated(
		txResult.session.id,
		context.services.db,
		{ organizationId: context.auth.organizationId, userId: context.auth.userId },
		'create',
	)

	return { transactionId: txResult.txid, session: txResult.session }
}

export const handoffSessionProcedure = apiBaseOrgRequired.sessions.handoff
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		try {
			return await runHandoffTransaction({ input, context, errors })
		} catch (error: unknown) {
			if (error instanceof ORPCError) throw error
			logger.error(error, 'Failed to hand off session')
			throw errors.INTERNAL_SERVER_ERROR({})
		}
	})
