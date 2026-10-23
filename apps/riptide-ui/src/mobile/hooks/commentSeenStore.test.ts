import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { describe, expect, it } from 'vitest'

import { isThreadUnread } from './commentSeenStore'

const CURRENT_USER_ID = 'current-user'

function createComment(overrides: Partial<ArtifactComment> = {}): ArtifactComment {
	return {
		id: 'comment-id',
		organization_id: 'organization-id',
		resource_owner_user_id: CURRENT_USER_ID,
		task_id: 'task-id',
		created_by_user_id: 'teammate-user',
		reply_to_comment_id: null,
		created_at: 200n,
		updated_at: 200n,
		content_text: 'Comment',
		content_json: null,
		artifact_id: 'artifact-id',
		created_at_artifact_version_id: null,
		commented_upon_block_text: null,
		previous_block_text: null,
		next_block_text: null,
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		...overrides,
	}
}

describe('isThreadUnread', () => {
	it('does not mark a fully resolved thread unread', () => {
		const root = createComment({ is_resolved: true })
		const reply = createComment({
			id: 'reply-id',
			reply_to_comment_id: root.id,
			created_at: 300n,
			created_by_agent: true,
			is_resolved: true,
		})

		expect(isThreadUnread({}, CURRENT_USER_ID, root, [reply])).toBe(false)
	})

	it.each([
		['agent', { created_by_user_id: CURRENT_USER_ID, created_by_agent: true }],
		['teammate', { created_by_user_id: 'teammate-user', created_by_agent: false }],
	] as const)('marks new unresolved %s activity unread', (_author, overrides) => {
		const root = createComment(overrides)

		expect(isThreadUnread({}, CURRENT_USER_ID, root, [])).toBe(true)
	})

	it('marks a resolved root unread when it has a new unresolved reply', () => {
		const root = createComment({ is_resolved: true })
		const reply = createComment({
			id: 'reply-id',
			reply_to_comment_id: root.id,
			created_at: 300n,
			created_by_agent: true,
			is_resolved: false,
		})

		expect(isThreadUnread({}, CURRENT_USER_ID, root, [reply])).toBe(true)
	})

	it('does not mark current-user activity unread', () => {
		const root = createComment({ created_by_user_id: CURRENT_USER_ID })

		expect(isThreadUnread({}, CURRENT_USER_ID, root, [])).toBe(false)
	})

	it('does not mark activity at or before the seen timestamp unread', () => {
		const root = createComment({ created_at: 200n })

		expect(isThreadUnread({ [root.id]: 200 }, CURRENT_USER_ID, root, [])).toBe(false)
	})

	it.each([null, undefined])('does not mark activity unread without a current user (%s)', (currentUserId) => {
		const root = createComment()

		expect(isThreadUnread({}, currentUserId, root, [])).toBe(false)
	})
})
