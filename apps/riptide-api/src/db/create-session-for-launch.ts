import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

interface CreateSessionForLaunchParams {
	id?: string
	eventId?: string
	taskId: string | null
	organizationId: string
	resourceOwnerUserId: string
	createdBy: string
	title: string | null
	prompt: string
	workingDirectory: string
	hostId: string
	codingAgent: CodingAgent
	provider: string
	model: string
	effort?: string
	fastMode?: boolean
	permissionsMode: string
	labels?: Array<{ name: string; title: string }>
	forkedFromSessionId?: string
	forkData?: Record<string, unknown>
	handoffSourceSessionId?: string
}

/**
 * Shared function for creating a ready-for-launch session with an initial user message.
 * No auth checks — callers handle authorization.
 * Used by both manual launch (launch.ts) and auto-advance (check-auto-advance.ts).
 */
export async function createSessionForLaunch(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	params: CreateSessionForLaunchParams,
) {
	const sessionValues: typeof sessions.$inferInsert = {
		task_id: params.taskId,
		forked_from_session_id: params.forkedFromSessionId ?? null,
		handoff_source_session_id: params.handoffSourceSessionId ?? null,
		status: 'ready_for_launch' as const,
		title: params.title,
		organization_id: params.organizationId,
		prompt: params.prompt,
		fork_data: params.forkData ?? null,
		coding_agent: params.codingAgent,
		provider: params.provider,
		model: params.model,
		effort: params.effort ?? null,
		fast_mode: params.fastMode ?? false,
		working_directory: params.workingDirectory.trim(),
		host_id: params.hostId,
		permissions_mode: params.permissionsMode as 'accept_edits' | 'bypass' | 'default',
		created_by: params.createdBy,
		resource_owner_user_id: params.resourceOwnerUserId,
		num_events: 1,
	}
	if (params.id) sessionValues.id = params.id
	if (params.labels) sessionValues.labels = params.labels
	const [session] = await tx.insert(sessions).values(sessionValues).returning()

	if (!session) {
		throw new Error('Failed to create session')
	}

	const conversationEventValues: typeof conversationEvents.$inferInsert = {
		session_id: session.id,
		organization_id: params.organizationId,
		resource_owner_user_id: params.resourceOwnerUserId,
		task_id: params.taskId,
		event_type: 'message',
		role: 'user',
		content: params.prompt,
		user_id: params.createdBy,
	}
	if (params.eventId) conversationEventValues.id = params.eventId
	await tx.insert(conversationEvents).values(conversationEventValues)

	return session
}
