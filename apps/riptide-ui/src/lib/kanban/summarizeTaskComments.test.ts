import { describe, expect, test } from 'vitest'

import { type KanbanCommentInput, summarizeTaskComments } from './summarizeTaskComments'

function comment(overrides: Partial<KanbanCommentInput> = {}): KanbanCommentInput {
	return {
		id: crypto.randomUUID(),
		created_by_user_id: 'user-a',
		reply_to_comment_id: null,
		is_deleted: false,
		is_resolved: false,
		...overrides,
	}
}

describe('summarizeTaskComments', () => {
	test('returns zero count and no participants for no comments', () => {
		expect(summarizeTaskComments([])).toEqual({ count: 0, participantIds: [] })
	})

	test('counts only root threads, not replies', () => {
		const root = comment({ id: 'c1', created_by_user_id: 'user-a' })
		const reply = comment({ id: 'c2', created_by_user_id: 'user-b', reply_to_comment_id: 'c1' })

		const summary = summarizeTaskComments([root, reply])

		expect(summary.count).toBe(1)
	})

	test('counts multiple root threads', () => {
		const summary = summarizeTaskComments([
			comment({ id: 'c1', created_by_user_id: 'user-a' }),
			comment({ id: 'c2', created_by_user_id: 'user-b' }),
			comment({ id: 'c3', created_by_user_id: 'user-c', reply_to_comment_id: 'c1' }),
		])

		expect(summary.count).toBe(2)
	})

	test('dedups participants including repliers, preserving first-appearance order', () => {
		const summary = summarizeTaskComments([
			comment({ id: 'c1', created_by_user_id: 'user-a' }),
			comment({ id: 'c2', created_by_user_id: 'user-b', reply_to_comment_id: 'c1' }),
			comment({ id: 'c3', created_by_user_id: 'user-a', reply_to_comment_id: 'c1' }),
			comment({ id: 'c4', created_by_user_id: 'user-c' }),
		])

		expect(summary.participantIds).toEqual(['user-a', 'user-b', 'user-c'])
	})

	test('excludes resolved comments from count and participants', () => {
		const summary = summarizeTaskComments([
			comment({ id: 'c1', created_by_user_id: 'user-a', is_resolved: true }),
			comment({ id: 'c2', created_by_user_id: 'user-b' }),
		])

		expect(summary.count).toBe(1)
		expect(summary.participantIds).toEqual(['user-b'])
	})

	test('excludes deleted comments from count and participants', () => {
		const summary = summarizeTaskComments([
			comment({ id: 'c1', created_by_user_id: 'user-a', is_deleted: true }),
			comment({ id: 'c2', created_by_user_id: 'user-b', reply_to_comment_id: 'c-missing' }),
		])

		expect(summary.count).toBe(0)
		expect(summary.participantIds).toEqual(['user-b'])
	})

	test('omits a fully tombstoned thread from count and participants', () => {
		const summary = summarizeTaskComments([
			comment({ id: 'root', created_by_user_id: 'user-a', is_deleted: true }),
			comment({ id: 'reply', created_by_user_id: 'user-b', reply_to_comment_id: 'root', is_deleted: true }),
		])

		expect(summary).toEqual({ count: 0, participantIds: [] })
	})

	test('ignores comments with no creator id for participants', () => {
		const summary = summarizeTaskComments([
			comment({ id: 'c1', created_by_user_id: null }),
			comment({ id: 'c2', created_by_user_id: 'user-b' }),
		])

		expect(summary.count).toBe(2)
		expect(summary.participantIds).toEqual(['user-b'])
	})
})
