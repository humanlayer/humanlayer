import { matchCodelayerAuthError } from '@humanlayer/ai/config'
import type { PermissionsMode, Session, SessionStatus } from '@humanlayer/db/tables/sessions'

import { CLAUDE_SIGN_IN_VARIANT } from '@/lib/coding-agent-setup'
import type { TaskRow } from '@/minimalist/lib/data'
import { AGENT_NAMES, agentOf, CODEX_SIGN_IN } from '@/minimalist/lib/models'
import { resolveSessionErrorReason } from '@/utils/session-error-messages'

// Labels from the ui-copy skill's session status table.
const LABELS: Record<SessionStatus, string> = {
	draft: 'Draft',
	ready_for_launch: 'Queued',
	waiting_for_workspace: 'Preparing workspace',
	launching: 'Starting',
	resuming: 'Starting',
	running: 'Running',
	ready_for_input: 'Idle',
	needs_approval: 'Needs approval',
	waiting_for_usage_limit: 'Waiting for usage limit',
	interrupt_requested: 'Interrupting',
	interrupted: 'Interrupted',
	failed: 'Failed',
	lost: 'Stalled',
}

export function statusLabel(status: SessionStatus): string {
	return LABELS[status] ?? status
}

/** What a screen reader hears when the open session changes state. */
export function statusAnnouncement(status: SessionStatus): string {
	switch (status) {
		case 'running':
		case 'launching':
		case 'resuming':
			return 'The agent is working'
		case 'ready_for_input':
			return 'The agent finished'
		case 'needs_approval':
			return 'The agent needs your approval'
		case 'failed':
			return 'The session failed'
		case 'lost':
			return 'The session stalled'
		default:
			return statusLabel(status)
	}
}

export type Attention = 'needs-you' | 'running' | 'failed' | 'idle'

function sessionAttention(status: SessionStatus): Attention {
	switch (status) {
		case 'needs_approval':
			return 'needs-you'
		case 'running':
		case 'launching':
		case 'resuming':
		case 'waiting_for_workspace':
		case 'ready_for_launch':
		case 'interrupt_requested':
			return 'running'
		case 'failed':
		case 'lost':
			return 'failed'
		default:
			return 'idle'
	}
}

const ATTENTION_RANK: Record<Attention, number> = { 'needs-you': 3, failed: 2, running: 1, idle: 0 }

/** A task shows the most urgent state among its sessions. */
export function rollupAttention(statuses: readonly SessionStatus[]): Attention {
	let best: Attention = 'idle'
	for (const status of statuses) {
		const attention = sessionAttention(status)
		if (ATTENTION_RANK[attention] > ATTENTION_RANK[best]) best = attention
	}
	return best
}

/** Whether a message sent now waits in the queue. The server queues for these, usage-limit waits included. */
export function isBusy(status: SessionStatus): boolean {
	return status === 'waiting_for_usage_limit' || sessionAttention(status) === 'running'
}

export type StopReason = {
	title: string
	detail: string
	/** What the agent reported, shown as is. */
	error?: string
	/** A command to run on the host, offered as a copy button. */
	command?: string
}

const CLAUDE_SIGN_IN = CLAUDE_SIGN_IN_VARIANT.setupCommands[0] ?? 'claude /login'

/**
 * Why a session stopped before it finished, and what gets it going again. A
 * message resumes a failed or stalled session, so most reasons end there.
 */
export function stopReason(
	session: Pick<Session, 'status' | 'error_message' | 'error_reason' | 'coding_agent'>,
	hostName: string,
): StopReason | null {
	if (session.status === 'lost') {
		return {
			title: 'The agent stopped responding',
			detail: 'It went quiet before it finished. Send a message to pick up where it left off.',
		}
	}
	if (session.status !== 'failed') return null
	const agent = agentOf(session.coding_agent)
	const reason = resolveSessionErrorReason(session.error_reason, session.error_message)
	const signedOut =
		agent === 'claude' ? reason === 'auth_required' : Boolean(matchCodelayerAuthError(session.error_message))
	if (signedOut) {
		const command = agent === 'claude' ? CLAUDE_SIGN_IN : CODEX_SIGN_IN
		return {
			title: `${agent === 'claude' ? 'Claude' : 'Codex'} is signed out on ${hostName}`,
			detail: `Run ${command} on ${hostName}, then send a message to try again.`,
			command,
		}
	}
	if (reason === 'start_failed') {
		return {
			title: `${AGENT_NAMES[agent]} could not start`,
			detail: `Update ${AGENT_NAMES[agent]} on ${hostName}, then start a new session.`,
		}
	}
	return {
		title: 'The agent stopped with an error',
		detail: 'Send a message to try again.',
		error: session.error_message ?? undefined,
	}
}

export const PERMISSION_MODES: ReadonlyArray<{ value: PermissionsMode; label: string; description: string }> = [
	{ value: 'default', label: 'Ask first', description: 'Ask before edits and commands' },
	{ value: 'accept_edits', label: 'Auto-accept edits', description: 'Edits apply, commands ask' },
	{ value: 'auto', label: 'Auto', description: 'Ask only for risky actions' },
	{
		value: 'bypass',
		label: 'Bypass permissions',
		description: 'The agent edits files, runs commands and calls tools without asking',
	},
]

export function permissionLabel(mode: string): string {
	return PERMISSION_MODES.find((entry) => entry.value === mode)?.label ?? 'Ask first'
}

/** What the row's mark means, for screen readers; nothing when it shows only a phase or age. */
export function statusText(row: TaskRow, unread: boolean) {
	if (row.attention === 'running') return 'Running'
	if (row.attention === 'needs-you') return 'Needs you'
	if (row.attention === 'failed') return 'Failed'
	return unread ? 'Unread' : null
}
