import type { Session } from '@humanlayer/db/tables/sessions'

import type { SessionChangeMessage } from '../../src/collections/types'

export function createTestSession(overrides: Partial<Session> = {}): Session {
	const now = BigInt(Date.now())

	return {
		id: '00000000-0000-4000-8000-000000000001',
		task_id: null,
		organization_id: '00000000-0000-4000-8000-000000000002',
		forked_from_session_id: null,
		handoff_source_session_id: null,
		created_by: 'user-1',
		resource_owner_user_id: 'user-1',
		coding_agent: 'claude',
		coding_agent_session_id: 'test-coding-agent-session-id',
		host_id: 'test-host-id',
		working_directory: '/tmp',
		model: 'haiku',
		provider: 'anthropic',
		effort: null,
		fast_mode: false,
		title: null,
		summary: null,
		structured_summary: null,
		status: 'running',
		created_at: now,
		updated_at: now,
		last_activity_at: now,
		num_events: 0,
		context_window_tokens: 0,
		context_window_limit: 168000,
		is_compacting: false,
		total_cost_usd: null,
		model_usage: null,
		applied_usage_report_keys: null,
		error_message: null,
		error_reason: null,
		permissions_mode: 'bypass',
		multiplayer_prompting_user_ids: [],
		multiplayer_prompting_started_at: null,
		multiplayer_prompting_expires_at: null,
		archived: false,
		fork_data: null,
		workflow_type: null,
		prompt: 'test prompt',
		labels: [],
		next_step_suggestions: null,
		resolved_model: null,
		...overrides,
	} as Session
}

type SessionChangeOverrides = {
	type: 'insert' | 'update' | 'delete'
	value: Partial<Session> & Pick<Session, 'id' | 'status'>
	previousValue?: Partial<Session>
}

export function makeSessionChange(overrides: SessionChangeOverrides): SessionChangeMessage {
	const value = createTestSession(overrides.value)
	const previousValue = overrides.previousValue
		? createTestSession({ ...value, ...overrides.previousValue })
		: overrides.type === 'update'
			? createTestSession({ ...value, status: 'draft' })
			: undefined

	return {
		type: overrides.type,
		key: value.id,
		value: withVirtualProps(value),
		previousValue: previousValue ? withVirtualProps(previousValue) : undefined,
	} as SessionChangeMessage
}

function withVirtualProps(session: Session) {
	return {
		...session,
		$synced: true,
		$origin: 'remote' as const,
		$key: session.id,
		$collectionId: 'test-collection',
	}
}
