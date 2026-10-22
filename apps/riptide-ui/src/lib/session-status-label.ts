import type { SessionStatus } from '@humanlayer/schemas/effect/session/session-status'

import type { SessionHostState } from '@/lib/session-host-state'

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
	draft: 'Draft',
	ready_for_launch: 'Queued',
	waiting_for_workspace: 'Preparing workspace',
	launching: 'Starting',
	resuming: 'Starting',
	running: 'Running',
	ready_for_input: 'Idle',
	needs_approval: 'Needs approval',
	waiting_for_usage_limit: 'Usage limit reached',
	interrupt_requested: 'Interrupting',
	interrupted: 'Interrupted',
	failed: 'Failed',
	lost: 'Stalled',
}

export interface SessionStatusHost {
	state: SessionHostState
	hostLabel: string
	isLocal: boolean
}

const QUEUED_LABELS: Record<SessionHostState, (subject: string) => string> = {
	online: () => SESSION_STATUS_LABELS.launching,
	starting: (subject) => `Waiting for ${subject} to start`,
	updating: (subject) => `Waiting for ${subject} to update`,
	offline: (subject) => `Waiting for ${subject} to reconnect`,
}

function isSessionStatus(status: string): status is SessionStatus {
	return Object.hasOwn(SESSION_STATUS_LABELS, status)
}

export function sessionStatusLabel(status: string | null | undefined, host?: SessionStatusHost | null): string | null {
	if (!status || !isSessionStatus(status)) return null
	if (status === 'ready_for_launch' && host) {
		return QUEUED_LABELS[host.state](host.isLocal ? 'this device' : host.hostLabel)
	}
	return SESSION_STATUS_LABELS[status]
}
