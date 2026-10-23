export const NOTIFICATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type NotificationKind =
	| 'approval'
	| 'ready_for_input'
	| 'session_failed'
	| 'workspace_setup_failed'
	| 'prompt_invite'
	| 'artifact_comment'
	| 'thread_reply'
	| 'diff_comment'

export type NotificationDestination =
	| { kind: 'session'; sessionId: string }
	| { kind: 'workspace-setup'; taskId: string }
	| { kind: 'artifact-comment'; taskId: string; artifactId: string; commentId: string }
	| { kind: 'diff-comment'; taskId: string; diffCommentId: string }

export type NotificationActor = { userId: string } | { guestName: string } | { agent: true }

export interface NotificationRow {
	key: string
	kind: NotificationKind
	at: number
	actors: NotificationActor[]
	count: number
	subject: string
	taskName: string | null
	detail: string | null
	destination: NotificationDestination
	dismissible: boolean
}
