import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { SessionLabel } from '@humanlayer/ui/components/session-label-badge'

export type SessionStatus =
	| 'ready_for_launch'
	| 'draft'
	| 'launching'
	| 'running'
	| 'failed'
	| 'lost'
	| 'ready_for_input'
	| 'needs_approval'
	| 'waiting_for_usage_limit'
	| 'interrupt_requested'
	| 'interrupted'
	| 'resuming'

/**
 * Returns the appropriate CSS class for styling session status text.
 * Uses theme-aware CSS variables that adapt to any active theme.
 */
export function getSessionStatusClass(status?: SessionStatus): string {
	switch (status) {
		// Blue - active/in-progress states
		case 'ready_for_launch':
		case 'launching':
			return 'text-[var(--terminal-accent)]'
		case 'resuming':
			return 'text-[var(--terminal-accent)] font-bold'

		// Green - success states
		case 'running':
			return 'text-[var(--terminal-success)] font-bold'

		// Yellow - attention/warning states (bold for approval statuses)
		case 'needs_approval':
			return 'text-[var(--terminal-warning)] font-bold'
		case 'interrupt_requested':
		case 'interrupted':
		case 'lost':
		case 'waiting_for_usage_limit':
			return 'text-[var(--terminal-warning)]'

		// Red - error
		case 'failed':
			return 'text-[var(--terminal-error)]'

		// Muted - inactive
		case 'draft':
			return 'text-muted-foreground'

		default:
			return ''
	}
}

// Keep the standard table's lowercase labels separate from composer and minimalist copy.
export function getSessionStatusDisplay(status?: SessionStatus): string {
	if (!status) return 'unknown'
	if (status === 'ready_for_input') return 'idle'
	if (status === 'waiting_for_usage_limit') return 'usage limit'
	return status
}

export interface TableSession {
	id: string
	title?: string
	summary?: string
	query?: string
	model?: string
	status?: SessionStatus
	workingDirectory: string
	createdAt?: string
	lastActivityAt?: string
	archived?: boolean
	isDraft?: boolean
	dangerouslySkipPermissions?: boolean
	autoAcceptEdits?: boolean
	isUnread?: boolean
	taskId?: string
	taskName?: string
	labels?: SessionLabel[]
	resourceOwnerUserId?: string
	createdByUserId?: string
	/** Coding agent backing the session (drives the agent badge). */
	codingAgent?: CodingAgent
	/** Provider for CodeLayer-backed sessions (used to label the agent badge). */
	provider?: string
}

export interface SearchMatch {
	indices: [number, number][]
}

export interface MatchData {
	matches?: Array<{ key: string; indices: [number, number][] }>
}
