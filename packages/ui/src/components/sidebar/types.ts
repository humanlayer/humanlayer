import type { SessionLabel } from '../session-label-badge'

export type SidebarItem =
	| { type: 'task'; id: string }
	| { type: 'session'; id: string; taskId: string }
	| { type: 'standalone-session'; id: string }

export type TaskStatus =
	| 'needs_approval'
	| 'failed'
	| 'lost'
	| 'running'
	| 'pending'
	| 'interrupt_requested'
	| 'has_next_step'
	| 'idle'

export type SessionStatus =
	| 'running'
	| 'interrupt_requested'
	| 'needs_approval'
	| 'waiting_for_usage_limit'
	| 'failed'
	| 'lost'
	| 'launching'
	| 'ready_for_launch'
	| 'resuming'
	| 'idle'

export interface SidebarSession {
	id: string
	name: string
	ownerUserId?: string | null
	hostId?: string | null
	status?: SessionStatus
	label?: SessionLabel
	createdAt?: string
	messageCount?: number
	isUnread?: boolean
}

export interface SidebarTask {
	id: string
	name: string
	ownerUserId?: string | null
	status?: TaskStatus
	groupStatus?: TaskStatus
	label?: SessionLabel
	sessions: SidebarSession[]
	sessionCount?: number
	createdAt?: string
	isUnread?: boolean
}
