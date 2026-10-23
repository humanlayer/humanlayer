import { describe, expect, it } from 'vitest'

import { NOTIFICATION_WINDOW_MS } from '@/lib/notifications/notification-row'
import { deriveNotificationRows } from '@/lib/notifications/notification-rows'
import type {
	NotificationArtifactComment,
	NotificationDiffComment,
	NotificationSession,
	NotificationSources,
} from '@/lib/notifications/notification-sources'

const ME = 'user_me'
const SAM = 'user_sam'
const KYLE = 'user_kyle'
const NOW = 1_000_000_000
const OUTSIDE_WINDOW = NOW - NOTIFICATION_WINDOW_MS - 1

function session(overrides: Partial<NotificationSession> = {}): NotificationSession {
	return {
		id: 'session-1',
		task_id: 'task-1',
		created_by: ME,
		resource_owner_user_id: ME,
		title: 'Implement usage limit alerts',
		summary: null,
		status: 'running',
		error_message: null,
		archived: false,
		updated_at: BigInt(NOW - 5 * 60_000),
		multiplayer_prompting_user_ids: [],
		multiplayer_prompting_started_at: null,
		multiplayer_prompting_expires_at: null,
		...overrides,
	}
}

function artifactComment(overrides: Partial<NotificationArtifactComment> = {}): NotificationArtifactComment {
	return {
		id: 'comment-1',
		artifact_id: 'artifact-1',
		task_id: 'task-1',
		resource_owner_user_id: ME,
		created_by_user_id: SAM,
		anonymous_guest_name: null,
		reply_to_comment_id: null,
		content_text: 'Batch this per minute?',
		is_resolved: false,
		is_deleted: false,
		created_at: BigInt(NOW - 10 * 60_000),
		...overrides,
	}
}

function diffComment(overrides: Partial<NotificationDiffComment> = {}): NotificationDiffComment {
	return {
		id: 'diff-1',
		task_id: 'task-1',
		resource_owner_user_id: ME,
		created_by_user_id: SAM,
		reply_to_comment_id: null,
		content_text: 'This drops the error',
		anchor_json: { path: 'src/usage.ts' },
		is_resolved: false,
		is_deleted: false,
		created_at: BigInt(NOW - 3 * 60_000),
		...overrides,
	}
}

function sources(overrides: Partial<NotificationSources> = {}): NotificationSources {
	return {
		userId: ME,
		now: NOW,
		seen: {},
		multiplayerPromptingEnabled: true,
		unreadSessionIds: new Set(),
		sessions: [],
		approvals: [],
		tasks: [{ id: 'task-1', name: 'Usage limit alerts', resource_owner_user_id: ME }],
		artifacts: [{ id: 'artifact-1', file_name: 'plan.md' }],
		artifactComments: [],
		diffComments: [],
		workspaceSetups: [],
		...overrides,
	}
}

describe('deriveNotificationRows', () => {
	describe('agent approvals', () => {
		const approval = {
			id: 'approval-1',
			session_id: 'session-1',
			status: 'pending',
			tool_name: 'Bash',
			tool_input: { command: 'bun run db:migrations:generate' },
			created_at: BigInt(NOW - 60_000),
		}

		it('shows a pending approval on your session with the tool and command', () => {
			const rows = deriveNotificationRows(sources({ sessions: [session()], approvals: [approval] }))

			expect(rows).toEqual([
				expect.objectContaining({
					key: 'approval:approval-1',
					kind: 'approval',
					subject: 'Implement usage limit alerts',
					taskName: 'Usage limit alerts',
					detail: 'Bash · bun run db:migrations:generate',
					destination: { kind: 'session', sessionId: 'session-1' },
					dismissible: false,
				}),
			])
		})

		it('leaves out approvals that are answered or on a teammate session', () => {
			expect(
				deriveNotificationRows(
					sources({ sessions: [session()], approvals: [{ ...approval, status: 'approved' }] }),
				),
			).toEqual([])
			expect(
				deriveNotificationRows(sources({ sessions: [session({ created_by: SAM })], approvals: [approval] })),
			).toEqual([])
		})

		it('keeps a pending approval visible after it was opened', () => {
			const rows = deriveNotificationRows(
				sources({ sessions: [session()], approvals: [approval], seen: { 'approval:approval-1': NOW } }),
			)
			expect(rows).toHaveLength(1)
		})
	})

	describe('ready for input', () => {
		const ready = session({ status: 'ready_for_input' })
		const unread = new Set(['session-1'])

		it('shows your unread session that is waiting for input', () => {
			const [row] = deriveNotificationRows(sources({ sessions: [ready], unreadSessionIds: unread }))
			expect(row).toMatchObject({
				kind: 'ready_for_input',
				subject: 'Implement usage limit alerts',
				taskName: 'Usage limit alerts',
				destination: { kind: 'session', sessionId: 'session-1' },
				dismissible: true,
			})
		})

		it('leaves out read sessions, sessions that moved on, and teammate sessions', () => {
			expect(deriveNotificationRows(sources({ sessions: [ready] }))).toEqual([])
			expect(
				deriveNotificationRows(
					sources({ sessions: [{ ...ready, status: 'running' }], unreadSessionIds: unread }),
				),
			).toEqual([])
			expect(
				deriveNotificationRows(
					sources({ sessions: [{ ...ready, created_by: SAM }], unreadSessionIds: unread }),
				),
			).toEqual([])
		})
	})

	describe('session failures', () => {
		const failed = session({ status: 'failed', error_message: 'Claude Code failed to start.\nstack trace' })

		it('shows a failure on your session with the first line of the error', () => {
			const [row] = deriveNotificationRows(sources({ sessions: [failed] }))
			expect(row).toMatchObject({
				kind: 'session_failed',
				detail: 'Claude Code failed to start.',
				dismissible: true,
			})
		})

		it('leaves out failures older than a week, and archived sessions', () => {
			expect(
				deriveNotificationRows(sources({ sessions: [{ ...failed, updated_at: BigInt(OUTSIDE_WINDOW) }] })),
			).toEqual([])
			expect(deriveNotificationRows(sources({ sessions: [{ ...failed, archived: true }] }))).toEqual([])
		})

		it('hides a dismissed failure until the session fails again', () => {
			const dismissed = { 'session_failed:session-1': NOW - 60_000 }
			expect(deriveNotificationRows(sources({ sessions: [failed], seen: dismissed }))).toEqual([])
			expect(
				deriveNotificationRows(
					sources({ sessions: [{ ...failed, updated_at: BigInt(NOW) }], seen: dismissed }),
				),
			).toHaveLength(1)
		})
	})

	it('shows a workspace setup failure on your task until the error clears', () => {
		const setup = {
			id: 'setup-1',
			task_id: 'task-1',
			error: { message: 'git worktree add failed' },
			updated_at: BigInt(NOW - 60_000),
		}
		expect(deriveNotificationRows(sources({ workspaceSetups: [setup] }))).toEqual([
			expect.objectContaining({
				kind: 'workspace_setup_failed',
				subject: 'Usage limit alerts',
				detail: 'git worktree add failed',
				destination: { kind: 'workspace-setup', taskId: 'task-1' },
			}),
		])
		expect(deriveNotificationRows(sources({ workspaceSetups: [{ ...setup, error: null }] }))).toEqual([])
	})

	describe('prompt invites', () => {
		const invited = session({
			created_by: SAM,
			resource_owner_user_id: SAM,
			multiplayer_prompting_user_ids: [ME],
			multiplayer_prompting_started_at: BigInt(NOW - 5 * 60_000),
			multiplayer_prompting_expires_at: BigInt(NOW + 55 * 60_000),
		})

		it('shows an active invite with the time left', () => {
			const [row] = deriveNotificationRows(sources({ sessions: [invited] }))
			expect(row).toMatchObject({
				kind: 'prompt_invite',
				actors: [{ userId: SAM }],
				detail: 'Access ends in 55 min',
			})
		})

		it('leaves out expired invites and invites while the feature is off', () => {
			const expired = { ...invited, multiplayer_prompting_expires_at: BigInt(NOW - 1) }
			expect(deriveNotificationRows(sources({ sessions: [expired] }))).toEqual([])
			expect(
				deriveNotificationRows(sources({ sessions: [invited], multiplayerPromptingEnabled: false })),
			).toEqual([])
		})
	})

	describe('artifact comments', () => {
		it('groups comments on your artifact into one row with every commenter', () => {
			const rows = deriveNotificationRows(
				sources({
					artifactComments: [
						artifactComment(),
						artifactComment({
							id: 'comment-2',
							created_by_user_id: KYLE,
							created_at: BigInt(NOW - 2 * 60_000),
							content_text: 'Agree',
						}),
						artifactComment({ id: 'comment-3', created_by_user_id: ME, created_at: BigInt(NOW - 60_000) }),
					],
				}),
			)

			expect(rows).toEqual([
				expect.objectContaining({
					key: 'artifact_comment:artifact-1',
					kind: 'artifact_comment',
					count: 2,
					actors: [{ userId: KYLE }, { userId: SAM }],
					subject: 'plan.md',
					detail: 'Agree',
					destination: {
						kind: 'artifact-comment',
						taskId: 'task-1',
						artifactId: 'artifact-1',
						commentId: 'comment-2',
					},
				}),
			])
		})

		it('leaves out resolved threads, deleted comments and comments older than a week', () => {
			const root = artifactComment({ is_resolved: true })
			const reply = artifactComment({ id: 'reply-1', reply_to_comment_id: root.id })
			expect(deriveNotificationRows(sources({ artifactComments: [root, reply] }))).toEqual([])
			expect(
				deriveNotificationRows(sources({ artifactComments: [artifactComment({ is_deleted: true })] })),
			).toEqual([])
			expect(
				deriveNotificationRows(
					sources({ artifactComments: [artifactComment({ created_at: BigInt(OUTSIDE_WINDOW) })] }),
				),
			).toEqual([])
		})

		it('counts only comments newer than when the row was opened', () => {
			const seen = { 'artifact_comment:artifact-1': NOW - 5 * 60_000 }
			const comments = [
				artifactComment(),
				artifactComment({ id: 'comment-2', created_at: BigInt(NOW - 60_000), content_text: 'One more' }),
			]
			expect(deriveNotificationRows(sources({ artifactComments: comments, seen }))).toEqual([
				expect.objectContaining({ count: 1, detail: 'One more' }),
			])
		})

		it('shows a reply on a teammate artifact when you wrote in the thread', () => {
			const root = artifactComment({ id: 'root', resource_owner_user_id: SAM, created_by_user_id: ME })
			const reply = artifactComment({ id: 'reply', resource_owner_user_id: SAM, reply_to_comment_id: 'root' })
			const stranger = artifactComment({ id: 'other', resource_owner_user_id: SAM, created_by_user_id: KYLE })
			const strangerReply = artifactComment({
				id: 'other-reply',
				resource_owner_user_id: SAM,
				reply_to_comment_id: 'other',
			})

			expect(
				deriveNotificationRows(sources({ artifactComments: [root, reply, stranger, strangerReply] })),
			).toEqual([
				expect.objectContaining({ key: 'thread_reply:root', kind: 'thread_reply', actors: [{ userId: SAM }] }),
			])
		})

		it('names a guest when a public-link comment has no user', () => {
			const [row] = deriveNotificationRows(
				sources({
					artifactComments: [artifactComment({ created_by_user_id: null, anonymous_guest_name: 'Ada' })],
				}),
			)
			expect(row?.actors).toEqual([{ guestName: 'Ada' }])
		})
	})

	describe('diff comments', () => {
		it('groups a diff thread on your task and names the file', () => {
			const rows = deriveNotificationRows(
				sources({
					diffComments: [
						diffComment(),
						diffComment({
							id: 'diff-2',
							reply_to_comment_id: 'diff-1',
							anchor_json: null,
							created_at: BigInt(NOW - 60_000),
						}),
					],
				}),
			)
			expect(rows).toEqual([
				expect.objectContaining({
					key: 'diff_comment:diff-1',
					count: 2,
					subject: 'src/usage.ts',
					destination: { kind: 'diff-comment', taskId: 'task-1', diffCommentId: 'diff-2' },
				}),
			])
		})

		it('reaches people with a session on the task and nobody else', () => {
			const teammateTask = diffComment({ resource_owner_user_id: SAM })
			expect(deriveNotificationRows(sources({ diffComments: [teammateTask] }))).toEqual([])
			expect(
				deriveNotificationRows(
					sources({
						diffComments: [teammateTask],
						sessions: [session({ created_by: ME, resource_owner_user_id: ME })],
					}),
				),
			).toHaveLength(1)
		})

		it('leaves out your own diff comments', () => {
			expect(
				deriveNotificationRows(sources({ diffComments: [diffComment({ created_by_user_id: ME })] })),
			).toEqual([])
		})
	})

	it('orders rows newest first across kinds', () => {
		const rows = deriveNotificationRows(
			sources({
				sessions: [session({ status: 'failed', updated_at: BigInt(NOW - 30 * 60_000) })],
				artifactComments: [artifactComment({ created_at: BigInt(NOW - 60_000) })],
				diffComments: [diffComment({ created_at: BigInt(NOW - 10 * 60_000) })],
			}),
		)
		expect(rows.map((row) => row.kind)).toEqual(['artifact_comment', 'diff_comment', 'session_failed'])
	})
})
